import type { Db } from './db.js';

export async function databaseSizeBytes(db: Db): Promise<number> {
  const r = await db.query<{ n: string | number }>('select pg_database_size(current_database()) as n');
  return Number(r.rows[0]!.n);
}
