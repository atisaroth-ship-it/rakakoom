import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

export async function migrate(db: Db): Promise<void> {
  await db.query('create table if not exists schema_migrations (name text primary key)');
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).rows.map(r => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter(f => f.endsWith('.sql')).sort();
  for (const name of files) {
    if (done.has(name)) continue;
    const sql = await readFile(MIGRATIONS_DIR + name, 'utf8');
    await db.transaction(async tx => {
      for (const stmt of splitSql(sql)) await tx.query(stmt);
      await tx.query('insert into schema_migrations (name) values ($1)', [name]);
    });
  }
}

// Our migrations hold no ';' inside strings or function bodies, so splitting on a trailing ';' is safe.
function splitSql(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, '')
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(Boolean);
}
