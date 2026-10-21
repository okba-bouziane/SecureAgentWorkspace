import { Inject, Injectable } from "@nestjs/common";
import pgvector from "pgvector";
import { EMBEDDER, PG_POOL, TRACER } from "../common/tokens.js";
import type { Pool } from "../db/db.js";
import { MetricsService } from "../metrics/metrics.service.js";
import type { Tracer } from "../tracing/tracer.js";
import type { Embedder } from "./embeddings.js";
import { rerank } from "./rerank.js";
import { reciprocalRankFusion } from "./rrf.js";
import { toTsQuery } from "./text.js";

export interface SearchHit {
  chunkId: number;
  documentId: string;
  title: string;
  ordinal: number;
  content: string;
  suspicious: boolean;
  ftsRank: number | null;
  vectorRank: number | null;
  ftsScore: number | null;
  vectorScore: number | null;
  fusedScore: number;
  rerankScore: number;
}

export interface SearchOptions {
  k?: number;
  /** Candidates fetched from each retriever before fusion. */
  candidates?: number;
}

interface Row {
  id: string;
  document_id: string;
  title: string;
  ordinal: number;
  content: string;
  suspicious: boolean;
  score: number;
}

@Injectable()
export class RagService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(EMBEDDER) private readonly embedder: Embedder,
    @Inject(TRACER) private readonly tracer: Tracer,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  /** Hybrid search: Postgres full-text + pgvector, fused with RRF, then reranked. */
  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const k = opts.k ?? 5;
    const candidates = opts.candidates ?? 20;
    const stop = this.metrics.searchLatency.startTimer();
    try {
      return await this.tracer.span(
        "rag.hybrid_search",
        "retrieval",
        async (h) => {
          const [embedding] = await this.tracer.span("rag.embed_query", "embedding", () => this.embedder.embed([query]));
          if (!embedding) return [];
          const tsQuery = toTsQuery(query);

          const [fts, vec] = await Promise.all([
            this.tracer.span("rag.fulltext", "retrieval", () => this.fullText(tsQuery, candidates)),
            this.tracer.span("rag.vector", "retrieval", () => this.vector(embedding, candidates)),
          ]);

          const fused = reciprocalRankFusion([
            { name: "fts", ids: fts.map((r) => Number(r.id)) },
            { name: "vector", ids: vec.map((r) => Number(r.id)) },
          ]);
          const byId = new Map<number, Row>();
          for (const r of [...vec, ...fts]) byId.set(Number(r.id), r);
          const ftsScores = new Map(fts.map((r) => [Number(r.id), r.score]));
          const vecScores = new Map(vec.map((r) => [Number(r.id), r.score]));

          const items = fused.slice(0, candidates).flatMap((f) => {
            const row = byId.get(f.id);
            return row
              ? [{ id: f.id, title: row.title, content: row.content, fusedScore: f.score, row, ranks: f.ranks }]
              : [];
          });
          const top = rerank(query, items, k);
          h.setAttributes({ query, ftsCandidates: fts.length, vectorCandidates: vec.length, returned: top.length });
          return top.map(({ item, rerankScore }): SearchHit => ({
            chunkId: item.id,
            documentId: item.row.document_id,
            title: item.row.title,
            ordinal: item.row.ordinal,
            content: item.row.content,
            suspicious: item.row.suspicious,
            ftsRank: item.ranks.fts ?? null,
            vectorRank: item.ranks.vector ?? null,
            ftsScore: ftsScores.get(item.id) ?? null,
            vectorScore: vecScores.get(item.id) ?? null,
            fusedScore: item.fusedScore,
            rerankScore,
          }));
        },
        { k },
      );
    } finally {
      stop();
    }
  }

  private async fullText(tsQuery: string | null, limit: number): Promise<Row[]> {
    if (!tsQuery) return [];
    const { rows } = await this.pool.query<Row>(
      `SELECT c.id, c.document_id, d.title, c.ordinal, c.content, c.suspicious,
              ts_rank_cd(c.tsv, q.query)::float8 AS score
         FROM chunks c
         JOIN documents d ON d.id = c.document_id AND d.status = 'ready',
              to_tsquery('english', $1) AS q(query)
        WHERE c.tsv @@ q.query
        ORDER BY score DESC, c.id
        LIMIT $2`,
      [tsQuery, limit],
    );
    return rows;
  }

  private async vector(embedding: number[], limit: number): Promise<Row[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT c.id, c.document_id, d.title, c.ordinal, c.content, c.suspicious,
              (1 - (c.embedding <=> $1::vector))::float8 AS score
         FROM chunks c JOIN documents d ON d.id = c.document_id AND d.status = 'ready'
        ORDER BY c.embedding <=> $1::vector, c.id
        LIMIT $2`,
      [pgvector.toSql(embedding), limit],
    );
    return rows;
  }
}
