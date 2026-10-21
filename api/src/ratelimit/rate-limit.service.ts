import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { CONFIG, REDIS } from "../common/tokens.js";
import type { Config } from "../config.js";

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

/** Sliding-window log in a Redis sorted set; one atomic Lua script per check. */
const SCRIPT = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local member = ARGV[3]
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = windowMs - (now - tonumber(oldest[2]))
  return {0, count, retry}
end
redis.call('ZADD', key, now, member .. ':' .. now)
redis.call('PEXPIRE', key, windowMs)
return {1, count + 1, 0}
`;

export interface DailyDecision {
  allowed: boolean;
  scope?: "global" | "user";
  retryAfterSeconds: number;
}

const secondsUntilUtcMidnight = (now = new Date()) =>
  Math.max(1, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000));

@Injectable()
export class RateLimitService {
  private seq = 0;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async check(userSub: string, bucket = "chat"): Promise<RateLimitDecision> {
    const limit = this.cfg.CHAT_RATE_LIMIT;
    const windowMs = this.cfg.CHAT_RATE_WINDOW_SECONDS * 1000;
    const member = `${process.pid}-${this.seq++}`;
    const res = (await this.redis.eval(SCRIPT, 1, `saw:rl:${bucket}:${userSub}`, windowMs, limit, member)) as [number, number, number];
    const [ok, count, retryMs] = res;
    return {
      allowed: ok === 1,
      limit,
      remaining: Math.max(limit - count, 0),
      retryAfterSeconds: Math.ceil(retryMs / 1000),
    };
  }

  /**
   * Daily caps (UTC day) per user and across all users. Counts agent runs, so a public demo
   * cannot burn a shared LLM quota. A run refused by one cap is not counted against the other.
   */
  async checkDaily(userSub: string): Promise<DailyDecision> {
    const perUser = this.cfg.DAILY_RUN_CAP_PER_USER;
    const global = this.cfg.DAILY_RUN_CAP_GLOBAL;
    const retryAfterSeconds = secondsUntilUtcMidnight();
    if (perUser <= 0 && global <= 0) return { allowed: true, retryAfterSeconds };
    const day = new Date().toISOString().slice(0, 10);
    const ttl = 2 * 24 * 3600;
    const bump = async (key: string) => {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, ttl);
      return n;
    };
    const userKey = `saw:cap:${day}:user:${userSub}`;
    const globalKey = `saw:cap:${day}:global`;
    if (perUser > 0 && (await bump(userKey)) > perUser) {
      await this.redis.decr(userKey);
      return { allowed: false, scope: "user", retryAfterSeconds };
    }
    if (global > 0 && (await bump(globalKey)) > global) {
      await this.redis.decr(globalKey);
      if (perUser > 0) await this.redis.decr(userKey);
      return { allowed: false, scope: "global", retryAfterSeconds };
    }
    return { allowed: true, retryAfterSeconds };
  }
}
