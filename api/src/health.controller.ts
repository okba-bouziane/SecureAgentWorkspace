import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import type { Redis } from "ioredis";
import { PG_POOL, REDIS } from "./common/tokens.js";
import type { Pool } from "./db/db.js";

export const lifecycle = { shuttingDown: false };

@Controller("health")
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  live() {
    return { status: "ok" };
  }

  /** Readiness: fails while shutting down so the load balancer stops sending traffic. */
  @Get("ready")
  async ready() {
    if (lifecycle.shuttingDown) throw new ServiceUnavailableException("shutting down");
    try {
      await Promise.all([this.pool.query("SELECT 1"), this.redis.ping()]);
    } catch (err) {
      throw new ServiceUnavailableException(err instanceof Error ? err.message : "dependency down");
    }
    return { status: "ready" };
  }
}
