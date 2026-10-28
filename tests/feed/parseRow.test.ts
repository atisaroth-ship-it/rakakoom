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

test('strips NUL and repairs lone surrogates in every string, including attributes', () => {
  const r = parseFeedRow(makeFeedRecord({
    title: 'a\u0000b\uD83D',
    model_names: 'x\u0000y',
    global_item_attributes: '[{"formatted_value":"v\\u0000w\\ud83d"}]',
  }));
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.item.title).toBe('ab�');
  expect(r.item.variants[0]!.name).toBe('xy');
  expect(JSON.stringify(r.item.attributes)).not.toMatch(/\\u0000|\\ud83d/i);
  expect(JSON.stringify(r.item)).not.toContain('\u0000');
});

test('ids beyond safe integer range are bad_ids', () => {
  expect(parseFeedRow(makeFeedRecord({ itemid: '100000000000000000000' }))).toEqual({ ok: false, reason: 'bad_ids' });
  expect(parseFeedRow(makeFeedRecord({ model_ids: '100000000000000000000' }))).toEqual({ ok: false, reason: 'bad_ids' });
});

test('toSatang avoids float error', () => {
  expect(toSatang('19.99')).toBe(1999);
  expect(toSatang('abc')).toBeNull();
});

test('variant prices are the discounted price the app shows, not the list price', () => {
  const one = parseFeedRow(makeFeedRecord({ model_prices: '700.0', price: '700', sale_price: '599', discount_percentage: '14' }));
  expect(one.ok && one.item.variants[0]!.priceSatang).toBe(59900);
  const many = parseFeedRow(makeFeedRecord({ model_ids: '1|2', model_names: 'a|b', model_prices: '9170.0|12295.0', price: '9170', sale_price: '4690', discount_percentage: '49' }));
  expect(many.ok && many.item.variants.map(v => v.priceSatang)).toEqual([469000, 628828]);
  const none = parseFeedRow(makeFeedRecord({ model_prices: '360.0', price: '360', sale_price: '360', discount_percentage: '0' }));
  expect(none.ok && none.item.variants[0]!.priceSatang).toBe(36000);
});
