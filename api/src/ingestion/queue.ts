import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

export const INGEST_QUEUE_NAME = "document-ingestion";
export const INGEST_DLQ_NAME = "document-ingestion-dlq";

export interface IngestJobData {
  documentId: string;
  title: string;
  content: string;
}

export interface DeadLetterData {
  documentId: string;
  title: string;
  error: string;
  attempts: number;
  failedAt: string;
}

/** BullMQ needs its own connection with blocking commands enabled. */
export function createBullConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function createIngestQueue(connection: Redis): Queue<IngestJobData> {
  return new Queue<IngestJobData>(INGEST_QUEUE_NAME, { connection });
}

export function createDeadLetterQueue(connection: Redis): Queue<DeadLetterData> {
  return new Queue<DeadLetterData>(INGEST_DLQ_NAME, { connection });
}

export function jobOptions(attempts: number, backoffMs: number): JobsOptions {
  return {
    attempts,
    backoff: { type: "exponential", delay: backoffMs },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: false,
  };
}
