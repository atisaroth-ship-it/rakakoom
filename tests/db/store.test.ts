import type { Db } from '../../src/db/db.js';
import { migrate } from '../../src/db/migrate.js';
import { applyRun, stageItems } from '../../src/db/store.js';
import { parseFeedRow, type ParsedItem } from '../../src/feed/parseRow.js';
import { makeFeedRecord } from '../helpers/feedRecord.js';
import { createTestDb } from '../helpers/testDb.js';

let db: Db;
let collectedDays: string[] = [];
beforeEach(async () => { db = await createTestDb(); collectedDays = []; });
afterEach(async () => { await db.close(); });

function item(overrides: Record<string, string> = {}): ParsedItem {
  const r = parseFeedRow(makeFeedRecord(overrides));
  if (!r.ok) throw new Error(r.reason);
  return r.item;
}

let nextRun = 1;
/** Simulates one collected day; the previous collected day is the latest earlier date passed here. */
async function runDay(feedDate: string, items: ParsedItem[]) {
  const runId = nextRun++;
  const prev = collectedDays.filter(d => d < feedDate).sort().at(-1) ?? null;
  if (!collectedDays.includes(feedDate)) collectedDays.push(feedDate);
  await stageItems(db, runId, items);
  return db.transaction(tx => applyRun(tx, runId, feedDate, prev));
}

const spans = async (modelId = 445195501093) =>
  (await db.query<{ start: string; last: string; price: number }>(
    `select to_char(effective_date, 'YYYY-MM-DD') as start, to_char(last_seen, 'YYYY-MM-DD') as last, price_satang as price
       from price_changes where model_id = $1 order by effective_date`, [modelId])).rows;

const history = async () =>
  (await db.query<{ model_id: number; effective_date: string; price_satang: number }>(
    `select model_id, to_char(effective_date, 'YYYY-MM-DD') as effective_date, price_satang
       from price_changes order by model_id, effective_date`)).rows;

test('first sighting writes one price_changes row', async () => {
  await runDay('2026-10-27', [item()]);
  expect(await history()).toEqual([{ model_id: 445195501093, effective_date: '2026-10-27', price_satang: 36000 }]);
});

test('unchanged price next day writes nothing new but bumps last_seen', async () => {
  await runDay('2026-10-27', [item()]);
  await runDay('2026-10-28', [item()]);
  expect(await history()).toHaveLength(1);
  const v = await db.query<{ last_seen: string; first_seen: string }>(
    `select to_char(last_seen,'YYYY-MM-DD') as last_seen, to_char(first_seen,'YYYY-MM-DD') as first_seen from variants`);
  expect(v.rows).toEqual([{ last_seen: '2026-10-28', first_seen: '2026-10-27' }]);
});

test('changed price writes a new row', async () => {
  await runDay('2026-10-27', [item()]);
  await runDay('2026-10-28', [item({ model_prices: '329.0' })]);
  expect((await history()).map(h => [h.effective_date, h.price_satang])).toEqual([['2026-10-27', 36000], ['2026-10-28', 32900]]);
});

test('price returning to an older value is recorded', async () => {
  await runDay('2026-10-27', [item()]);
  await runDay('2026-10-28', [item({ model_prices: '329.0' })]);
  await runDay('2026-10-29', [item()]);
  expect((await history()).map(h => h.price_satang)).toEqual([36000, 32900, 36000]);
});

test('same-day rerun replaces that day instead of duplicating', async () => {
  await runDay('2026-10-27', [item()]);
  await runDay('2026-10-27', [item({ model_prices: '350.0' })]);
  expect(await history()).toEqual([{ model_id: 445195501093, effective_date: '2026-10-27', price_satang: 35000 }]);
});

test('applyRun dedupes repeated model_id', async () => {
  const stats = await runDay('2026-10-27', [item(), item()]);
  expect(await history()).toHaveLength(1);
  expect(stats).toEqual({ items: 1, variants: 1, priceChanges: 1 });
});

test('applyRun clears staging for the run', async () => {
  await runDay('2026-10-27', [item()]);
  const s = await db.query<{ n: number }>('select (select count(*) from staging_items) + (select count(*) from staging_variants) as n');
  expect(Number(s.rows[0]!.n)).toBe(0);
});

test('stores shop and item fields', async () => {
  await runDay('2026-10-27', [item()]);
  const shop = await db.query('select shop_id, shop_name, shop_rating, penalty_score, is_official, is_preferred, holiday_mode from shops');
  expect(shop.rows).toEqual([{ shop_id: 101487342, shop_name: 'กัปตัน เอกสตีล', shop_rating: '4.93', penalty_score: '0', is_official: false, is_preferred: true, holiday_mode: false }]);
  const it = await db.query<{ brand: string }>('select brand from items');
  expect(it.rows).toEqual([{ brand: 'Ingco(อิงโก้)' }]);
});

test('consecutive days at the same price extend one span', async () => {
  await runDay('2026-10-27', [item()]);
  await runDay('2026-10-28', [item()]);
  expect(await spans()).toEqual([{ start: '2026-10-27', last: '2026-10-28', price: 36000 }]);
});

test('a day missing from the feed breaks the span even at the same price', async () => {
  const other = item({ itemid: '7', model_ids: '70' });
  await runDay('2026-10-27', [item(), other]);
  await runDay('2026-10-28', [other]);
  await runDay('2026-10-29', [item(), other]);
  expect(await spans()).toEqual([
    { start: '2026-10-27', last: '2026-10-27', price: 36000 },
    { start: '2026-10-29', last: '2026-10-29', price: 36000 },
  ]);
});

test('same-day rerun with a new price undoes the earlier extension', async () => {
  await runDay('2026-10-27', [item()]);
  await runDay('2026-10-28', [item()]);
  await runDay('2026-10-28', [item({ model_prices: '350.0' })]);
  expect(await spans()).toEqual([
    { start: '2026-10-27', last: '2026-10-27', price: 36000 },
    { start: '2026-10-28', last: '2026-10-28', price: 35000 },
  ]);
});

test('odd numeric values do not abort the apply', async () => {
  await runDay('2026-10-27', [item({ seller_penalty_score: '1.5', shop_rating: '12.5', item_rating: '10', item_sold: '3000000000', stock: '3000000000' })]);
  const s = await db.query<{ penalty_score: string; shop_rating: string }>('select penalty_score, shop_rating from shops');
  expect(s.rows).toEqual([{ penalty_score: '1.5', shop_rating: '12.5' }]);
  const it = await db.query<{ item_sold: number }>('select item_sold from items');
  expect(it.rows).toEqual([{ item_sold: 3000000000 }]);
});

test('migrate is idempotent', async () => {
  await migrate(db);
  await migrate(db);
});
