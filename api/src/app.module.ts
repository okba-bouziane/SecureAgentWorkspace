import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { AgentService } from "./agent/agent.service.js";
import { ChatController } from "./agent/chat.controller.js";
import { openAiCompatibleFactory } from "./agent/llm.js";
import { AuthModule } from "./auth/auth.module.js";
import { CHAT_MODEL_FACTORY, CHECKPOINTER, CONFIG, MCP_GATEWAY_FACTORY } from "./common/tokens.js";
import type { Config } from "./config.js";
import { GuardrailsModule } from "./guardrails/guardrails.module.js";
import { HealthController } from "./health.controller.js";
import { InfraModule } from "./infra.module.js";
import { IngestionController } from "./ingestion/ingestion.controller.js";
import { IngestionService } from "./ingestion/ingestion.service.js";
import { SeedService } from "./ingestion/seed.service.js";
import { httpGatewayFactory } from "./mcp/mcp-gateway.js";
import { HttpMetricsInterceptor } from "./metrics/metrics.controller.js";
import { MetricsModule } from "./metrics/metrics.module.js";
import { RagController } from "./rag/rag.controller.js";
import { RagService } from "./rag/rag.service.js";
import { RateLimitGuard } from "./ratelimit/rate-limit.guard.js";
import { RateLimitService } from "./ratelimit/rate-limit.service.js";
import { TracingModule } from "./tracing/tracing.module.js";

class CheckpointerShutdown implements OnApplicationShutdown {
  constructor(@Inject(CHECKPOINTER) private readonly saver: Partial<PostgresSaver>) {}
  async onApplicationShutdown(): Promise<void> {
    await this.saver.end?.();
  }
}

@Module({
  imports: [InfraModule, AuthModule, MetricsModule, GuardrailsModule, TracingModule],
  controllers: [HealthController, ChatController, RagController, IngestionController],
  providers: [
    {
      provide: CHECKPOINTER,
      inject: [CONFIG],
      useFactory: async (cfg: Config) => {
        const saver = PostgresSaver.fromConnString(cfg.DATABASE_URL);
        await saver.setup();
        return saver;
      },
    },
    { provide: CHAT_MODEL_FACTORY, inject: [CONFIG], useFactory: (cfg: Config) => openAiCompatibleFactory(cfg) },
    { provide: MCP_GATEWAY_FACTORY, inject: [CONFIG], useFactory: (cfg: Config) => httpGatewayFactory(cfg.MCP_URL) },
    { provide: APP_INTERCEPTOR, useExisting: HttpMetricsInterceptor },
    CheckpointerShutdown,
    AgentService,
    RagService,
    IngestionService,
    SeedService,
    RateLimitService,
    RateLimitGuard,
  ],
})
export class AppModule {}
