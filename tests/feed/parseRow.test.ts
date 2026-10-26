import { parseFeedRow, toSatang } from '../../src/feed/parseRow.js';
import { makeFeedRecord } from '../helpers/feedRecord.js';

test('parses single-variant branded item', () => {
  const r = parseFeedRow(makeFeedRecord());
  expect(r.ok && r.item.variants).toEqual([{ modelId: 445195501093, name: expect.any(String), priceSatang: 36000 }]);
  expect(r.ok && r.item.shop).toMatchObject({ isOfficial: false, isPreferred: true, holidayMode: false, penaltyScore: 0, shopRating: 4.93 });
});

test.each(['NoBrand', 'No Brand', ' nobrand ', ''])('skips brand %j', b => {
  expect(parseFeedRow(makeFeedRecord({ global_brand: b }))).toEqual({ ok: false, reason: 'no_brand' });
});

test('splits variants and ignores trailing pipe', () => {
  const r = parseFeedRow(makeFeedRecord({ model_ids: '1|2|', model_names: '3W,แสงขาว|5W,แสงส้ม|', model_prices: '15.0|17.0|' }));
  expect(r.ok && r.item.variants.map(v => [v.modelId, v.name, v.priceSatang])).toEqual([[1, '3W,แสงขาว', 1500], [2, '5W,แสงส้ม', 1700]]);
});

test('variant count mismatch is skipped', () => {
  expect(parseFeedRow(makeFeedRecord({ model_ids: '1|2', model_names: 'a|b', model_prices: '15.0' }))).toEqual({ ok: false, reason: 'variant_mismatch' });
});

test('non-numeric itemid is bad_ids', () => {
  expect(parseFeedRow(makeFeedRecord({ itemid: '' }))).toEqual({ ok: false, reason: 'bad_ids' });
});

test('toSatang avoids float error', () => {
  expect(toSatang('19.99')).toBe(1999);
  expect(toSatang('abc')).toBeNull();
});
