import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "../src/db/db.js";
import { processIngestion } from "../src/ingestion/processor.js";
import { MetricsService } from "../src/metrics/metrics.service.js";
import { TransformersEmbedder } from "../src/rag/embeddings.js";
import { RagService } from "../src/rag/rag.service.js";
import { MemorySink } from "../src/tracing/memory-sink.js";
import { Tracer } from "../src/tracing/tracer.js";
import { TEST_DATABASE_URL, testPool } from "../tests/helpers.js";
import data from "./dataset.json" with { type: "json" };

/** Retrieval quality of the real pipeline: local embedding model + Postgres full-text + pgvector + RRF + rerank. */
describe.skipIf(!TEST_DATABASE_URL)("eval: retrieval", () => {
  const pool = testPool();
  const embedder = new TransformersEmbedder({ EMBEDDING_MODEL: "Xenova/all-MiniLM-L6-v2", HF_CACHE_DIR: process.env.HF_CACHE_DIR });
  let rag: RagService;

  beforeAll(async () => {
    await migrate(pool);
    await pool.query("TRUNCATE documents CASCADE");
    const dir = join(import.meta.dirname, "..", "seed");
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".md")).sort()) {
      const content = await readFile(join(dir, file), "utf8");
      const title = content.match(/^#\s+(.+)$/m)![1]!;
      const { rows } = await pool.query(`INSERT INTO documents (title, content_hash, uploaded_by) VALUES ($1, md5($2), 'eval') RETURNING id`, [title, content]);
      await processIngestion(pool, embedder, { documentId: rows[0].id, title, content });
    }
    rag = new RagService(pool, embedder, new Tracer([new MemorySink()], { inPerM: 0, outPerM: 0 }), new MetricsService());
  });
  afterAll(() => pool.end());

  it(`recall@3 >= ${data.thresholds.retrievalRecallAt3} and MRR >= ${data.thresholds.retrievalMrr}`, async () => {
    let hit3 = 0;
    let rr = 0;
    const misses: string[] = [];
    for (const c of data.retrieval) {
      const hits = await rag.search(c.q, { k: 5 });
      const rank = hits.findIndex((h) => c.expect.includes(h.title));
      if (rank >= 0 && rank < 3) hit3 += 1;
      else misses.push(c.q);
      if (rank >= 0) rr += 1 / (rank + 1);
    }
    const recall = hit3 / data.retrieval.length;
    const mrr = rr / data.retrieval.length;
    console.log(`[eval:retrieval] questions=${data.retrieval.length} recall@3=${recall.toFixed(3)} mrr=${mrr.toFixed(3)} misses=${JSON.stringify(misses)}`);
    expect(recall).toBeGreaterThanOrEqual(data.thresholds.retrievalRecallAt3);
    expect(mrr).toBeGreaterThanOrEqual(data.thresholds.retrievalMrr);
  });

  it("hybrid is not worse than either retriever alone", async () => {
    // Re-run with each retriever reduced to its own ranking by reading the per-hit ranks.
    let hybrid = 0;
    let ftsOnly = 0;
    let vecOnly = 0;
    for (const c of data.retrieval) {
      const hits = await rag.search(c.q, { k: 20, candidates: 20 });
      const top3 = hits.slice(0, 3).some((h) => c.expect.includes(h.title));
      const byFts = [...hits].filter((h) => h.ftsRank !== null).sort((a, b) => a.ftsRank! - b.ftsRank!).slice(0, 3);
      const byVec = [...hits].filter((h) => h.vectorRank !== null).sort((a, b) => a.vectorRank! - b.vectorRank!).slice(0, 3);
      if (top3) hybrid += 1;
      if (byFts.some((h) => c.expect.includes(h.title))) ftsOnly += 1;
      if (byVec.some((h) => c.expect.includes(h.title))) vecOnly += 1;
    }
    const n = data.retrieval.length;
    console.log(`[eval:retrieval] recall@3 hybrid=${(hybrid / n).toFixed(3)} fulltext-only=${(ftsOnly / n).toFixed(3)} vector-only=${(vecOnly / n).toFixed(3)}`);
    expect(hybrid).toBeGreaterThanOrEqual(Math.max(ftsOnly, vecOnly));
  });
});
