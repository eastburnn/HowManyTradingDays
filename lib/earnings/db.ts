/**
 * Postgres access for the earnings pipeline and pages.
 *
 * One `pg` pool per process. Locally this points at the direct/session
 * connection; on Vercel it must be the Supavisor transaction pooler
 * (port 6543), which is what makes a serverless function safe to open
 * connections from. Keep the pool tiny — the pooler does the real pooling.
 *
 * The pooler admits 200 clients. A burst of page renders across many
 * function instances (a scraper sweeping ticker pages right after a deploy
 * emptied the page cache, Oct 14, 2026) can fill that for a few seconds, so
 * idle connections are let go quickly and a query that finds the pooler
 * full waits briefly and tries again instead of failing the page.
 */

import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL is not set");
  pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 2_000,
    connectionTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

const POOLER_FULL = /max client conn|EMAXCONN|too many clients|remaining connection slots/i;
const RETRY_DELAYS_MS = [150, 400, 900];

/** Retry a connection-level failure that a moment later would not happen */
async function withPoolerRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const message = (err as Error)?.message ?? "";
      if (attempt >= RETRY_DELAYS_MS.length || !POOLER_FULL.test(message)) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt] + Math.random() * 100));
    }
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await withPoolerRetry(() => getPool().query<T>(text, params));
  return result.rows;
}

/** Run `fn` inside a transaction; rolls back on throw. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await withPoolerRetry(() => getPool().connect());
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
