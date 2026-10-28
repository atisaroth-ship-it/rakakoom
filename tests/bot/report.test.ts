import type { Db } from '../../src/db/db.js';
import { applyRun, stageItems } from '../../src/db/store.js';
import { findSameModel, modelTokens, normalizeVariant } from '../../src/bot/match.js';
import { loadItemReport } from '../../src/bot/report.js';
import { parseFeedRow, type ParsedItem } from '../../src/feed/parseRow.js';
import { makeFeedRecord } from '../helpers/feedRecord.js';
import { createTestDb } from '../helpers/testDb.js';

let db: Db;
let run = 1;
beforeEach(async () => { db = await createTestDb(); });
afterEach(async () => { await db.close(); });

const item = (o: Record<string, string>): ParsedItem => {
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

const sony = (o: Record<string, string> = {}) => item({
  itemid: '1', shopid: '10', global_brand: 'Sony', global_category1: 'Audio',
  title: 'Sony WH-1000XM5 หูฟังไร้สาย ตัดเสียงรบกวน', model_ids: '11|12', model_names: 'สีดำ|สีเงิน', model_prices: '11990|11990', ...o,
});

test('loadItemReport gives current price, low/high since recording, and dates', async () => {
  await day('2026-10-26', null, [sony()]);
  await day('2026-10-27', '2026-10-26', [sony({ model_prices: '10990|11990' })]);
  await day('2026-10-28', '2026-10-27', [sony({ model_prices: '11490|11990' })]);
  const r = await loadItemReport(db, 1);
  expect(r).toMatchObject({ itemId: 1, shopId: 10, brand: 'Sony', firstRecorded: '2026-10-26', latestRecorded: '2026-10-28' });
  expect(r!.variants[0]).toMatchObject({
    modelId: 11, name: 'สีดำ', priceSatang: 1149000, lastSeen: '2026-10-28',
    low: { priceSatang: 1099000, date: '2026-10-27' }, high: { priceSatang: 1199000, date: '2026-10-26' },
  });
  expect(r!.shop).toMatchObject({ shopId: 10, rating: 4.93, penaltyScore: 0, isPreferred: true });
});

test('loadItemReport returns null for an unknown item', async () => {
  expect(await loadItemReport(db, 999)).toBeNull();
});

test('modelTokens keeps model codes and drops sizes/units', () => {
  expect(modelTokens('Sony WH-1000XM5 หูฟังไร้สาย 30 ชม. 2024')).toEqual(['WH1000XM5']);
  expect(modelTokens('iPhone 15 Pro 128GB 256GB A3102')).toEqual(['A3102']);
  expect(modelTokens('Xiaomi Redmi Note 13 5G 8/256')).toEqual([]);
});

test('normalizeVariant treats Thai and English colour names alike', () => {
  expect(normalizeVariant('สีดำ')).toBe(normalizeVariant('Black'));
  expect(normalizeVariant(' Silver ')).toBe(normalizeVariant('สีเงิน'));
  expect(normalizeVariant('สีดำ')).not.toBe(normalizeVariant('สีขาว'));
});

test('findSameModel finds the same brand + model + variant in other shops, cheapest first', async () => {
  const other = (id: string, shop: string, prices: string, extra: Record<string, string> = {}) =>
    sony({ itemid: id, shopid: shop, model_ids: `${id}1|${id}2`, model_names: 'Black|Silver', model_prices: prices, ...extra });
  await day('2026-10-28', null, [
    sony(),
    other('2', '20', '10500|11000'),
    other('3', '30', '9990|12500'),
    other('4', '40', '8000|8000', { global_brand: 'Soni' }),                          // different brand
    other('5', '50', '8000|8000', { title: 'Sony WH-1000XM4 หูฟัง' }),                // different model
  ]);
  const r = (await loadItemReport(db, 1))!;
  const alts = await findSameModel(db, r, r.variants[0]!);
  expect(alts.map(a => [a.itemId, a.variantName, a.priceSatang])).toEqual([[3, 'Black', 999000], [2, 'Black', 1050000]]);
  expect(alts[0]!.shop.shopId).toBe(30);
});

test('findSameModel finds nothing when the title has no model code', async () => {
  await day('2026-10-28', null, [
    sony({ title: 'หูฟังไร้สาย Sony ตัดเสียงรบกวน' }),
    sony({ itemid: '2', shopid: '20', model_ids: '21|22', title: 'หูฟังไร้สาย Sony ตัดเสียงรบกวน', model_prices: '5000|5000' }),
  ]);
  const r = (await loadItemReport(db, 1))!;
  expect(await findSameModel(db, r, r.variants[0]!)).toEqual([]);
});
