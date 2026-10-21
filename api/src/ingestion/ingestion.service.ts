import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Queue } from "bullmq";
import { CONFIG, INGEST_DLQ, INGEST_QUEUE, PG_POOL } from "../common/tokens.js";
import type { Config } from "../config.js";
import type { Pool } from "../db/db.js";
import { jobOptions, type DeadLetterData, type IngestJobData } from "./queue.js";

export interface SubmitResult {
  id: string;
  status: string;
  duplicate: boolean;
}

@Injectable()
export class IngestionService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(INGEST_QUEUE) private readonly queue: Queue<IngestJobData>,
    @Inject(INGEST_DLQ) private readonly dlq: Queue<DeadLetterData>,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  /**
   * Idempotent by content hash: submitting the same text twice returns the
   * existing document instead of indexing it again. A failed document is re-queued.
   */
  async submit(input: { title: string; content: string; source?: string; userSub: string }): Promise<SubmitResult> {
    const hash = createHash("sha256").update(input.content).digest("hex");
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO documents (title, source, content_hash, uploaded_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (content_hash) DO NOTHING RETURNING id`,
      [input.title, input.source ?? null, hash, input.userSub],
    );
    if (inserted.rows[0]) {
      await this.enqueue(inserted.rows[0].id, input.title, input.content, 1);
      return { id: inserted.rows[0].id, status: "queued", duplicate: false };
    }
    const existing = await this.pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM documents WHERE content_hash=$1`,
      [hash],
    );
    const doc = existing.rows[0];
    if (!doc) throw new Error("Document vanished during submit");
    if (doc.status === "failed") {
      await this.pool.query(`UPDATE documents SET status='queued', error=NULL, updated_at=now() WHERE id=$1`, [doc.id]);
      await this.enqueue(doc.id, input.title, input.content, Date.now());
      return { id: doc.id, status: "queued", duplicate: false };
    }
    return { id: doc.id, status: doc.status, duplicate: true };
  }

  private async enqueue(documentId: string, title: string, content: string, run: number): Promise<void> {
    await this.queue.add(
      "ingest",
      { documentId, title, content },
      { ...jobOptions(this.cfg.INGEST_ATTEMPTS, this.cfg.INGEST_BACKOFF_MS), jobId: `doc-${documentId}-${run}` },
    );
  }

  async list() {
    const { rows } = await this.pool.query(
      `SELECT id, title, source, status, error, chunk_count AS "chunkCount", suspicious,
              uploaded_by AS "uploadedBy", created_at AS "createdAt"
         FROM documents ORDER BY created_at DESC LIMIT 200`,
    );
    return rows;
  }

  async deadLetters() {
    const jobs = await this.dlq.getJobs(["waiting", "completed", "delayed", "active"], 0, 50);
    return jobs.map((j) => j.data);
  }
}
