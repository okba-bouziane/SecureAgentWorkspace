import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { Queue } from "bullmq";
import { Redis } from "ioredis";
import { CONFIG, EMBEDDER, INGEST_DLQ, INGEST_QUEUE, PG_POOL, REDIS } from "./common/tokens.js";
import { loadConfig, type Config } from "./config.js";
import { createPool, migrate, type Pool } from "./db/db.js";
import { createBullConnection, createDeadLetterQueue, createIngestQueue } from "./ingestion/queue.js";
import { TransformersEmbedder } from "./rag/embeddings.js";

class Shutdown implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(INGEST_QUEUE) private readonly queue: Queue,
    @Inject(INGEST_DLQ) private readonly dlq: Queue,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.queue.close(), this.dlq.close()]);
    await Promise.allSettled([this.redis.quit(), this.pool.end()]);
  }
}

/** Shared infrastructure clients for the API and the worker. */
@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    {
      provide: PG_POOL,
      inject: [CONFIG],
      useFactory: async (cfg: Config) => {
        const pool = createPool(cfg.DATABASE_URL);
        await migrate(pool);
        return pool;
      },
    },
    { provide: REDIS, inject: [CONFIG], useFactory: (cfg: Config) => new Redis(cfg.REDIS_URL) },
    { provide: EMBEDDER, inject: [CONFIG], useFactory: (cfg: Config) => new TransformersEmbedder(cfg) },
    { provide: INGEST_QUEUE, inject: [CONFIG], useFactory: (cfg: Config) => createIngestQueue(createBullConnection(cfg.REDIS_URL)) },
    { provide: INGEST_DLQ, inject: [CONFIG], useFactory: (cfg: Config) => createDeadLetterQueue(createBullConnection(cfg.REDIS_URL)) },
    Shutdown,
  ],
  exports: [CONFIG, PG_POOL, REDIS, EMBEDDER, INGEST_QUEUE, INGEST_DLQ],
})
export class InfraModule {}
