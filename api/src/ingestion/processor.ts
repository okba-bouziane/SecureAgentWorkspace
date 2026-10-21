import type { Pool } from "../db/db.js";
import { detectInjection } from "../guardrails/injection.js";
import { chunkMarkdown } from "../rag/chunker.js";
import type { Embedder } from "../rag/embeddings.js";
import pgvector from "pgvector";
import type { IngestJobData } from "./queue.js";

export interface ProcessResult {
  chunks: number;
  suspiciousChunks: number;
}

/**
 * Chunk + embed + store one document. Safe to run more than once for the same
 * document: the chunks are replaced inside a single transaction, so a retry
 * after a crash never leaves duplicates or a half-written document.
 */
export async function processIngestion(pool: Pool, embedder: Embedder, data: IngestJobData): Promise<ProcessResult> {
  await pool.query(`UPDATE documents SET status='processing', error=NULL, updated_at=now() WHERE id=$1`, [data.documentId]);

  const chunks = chunkMarkdown(data.title, data.content);
  if (chunks.length === 0) throw new Error("Document has no text to index");
  const vectors = await embedder.embed(chunks.map((c) => c.content));
  const flags = chunks.map((c) => {
    const v = detectInjection(c.content);
    return v.matches.length > 0 && v.score >= 4;
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM chunks WHERE document_id=$1`, [data.documentId]);
    for (const [i, chunk] of chunks.entries()) {
      const vector = vectors[i];
      if (!vector) throw new Error("Embedder returned fewer vectors than chunks");
      await client.query(
        `INSERT INTO chunks (document_id, ordinal, content, suspicious, embedding) VALUES ($1,$2,$3,$4,$5::vector)`,
        [data.documentId, chunk.ordinal, chunk.content, flags[i], pgvector.toSql(vector)],
      );
    }
    const suspicious = flags.filter(Boolean).length;
    await client.query(
      `UPDATE documents SET status='ready', chunk_count=$2, suspicious=$3, error=NULL, updated_at=now() WHERE id=$1`,
      [data.documentId, chunks.length, suspicious > 0],
    );
    await client.query("COMMIT");
    return { chunks: chunks.length, suspiciousChunks: suspicious };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
