import type { Db } from '../../src/db/db.js';
import { applyRun, stageItems, upsertLatestPrices } from '../../src/db/store.js';
import { loadItemReport } from '../../src/bot/report.js';
import { parseFeedRow, type ParsedItem } from '../../src/feed/parseRow.js';
import { resetPriceHistory } from '../../src/maintenance/resetHistory.js';
import { makeFeedRecord } from '../helpers/feedRecord.js';
import { createTestDb } from '../helpers/testDb.js';

let db: Db;
let run = 1;
beforeEach(async () => { db = await createTestDb(); });
afterEach(async () => { await db.close(); });

const item = (o: Record<string, string> = {}): ParsedItem => {
  const r = parseFeedRow(makeFeedRecord(o));
  if (!r.ok) throw new Error(r.reason);
  return r.item;
};
async function day(date: string, prev: string | null, items: ParsedItem[]) {
  const id = run++;
  await db.query(`insert into feed_runs (feed_date, status) values ($1, 'success')`, [date]);
  await stageItems(db, id, items);
  await db.transaction(tx => applyRun(tx, id, date, prev));
}
const count = async (t: string) => Number((await db.query<{ n: number }>(`select count(*) as n from ${t}`)).rows[0]!.n);

test('reset removes price history but keeps run bookkeeping and latest prices', async () => {
  await day('2026-10-27', null, [item()]);
  await upsertLatestPrices(db, '2026-10-27', [item()]);
  await db.query(`insert into link_requests (item_id, shop_id) values (1, 1)`);

  expect(await resetPriceHistory(db)).toEqual({ items: 1, variants: 1, priceChanges: 1, shops: 1 });
  for (const t of ['items', 'variants', 'price_changes', 'shops']) expect(await count(t)).toBe(0);
  expect(await count('feed_runs')).toBe(1);
  expect(await count('latest_prices')).toBe(1);
  expect(await count('link_requests')).toBe(1);
});

test('after a reset, the card counts history from the first day collected again', async () => {
  await day('2026-10-26', null, [item()]);
  await day('2026-10-27', '2026-10-26', [item()]);
  await resetPriceHistory(db);
  await day('2026-10-29', '2026-10-27', [item()]);
  expect(await loadItemReport(db, Number(item().itemId))).toMatchObject({ firstRecorded: '2026-10-29', latestRecorded: '2026-10-29' });
});
