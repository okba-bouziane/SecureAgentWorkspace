import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { RateLimitService } from "../src/ratelimit/rate-limit.service.js";
import { TEST_REDIS_URL } from "./helpers.js";

describe.skipIf(!TEST_REDIS_URL)("Redis rate limiter", () => {
  let redis: Redis;
  beforeAll(() => {
    redis = new Redis(TEST_REDIS_URL!);
  });
  afterAll(() => redis.quit());

  it("allows up to the limit per user, then rejects with a retry hint", async () => {
    const cfg = { ...loadConfig({}), CHAT_RATE_LIMIT: 3, CHAT_RATE_WINDOW_SECONDS: 60 };
    const limiter = new RateLimitService(redis, cfg);
    const user = `u-${Date.now()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.check(user));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[0]!.remaining).toBe(2);
    expect(results[3]!.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("limits each user separately", async () => {
    const cfg = { ...loadConfig({}), CHAT_RATE_LIMIT: 1, CHAT_RATE_WINDOW_SECONDS: 60 };
    const limiter = new RateLimitService(redis, cfg);
    const stamp = Date.now();
    expect((await limiter.check(`a-${stamp}`)).allowed).toBe(true);
    expect((await limiter.check(`b-${stamp}`)).allowed).toBe(true);
    expect((await limiter.check(`a-${stamp}`)).allowed).toBe(false);
  });

  it("lets requests through again once the window has passed", async () => {
    const cfg = { ...loadConfig({}), CHAT_RATE_LIMIT: 1, CHAT_RATE_WINDOW_SECONDS: 1 };
    const limiter = new RateLimitService(redis, cfg);
    const user = `w-${Date.now()}`;
    expect((await limiter.check(user)).allowed).toBe(true);
    expect((await limiter.check(user)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await limiter.check(user)).allowed).toBe(true);
  });
});
