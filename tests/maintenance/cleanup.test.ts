import type { Db } from '../../src/db/db.js';
import { applyRun, stageItems } from '../../src/db/store.js';
import { parseFeedRow, type ParsedItem } from '../../src/feed/parseRow.js';
import type { CategoryScope } from '../../src/feed/scope.js';
import { cleanupOutOfScope } from '../../src/maintenance/cleanup.js';
import { makeFeedRecord } from '../helpers/feedRecord.js';
import { createTestDb } from '../helpers/testDb.js';

let db: Db;
beforeEach(async () => { db = await createTestDb(); });
afterEach(async () => { await db.close(); });

const scope: CategoryScope = {
  rules: [
    { name: 'audio', category1: ['Audio'], minSold: 10 },
    { name: 'pet-food', category1: ['Pets'], category2: ['Pet Food'], minSold: 10, minKg: 7 },
  ],
};

const item = (o: Record<string, string>): ParsedItem => {
  const r = parseFeedRow(makeFeedRecord(o));
  if (!r.ok) throw new Error(r.reason);
  return r.item;
};

async function seed(items: ParsedItem[]) {
  await stageItems(db, 1, items);
  await db.transaction(tx => applyRun(tx, 1, '2026-10-27', null));
}

const ids = async (sql: string) => (await db.query<{ id: number }>(sql)).rows.map(r => Number(r.id)).sort((a, b) => a - b);

test('removes items, variants, price rows and orphan shops that the scope no longer collects', async () => {
  await seed([
    item({ itemid: '1', shopid: '10', model_ids: '11', global_category1: 'Audio', item_sold: '12' }),
    item({ itemid: '2', shopid: '20', model_ids: '21', global_category1: 'Audio', item_sold: '3' }),
    item({ itemid: '3', shopid: '30', model_ids: '31', global_category1: 'Home & Living', item_sold: '500' }),
    item({ itemid: '4', shopid: '10', model_ids: '41|42', model_names: '1.5 กก.|10 กก.', model_prices: '200|900',
      global_category1: 'Pets', global_category2: 'Pet Food', title: 'อาหารแมว', item_sold: '20' }),
  ]);

  const r = await cleanupOutOfScope(db, scope);

  expect(r).toEqual({ itemsRemoved: 2, variantsRemoved: 3, priceRowsRemoved: 3, shopsRemoved: 2 });
  expect(await ids('select item_id as id from items')).toEqual([1, 4]);
  expect(await ids('select model_id as id from variants')).toEqual([11, 42]);
  expect(await ids('select model_id as id from price_changes')).toEqual([11, 42]);
  expect(await ids('select shop_id as id from shops')).toEqual([10]);
});

test('is a no-op when everything is in scope', async () => {
  await seed([item({ itemid: '1', model_ids: '11', global_category1: 'Audio', item_sold: '12' })]);
  expect(await cleanupOutOfScope(db, scope)).toEqual({ itemsRemoved: 0, variantsRemoved: 0, priceRowsRemoved: 0, shopsRemoved: 0 });
});
