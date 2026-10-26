import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../../src/db/db.js';

type Q = Pick<PGlite, 'query'>;

function wrap(q: Q, root: PGlite, inTx: boolean): Db {
  return {
    query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await q.query<T>(sql, params)).rows }),
    transaction: async fn => (inTx ? fn(wrap(q, root, true)) : root.transaction(tx => fn(wrap(tx, root, true)))),
    close: async () => { await root.close(); },
  };
}

export async function createTestDb(): Promise<Db> {
  const pg = new PGlite();
  return wrap(pg, pg, false);
}
