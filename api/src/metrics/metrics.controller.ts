import { Controller, Get, Header, Inject, Injectable, type NestInterceptor, type ExecutionContext, type CallHandler } from "@nestjs/common";
import type { Request, Response } from "express";
import type { Observable } from "rxjs";
import { MetricsService } from "./metrics.service.js";

@Controller("metrics")
export class MetricsController {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4")
  render(): Promise<string> {
    return this.metrics.render();
  }
}

/** Records request count and latency per route pattern. */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
    const stop = this.metrics.httpDuration.startTimer({ method: req.method, route });
    const done = () => {
      stop();
      this.metrics.httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
    };
    res.once("finish", done);
    return next.handle();
  }
}
