import pg from "pg";
import { SCHEMA_SQL } from "./schema.js";

export type Pool = pg.Pool;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

/** Applies the schema. An advisory lock keeps api and worker from racing on startup. */
export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query(SCHEMA_SQL);
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => undefined);
    client.release();
  }
}
