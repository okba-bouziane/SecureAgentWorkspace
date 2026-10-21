import type { Queue } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { migrate } from "../src/db/db.js";
import { IngestionService } from "../src/ingestion/ingestion.service.js";
import { createBullConnection, createDeadLetterQueue, createIngestQueue, type DeadLetterData, type IngestJobData } from "../src/ingestion/queue.js";
import { startIngestionWorker } from "../src/ingestion/worker.js";
import { MetricsService } from "../src/metrics/metrics.service.js";
import { HashEmbedder, TEST_DATABASE_URL, TEST_REDIS_URL, testPool } from "./helpers.js";

const enabled = Boolean(TEST_DATABASE_URL && TEST_REDIS_URL);

async function waitFor<T>(fn: () => Promise<T | undefined | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!enabled)("BullMQ ingestion", () => {
  const pool = testPool();
  const embedder = new HashEmbedder();
  const metrics = new MetricsService();
  const cfg = { ...loadConfig({}), INGEST_ATTEMPTS: 3, INGEST_BACKOFF_MS: 50 };
  let conn: ReturnType<typeof createBullConnection>;
  let queue: Queue<IngestJobData>;
  let dlq: Queue<DeadLetterData>;
  let service: IngestionService;
  let worker: ReturnType<typeof startIngestionWorker>;

  beforeAll(async () => {
    await migrate(pool);
    conn = createBullConnection(TEST_REDIS_URL!);
    queue = createIngestQueue(conn);
    dlq = createDeadLetterQueue(conn);
    service = new IngestionService(pool, queue, dlq, cfg);
    worker = startIngestionWorker({ pool, embedder, connection: createBullConnection(TEST_REDIS_URL!), deadLetters: dlq, metrics, concurrency: 2 });
  });
  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await dlq.obliterate({ force: true });
    await pool.query("TRUNCATE documents CASCADE");
    embedder.failures = 0;
  });
  afterAll(async () => {
    await worker.close();
    await queue.close();
    await dlq.close();
    await conn.quit();
    await pool.end();
  });

  const status = async (id: string) => (await pool.query(`SELECT status, chunk_count, error FROM documents WHERE id=$1`, [id])).rows[0];
  const doc = (n: string) => ({ title: `Doc ${n}`, content: `# Doc ${n}\n\nSample text about topic ${n} that is long enough to index.`, userSub: "u" });

  it("chunks, embeds and stores a document", async () => {
    const r = await service.submit(doc("a"));
    expect(r).toMatchObject({ status: "queued", duplicate: false });
    const row = await waitFor(async () => {
      const s = await status(r.id);
      return s.status === "ready" ? s : false;
    });
    expect(row.chunk_count).toBeGreaterThan(0);
  });

  it("is idempotent: the same content is indexed once", async () => {
    const a = await service.submit(doc("b"));
    const b = await service.submit(doc("b"));
    expect(b).toMatchObject({ id: a.id, duplicate: true });
    await waitFor(async () => (await status(a.id)).status === "ready");
    const n = await pool.query(`SELECT count(*)::int AS n FROM documents`);
    expect(n.rows[0].n).toBe(1);
  });

  it("retries with backoff and then succeeds", async () => {
    embedder.failures = 2;
    const r = await service.submit(doc("c"));
    await waitFor(async () => (await status(r.id)).status === "ready");
    const job = (await queue.getJobs(["completed"]))[0];
    expect(job?.attemptsMade).toBe(3);
  });

  it("moves a job that keeps failing to the dead-letter queue and marks the document failed", async () => {
    embedder.failures = 99;
    const r = await service.submit(doc("d"));
    await waitFor(async () => (await status(r.id)).status === "failed");
    const dead = await waitFor(async () => {
      const list = await service.deadLetters();
      return list.length ? list : false;
    });
    expect(dead[0]).toMatchObject({ documentId: r.id, attempts: 3, error: "embedder unavailable" });
    expect((await status(r.id)).error).toBe("embedder unavailable");
  });

  it("re-queues a failed document when it is submitted again", async () => {
    embedder.failures = 99;
    const r = await service.submit(doc("e"));
    await waitFor(async () => (await status(r.id)).status === "failed");
    embedder.failures = 0;
    const again = await service.submit(doc("e"));
    expect(again).toMatchObject({ id: r.id, duplicate: false });
    await waitFor(async () => (await status(r.id)).status === "ready");
  });
});
