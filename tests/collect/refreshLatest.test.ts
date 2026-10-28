import type { Db } from '../../src/db/db.js';
import { refreshLatestPrices } from '../../src/collect/refreshLatest.js';
import type { FeedRecord } from '../../src/feed/columns.js';
import { makeFeedRecord } from '../helpers/feedRecord.js';
import { createTestDb } from '../helpers/testDb.js';

let db: Db;
beforeEach(async () => { db = await createTestDb(); });
afterEach(async () => { await db.close(); });

const feed = (rows: FeedRecord[]) => (async function* () { yield* rows; })();

test('fills latest prices for every branded row without touching history or feed_runs', async () => {
  const r = await refreshLatestPrices({
    db, feedUrls: ['u1'], openFeed: () => feed([makeFeedRecord({ itemid: '1' }), makeFeedRecord({ itemid: '2', global_brand: 'NoBrand' }), makeFeedRecord({ itemid: '3' })]),
    now: () => new Date('2026-10-28T08:00:00Z'), keepDays: 4,
  });
  expect(r).toEqual({ feedDate: '2026-10-28', rowsRead: 3, saved: 2 });
  expect((await db.query('select item_id from latest_prices order by item_id')).rows.map(x => Number((x as { item_id: number }).item_id))).toEqual([1, 3]);
  expect((await db.query('select * from feed_runs')).rows).toHaveLength(0);
  expect((await db.query('select * from price_changes')).rows).toHaveLength(0);
});
