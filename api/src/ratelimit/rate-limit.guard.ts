import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type { Response } from "express";
import type { AuthedRequest } from "../auth/auth.guard.js";
import { errorMessage } from "../common/errors.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { RateLimitService } from "./rate-limit.service.js";

const DAILY_CAP_MESSAGES = {
  global:
    "This demo has reached its daily limit of agent runs (it shares a free LLM quota). Please try again tomorrow (limits reset at 00:00 UTC).",
  user: "You have used your daily agent runs on this demo. Please try again tomorrow (limits reset at 00:00 UTC).",
} as const;

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

    await this.enforceWindowLimit(req.user.sub, res);
    await this.enforceDailyCap(req.user.sub, res);
    return true;
  }

  private async enforceWindowLimit(userSub: string, res: Response): Promise<void> {
    let decision;
    try {
      decision = await this.limiter.check(userSub);
    } catch (err) {
      // Fail open: a Redis outage should not take chat down. The error is logged.
      this.log.warn(`Rate limiter unavailable: ${errorMessage(err)}`);
      return;
    }
    res.setHeader("X-RateLimit-Limit", decision.limit);
    res.setHeader("X-RateLimit-Remaining", decision.remaining);
    if (decision.allowed) return;

    this.metrics.rateLimited.inc();
    res.setHeader("Retry-After", decision.retryAfterSeconds);
    throw new HttpException(
      { statusCode: 429, message: `Rate limit exceeded. Retry in ${decision.retryAfterSeconds}s.`, retryAfterSeconds: decision.retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async enforceDailyCap(userSub: string, res: Response): Promise<void> {
    let daily;
    try {
      daily = await this.limiter.checkDaily(userSub);
    } catch (err) {
      this.log.warn(`Daily cap check unavailable: ${errorMessage(err)}`);
      return;
    }
    if (daily.allowed) return;

    this.metrics.rateLimited.inc();
    res.setHeader("Retry-After", daily.retryAfterSeconds);
    const scope = daily.scope ?? "user";
    throw new HttpException(
      { statusCode: 429, message: DAILY_CAP_MESSAGES[scope], code: "daily_cap", scope, retryAfterSeconds: daily.retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
