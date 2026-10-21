import { Global, Module } from "@nestjs/common";
import { CONFIG, PG_POOL, TRACER } from "../common/tokens.js";
import type { Config } from "../config.js";
import type { Pool } from "../db/db.js";
import { LangfuseSink } from "./langfuse-sink.js";
import { PostgresSink } from "./postgres-sink.js";
import { Tracer } from "./tracer.js";
import { TracingController } from "./tracing.controller.js";
import type { SpanSink } from "./types.js";

@Global()
@Module({
  controllers: [TracingController],
  providers: [
    {
      provide: TRACER,
      inject: [CONFIG, PG_POOL],
      useFactory: (cfg: Config, pool: Pool) => {
        const sinks: SpanSink[] = [new PostgresSink(pool)];
        if (cfg.LANGFUSE_HOST && cfg.LANGFUSE_PUBLIC_KEY && cfg.LANGFUSE_SECRET_KEY) {
          sinks.push(
            new LangfuseSink({ host: cfg.LANGFUSE_HOST, publicKey: cfg.LANGFUSE_PUBLIC_KEY, secretKey: cfg.LANGFUSE_SECRET_KEY }),
          );
        }
        return new Tracer(sinks, { inPerM: cfg.LLM_PRICE_IN_PER_M, outPerM: cfg.LLM_PRICE_OUT_PER_M });
      },
    },
  ],
  exports: [TRACER],
})
export class TracingModule {}
