import "reflect-metadata";
import { createServer } from "node:http";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Queue } from "bullmq";
import { CONFIG, EMBEDDER, INGEST_DLQ, PG_POOL } from "./common/tokens.js";
import type { Config } from "./config.js";
import type { Pool } from "./db/db.js";
import { InfraModule } from "./infra.module.js";
import { createBullConnection, type DeadLetterData } from "./ingestion/queue.js";
import { startIngestionWorker } from "./ingestion/worker.js";
import { MetricsModule } from "./metrics/metrics.module.js";
import { MetricsService } from "./metrics/metrics.service.js";
import type { Embedder } from "./rag/embeddings.js";

@Module({ imports: [InfraModule, MetricsModule] })
class WorkerModule {}

async function main(): Promise<void> {
  const log = new Logger("Worker");
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ["log", "warn", "error"] });
  app.enableShutdownHooks();
  const cfg = app.get<Config>(CONFIG);
  const metrics = app.get(MetricsService);
  const connection = createBullConnection(cfg.REDIS_URL);
  const worker = startIngestionWorker({
    pool: app.get<Pool>(PG_POOL),
    embedder: app.get<Embedder>(EMBEDDER),
    connection,
    deadLetters: app.get<Queue<DeadLetterData>>(INGEST_DLQ),
    metrics,
    concurrency: cfg.INGEST_CONCURRENCY,
    log: (m) => log.log(m),
  });

  // Small HTTP endpoint for Prometheus and Kubernetes probes.
  const port = cfg.WORKER_METRICS_PORT;
  const server = createServer((req, res) => {
    if (req.url === "/metrics") {
      void metrics.render().then((body) => {
        res.setHeader("Content-Type", "text/plain; version=0.0.4");
        res.end(body);
      });
    } else {
      res.end("ok");
    }
  }).listen(port);

  log.log(`Ingestion worker running (concurrency ${cfg.INGEST_CONCURRENCY}), metrics on :${port}`);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.log(`${signal} received, finishing active jobs`);
    setTimeout(() => process.exit(1), 25_000).unref();
    await worker.close(); // waits for the jobs currently running
    server.close();
    await connection.quit();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main();
