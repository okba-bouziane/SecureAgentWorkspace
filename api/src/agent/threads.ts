import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthUser } from "../auth/jwt-verifier.js";
import { PG_POOL } from "../common/tokens.js";
import type { Pool } from "../db/db.js";

const TITLE_LENGTH = 80;
const THREAD_LIST_LIMIT = 50;

/** The `threads` table: who owns a conversation. Message content lives in the LangGraph checkpoint. */
@Injectable()
export class ThreadStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async listFor(user: AuthUser) {
    const { rows } = await this.pool.query(
      `SELECT id, title, updated_at AS "updatedAt" FROM threads WHERE user_sub=$1 ORDER BY updated_at DESC LIMIT $2`,
      [user.sub, THREAD_LIST_LIMIT],
    );
    return rows;
  }

  /** Whether the thread exists. Throws NotFound when it belongs to someone else, so ids cannot be probed. */
  async exists(threadId: string, user: AuthUser): Promise<boolean> {
    const { rows } = await this.pool.query<{ user_sub: string }>(`SELECT user_sub FROM threads WHERE id=$1`, [threadId]);
    if (!rows[0]) return false;
    if (rows[0].user_sub !== user.sub) throw new NotFoundException("Thread not found");
    return true;
  }

  async assertOwner(threadId: string, user: AuthUser): Promise<void> {
    if (!(await this.exists(threadId, user))) throw new NotFoundException("Thread not found");
  }

  async create(threadId: string, user: AuthUser, firstMessage: string): Promise<void> {
    await this.pool.query(`INSERT INTO threads (id, user_sub, title) VALUES ($1,$2,$3)`, [
      threadId,
      user.sub,
      firstMessage.slice(0, TITLE_LENGTH),
    ]);
  }

  async touch(threadId: string): Promise<void> {
    await this.pool.query(`UPDATE threads SET updated_at=now() WHERE id=$1`, [threadId]);
  }
}
