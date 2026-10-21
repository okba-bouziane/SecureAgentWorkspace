import { Worker, type Job, type Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Pool } from "../db/db.js";
import type { MetricsService } from "../metrics/metrics.service.js";
import type { Embedder } from "../rag/embeddings.js";
import { processIngestion } from "./processor.js";
import { INGEST_QUEUE_NAME, type DeadLetterData, type IngestJobData } from "./queue.js";

export interface WorkerDeps {
  pool: Pool;
  embedder: Embedder;
  connection: Redis;
  deadLetters: Queue<DeadLetterData>;
  metrics: MetricsService;
  concurrency: number;
  log?: (msg: string) => void;
}

/** Consumes the ingestion queue. Jobs that exhaust their retries land in the dead-letter queue. */
export function startIngestionWorker(deps: WorkerDeps): Worker<IngestJobData> {
  const log = deps.log ?? (() => undefined);
  const worker = new Worker<IngestJobData>(
    INGEST_QUEUE_NAME,
    async (job: Job<IngestJobData>) => {
      log(`ingest ${job.data.documentId} attempt ${job.attemptsMade + 1}`);
      return processIngestion(deps.pool, deps.embedder, job.data);
    },
    { connection: deps.connection, concurrency: deps.concurrency },
  );

  worker.on("completed", () => deps.metrics.ingestionJobs.inc({ outcome: "completed" }));

  worker.on("failed", (job, err) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      deps.metrics.ingestionJobs.inc({ outcome: "retried" });
      log(`ingest ${job.data.documentId} failed (attempt ${job.attemptsMade}/${maxAttempts}), will retry: ${err.message}`);
      return;
    }
    deps.metrics.ingestionJobs.inc({ outcome: "dead_lettered" });
    void (async () => {
      await deps.pool.query(`UPDATE documents SET status='failed', error=$2, updated_at=now() WHERE id=$1`, [
        job.data.documentId,
        err.message.slice(0, 500),
      ]);
      await deps.deadLetters.add("dead-letter", {
        documentId: job.data.documentId,
        title: job.data.title,
        error: err.message,
        attempts: job.attemptsMade,
        failedAt: new Date().toISOString(),
      });
      log(`ingest ${job.data.documentId} moved to dead-letter queue`);
    })();
  });

  return worker;
}
