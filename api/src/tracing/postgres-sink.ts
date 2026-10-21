import type { Pool } from "../db/db.js";
import type { SpanRecord, SpanSink, TraceRecord } from "./types.js";

export class PostgresSink implements SpanSink {
  constructor(private readonly pool: Pool) {}

  async startTrace(t: TraceRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO traces (id, user_sub, username, thread_id, name, status, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [t.id, t.userSub, t.username ?? null, t.threadId ?? null, t.name, t.status, t.startedAt],
    );
  }

  async writeSpan(s: SpanRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO spans (id, trace_id, parent_id, name, kind, status, started_at, duration_ms, attributes, input_tokens, output_tokens, cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [s.id, s.traceId, s.parentId, s.name, s.kind, s.status, s.startedAt, s.durationMs, JSON.stringify(s.attributes), s.inputTokens, s.outputTokens, s.costUsd],
    );
  }

  async endTrace(t: TraceRecord): Promise<void> {
    await this.pool.query(`UPDATE traces SET status=$2, ended_at=$3, duration_ms=$4 WHERE id=$1`, [
      t.id,
      t.status,
      t.endedAt ?? new Date(),
      t.durationMs ?? null,
    ]);
  }
}
