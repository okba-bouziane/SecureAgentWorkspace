import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type { Response } from "express";
import type { AuthedRequest } from "../auth/auth.guard.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { RateLimitService } from "./rate-limit.service.js";

/** Must run after AuthGuard: limits are per signed-in user. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly log = new Logger(RateLimitGuard.name);

  constructor(
    @Inject(RateLimitService) private readonly limiter: RateLimitService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const res = http.getResponse<Response>();
    if (!req.user) return false;

    let decision;
    try {
      decision = await this.limiter.check(req.user.sub);
    } catch (err) {
      // Fail open: a Redis outage should not take chat down. The error is logged.
      this.log.warn(`Rate limiter unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return true;
    }
    res.setHeader("X-RateLimit-Limit", decision.limit);
    res.setHeader("X-RateLimit-Remaining", decision.remaining);
    if (!decision.allowed) {
      this.metrics.rateLimited.inc();
      res.setHeader("Retry-After", decision.retryAfterSeconds);
      throw new HttpException(
        { statusCode: 429, message: `Rate limit exceeded. Retry in ${decision.retryAfterSeconds}s.`, retryAfterSeconds: decision.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      const daily = await this.limiter.checkDaily(req.user.sub);
      if (!daily.allowed) {
        this.metrics.rateLimited.inc();
        res.setHeader("Retry-After", daily.retryAfterSeconds);
        const message =
          daily.scope === "global"
            ? "This demo has reached its daily limit of agent runs (it shares a free LLM quota). Please try again tomorrow (limits reset at 00:00 UTC)."
            : "You have used your daily agent runs on this demo. Please try again tomorrow (limits reset at 00:00 UTC).";
        throw new HttpException(
          { statusCode: 429, message, code: "daily_cap", scope: daily.scope, retryAfterSeconds: daily.retryAfterSeconds },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.log.warn(`Daily cap check unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
    return true;
  }
}
