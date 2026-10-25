import { Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser } from "../auth/auth.guard.js";
import type { AuthUser } from "../auth/jwt-verifier.js";
import { PG_POOL } from "../common/tokens.js";
import type { Pool } from "../db/db.js";
import { isAdmin } from "../auth/roles.js";

@Controller("traces")
@UseGuards(AuthGuard)
export class TracingController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Admins see every trace, everyone else sees their own. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query("limit") limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const all = isAdmin(user);
    const { rows } = await this.pool.query(
      `SELECT t.id, t.username, t.thread_id AS "threadId", t.name, t.status, t.started_at AS "startedAt",
              t.duration_ms AS "durationMs",
              COUNT(s.id)::int AS "spanCount",
              COALESCE(SUM(s.input_tokens),0)::int AS "inputTokens",
              COALESCE(SUM(s.output_tokens),0)::int AS "outputTokens",
              COALESCE(SUM(s.cost_usd),0)::float8 AS "costUsd"
         FROM traces t LEFT JOIN spans s ON s.trace_id = t.id
        WHERE ($1::boolean OR t.user_sub = $2)
        GROUP BY t.id ORDER BY t.started_at DESC LIMIT $3`,
      [all, user.sub, n],
    );
    return { traces: rows };
  }

  @Get(":id")
  async get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const trace = await this.pool.query(
      `SELECT id, user_sub AS "userSub", username, thread_id AS "threadId", name, status,
              started_at AS "startedAt", duration_ms AS "durationMs" FROM traces WHERE id = $1`,
      [id],
    );
    const row = trace.rows[0];
    if (!row) throw new NotFoundException("Trace not found");
    if (row.userSub !== user.sub && !isAdmin(user)) throw new ForbiddenException();
    const spans = await this.pool.query(
      `SELECT id, parent_id AS "parentId", name, kind, status, started_at AS "startedAt",
              duration_ms AS "durationMs", attributes, input_tokens AS "inputTokens",
              output_tokens AS "outputTokens", cost_usd::float8 AS "costUsd"
         FROM spans WHERE trace_id = $1 ORDER BY started_at, duration_ms DESC`,
      [id],
    );
    return { trace: row, spans: spans.rows };
  }
}
