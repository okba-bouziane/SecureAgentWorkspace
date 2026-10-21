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

  it("enforces a per-user and a global daily cap, and a refusal by one does not use up the other", async () => {
    const tag = `d${Date.now()}`;
    const cfg = { ...loadConfig({}), DAILY_RUN_CAP_PER_USER: 2, DAILY_RUN_CAP_GLOBAL: 3 };
    const a = `${tag}-a`;
    const b = `${tag}-b`;
    // The global counter is shared with other tests only through today's key, so measure relative to it.
    const before = Number((await redis.get(`saw:cap:${new Date().toISOString().slice(0, 10)}:global`)) ?? 0);
    const cap = { ...cfg, DAILY_RUN_CAP_GLOBAL: before + 3 };
    const l = new RateLimitService(redis, cap);
    expect((await l.checkDaily(a)).allowed).toBe(true);
    expect((await l.checkDaily(a)).allowed).toBe(true);
    const third = await l.checkDaily(a);
    expect(third).toMatchObject({ allowed: false, scope: "user" });
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect((await l.checkDaily(b)).allowed).toBe(true); // global is now at before+3
    expect(await l.checkDaily(`${tag}-c`)).toMatchObject({ allowed: false, scope: "global" });
  });

  it("is off when both caps are 0", async () => {
    const limiter = new RateLimitService(redis, { ...loadConfig({}), DAILY_RUN_CAP_PER_USER: 0, DAILY_RUN_CAP_GLOBAL: 0 });
    for (let i = 0; i < 5; i++) expect((await limiter.checkDaily("free")).allowed).toBe(true);
  });
});
