import pg from 'pg';
import type { Db } from './db.js';

// bigint (int8) ของเราไม่เกิน 2^53 จึงคืนเป็น number
pg.types.setTypeParser(20, v => Number(v));

export function createPgDb(databaseUrl: string): Db {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  // An idle client dropping its connection emits 'error' on the pool; unhandled, it would crash the run.
  pool.on('error', err => console.error('postgres pool error', err));
  const wrap = (client: pg.Pool | pg.PoolClient): Db => ({
    query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await client.query(sql, params)).rows as T[] }),
    transaction: async fn => {
      if (client !== pool) return fn(wrap(client));
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(wrap(c));
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    },
    close: async () => { await pool.end(); },
  });
  return wrap(pool);
}
