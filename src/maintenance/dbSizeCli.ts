import { createPgDb } from '../db/pg.js';
import { waitForDb } from '../db/waitForDb.js';

// Read-only report: how much space each table and index takes. Changes nothing (no migrations, no deletes).
const url = process.env.DATABASE_URL;
if (!url) throw new Error('missing DATABASE_URL');
const db = createPgDb(url);
const mb = (b: unknown) => `${(Number(b) / 1048576).toFixed(1)} MB`;
try {
  await waitForDb(db);
  const total = (await db.query<{ size: string }>('select pg_database_size(current_database()) as size')).rows[0];
  console.log(`database total: ${mb(total?.size)}`);

  const tables = (await db.query<{ name: string; total: string; heap: string; idx: string; rows: string }>(
    `select c.relname as name, pg_total_relation_size(c.oid) as total, pg_relation_size(c.oid) as heap,
            pg_indexes_size(c.oid) as idx, c.reltuples::bigint as rows
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by pg_total_relation_size(c.oid) desc`)).rows;
  console.log('\ntables (total = data + indexes + toast):');
  for (const t of tables) console.log(`  ${t.name.padEnd(24)} total ${mb(t.total).padStart(10)}  data ${mb(t.heap).padStart(10)}  indexes ${mb(t.idx).padStart(10)}  ~rows ${t.rows}`);

  const indexes = (await db.query<{ name: string; table: string; size: string }>(
    `select indexrelname as name, relname as table, pg_relation_size(indexrelid) as size
       from pg_stat_user_indexes order by pg_relation_size(indexrelid) desc limit 12`)).rows;
  console.log('\nlargest indexes:');
  for (const i of indexes) console.log(`  ${i.name.padEnd(36)} on ${i.table.padEnd(20)} ${mb(i.size).padStart(10)}`);

  const runs = (await db.query<{ feed_date: string; status: string; rows_kept: string }>(
    'select feed_date::text, status, rows_kept from feed_runs order by id desc limit 8')).rows;
  console.log('\nlast feed runs:');
  for (const r of runs) console.log(`  ${r.feed_date}  ${r.status.padEnd(8)} rows_kept ${r.rows_kept}`);
} finally {
  await db.close();
}
