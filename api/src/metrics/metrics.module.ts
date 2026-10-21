import { Global, Module } from "@nestjs/common";
import { MetricsController, HttpMetricsInterceptor } from "./metrics.controller.js";
import { MetricsService } from "./metrics.service.js";

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, HttpMetricsInterceptor],
  exports: [MetricsService, HttpMetricsInterceptor],
})
export class MetricsModule {}
