import { migrate } from '../db/migrate.js';
import { createPgDb } from '../db/pg.js';
import { databaseSizeBytes } from '../db/size.js';
import { waitForDb } from '../db/waitForDb.js';
import { resetPriceHistory } from './resetHistory.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('missing DATABASE_URL');
const db = createPgDb(url);
const mb = (b: number) => `${Math.round(b / 1048576)} MB`;
try {
  await waitForDb(db);
  await migrate(db);
  const before = await databaseSizeBytes(db);
  const stats = await resetPriceHistory(db);
  const after = await databaseSizeBytes(db);
  console.log(JSON.stringify({ ...stats, sizeBefore: mb(before), sizeAfter: mb(after) }));
} finally {
  await db.close();
}
