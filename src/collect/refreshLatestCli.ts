import { loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPgDb } from '../db/pg.js';
import { waitForDb } from '../db/waitForDb.js';
import { openFeed } from '../feed/openFeed.js';
import { refreshLatestPrices } from './refreshLatest.js';

const config = loadConfig(process.env);
const db = createPgDb(config.databaseUrl);
try {
  await waitForDb(db);
  await migrate(db);
  const r = await refreshLatestPrices({ db, feedUrls: config.feedUrls, openFeed: url => openFeed(url), now: () => new Date(), keepDays: config.latestPriceDays });
  console.log(JSON.stringify(r));
} finally {
  await db.close();
}
