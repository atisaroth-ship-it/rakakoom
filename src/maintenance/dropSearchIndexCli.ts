import { createPgDb } from '../db/pg.js';
import { waitForDb } from '../db/waitForDb.js';

// One-off: drop the 300 MB trigram search index on latest_prices to free space (the database hit its size limit).
// Name search in the bot keeps working without it, only slower. Nothing else is touched; migrations are not run.
// Recreate later (when there is room) with the "create index" statement in migrations/007_search_index.sql.
const url = process.env.DATABASE_URL;
if (!url) throw new Error('missing DATABASE_URL');
const db = createPgDb(url);
const mb = (b: unknown) => `${(Number(b) / 1048576).toFixed(1)} MB`;
const size = async () => (await db.query<{ size: string }>('select pg_database_size(current_database()) as size')).rows[0]?.size;
try {
  await waitForDb(db);
  const before = await size();
  const idx = (await db.query<{ size: string }>(
    `select pg_relation_size(c.oid) as size from pg_class c where c.relname = 'latest_prices_search' and c.relkind = 'i'`)).rows[0];
  console.log(`database before: ${mb(before)}; index latest_prices_search: ${idx ? mb(idx.size) : 'not found (already dropped)'}`);
  await db.query('drop index if exists latest_prices_search');
  const after = await size();
  console.log(`database after: ${mb(after)}`);
} finally {
  await db.close();
}
