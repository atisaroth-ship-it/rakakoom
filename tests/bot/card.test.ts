import { shopBadge } from '../../src/bot/badge.js';
import { buildReplyCard, thaiDate, baht } from '../../src/bot/card.js';
import { verdict } from '../../src/bot/verdict.js';
import type { Alternative } from '../../src/bot/match.js';
import type { ItemReport, ShopInfo } from '../../src/bot/report.js';

const shop = (o: Partial<ShopInfo> = {}): ShopInfo => ({
  shopId: 10, name: 'ร้านดี', rating: 4.9, penaltyScore: 0, isOfficial: false, isPreferred: true, holidayMode: false, ...o,
});

test('shopBadge: green for preferred/mall with no penalty and high rating', () => {
  expect(shopBadge(shop(), 100000, []).level).toBe('green');
});

test('shopBadge: red for penalty, holiday, low rating, or suspiciously cheap', () => {
  expect(shopBadge(shop({ penaltyScore: 2 }), 100000, []).level).toBe('red');
  expect(shopBadge(shop({ holidayMode: true }), 100000, []).level).toBe('red');
  expect(shopBadge(shop({ rating: 3.9 }), 100000, []).level).toBe('red');
  const r = shopBadge(shop(), 60000, [100000, 100000, 110000]);
  expect(r.level).toBe('red');
  expect(r.reason).toContain('ถูกกว่าร้านอื่น');
});

test('shopBadge: yellow otherwise, with a reason line', () => {
  const r = shopBadge(shop({ isPreferred: false }), 100000, []);
  expect(r.level).toBe('yellow');
  expect(r.reason).toMatch(/คะแนน 4\.9/);
});

test('verdict: ok within 5% of the recorded low, wait otherwise; always bounded by the start date', () => {
  const v = (now: number, low: number) => ({ modelId: 1, name: 'x', priceSatang: now, lastSeen: '2026-10-28',
    low: { priceSatang: low, date: '2026-10-27' }, high: { priceSatang: now, date: '2026-10-26' } });
  const ok = verdict(v(104000, 100000), '2026-10-26');
  expect(ok).toMatchObject({ kind: 'ok', title: 'ราคานี้โอเคแล้ว' });
  expect(ok.detail).toContain('ตั้งแต่เริ่มบันทึก 26 ต.ค.');
  const wait = verdict(v(110000, 100000), '2026-10-26');
  expect(wait).toMatchObject({ kind: 'wait', title: 'มีช่วงที่ราคาถูกกว่านี้' });
  expect(wait.detail).toContain('฿1,000');
  expect(wait.detail).toContain('27 ต.ค.');
});

test('formatting helpers', () => {
  expect(baht(1149000)).toBe('฿11,490');
  expect(baht(1999)).toBe('฿19.99');
  expect(thaiDate('2026-11-11')).toBe('11 พ.ย.');
});

const report: ItemReport = {
  itemId: 1, shopId: 10, title: 'Sony WH-1000XM5 หูฟังไร้สาย', brand: 'Sony', category1: 'Audio', imageLink: 'https://cf.shopee.co.th/file/abc',
  itemSold: 120, shop: shop({ name: 'ร้านที่วางมา' }), firstRecorded: '2026-10-26', latestRecorded: '2026-10-28',
  variants: [{ modelId: 11, name: 'Black', priceSatang: 1149000, lastSeen: '2026-10-28',
    low: { priceSatang: 1099000, date: '2026-10-27' }, high: { priceSatang: 1199000, date: '2026-10-26' } }],
};
const alt = (o: Partial<Alternative>): Alternative => ({
  itemId: 2, shopId: 20, title: 'Sony WH-1000XM5', variantName: 'Black', priceSatang: 1050000, lastSeen: '2026-10-28', shop: shop({ shopId: 20, name: 'ร้านถูก' }), ...o,
});

test('card: buy button goes to the cheapest non-red shop with the affiliate id', () => {
  const msg = buildReplyCard({ report, variant: report.variants[0]!, alternatives: [alt({}), alt({ itemId: 3, shopId: 30, priceSatang: 600000, shop: shop({ shopId: 30, name: 'ร้านเสี่ยง', penaltyScore: 5 }) })], affiliateId: '15311240105' });
  const json = JSON.stringify(msg);
  expect(msg.type).toBe('flex');
  expect(msg.altText).toContain('Sony WH-1000XM5');
  const uri = (json.match(/"uri":"([^"]+)"/) ?? [])[1]!;
  expect(uri).toContain('origin_link=https%3A%2F%2Fshopee.co.th%2Fproduct%2F20%2F2');
  expect(uri).toContain('affiliate_id=15311240105');
  expect(json).toContain('ร้านเสี่ยง');      // risky cheaper shop is shown...
  expect(json).toContain('เสี่ยงโดนยกเลิก'); // ...with its warning
  expect(json).toContain('ยังไม่มีข้อมูลโค้ด');
  expect(json).toContain('ตั้งแต่เริ่มบันทึก 26 ต.ค.');
});

test('card: without a cheaper match it says so and links the pasted shop', () => {
  const msg = buildReplyCard({ report, variant: report.variants[0]!, alternatives: [], affiliateId: '15311240105' });
  const json = JSON.stringify(msg);
  expect(json).toContain('ยังหารุ่นที่ตรงเป๊ะจากร้านอื่นไม่เจอ');
  expect(json).toContain('origin_link=https%3A%2F%2Fshopee.co.th%2Fproduct%2F10%2F1');
});

test('card: an older price is labelled with its date', () => {
  const stale = { ...report.variants[0]!, lastSeen: '2026-10-26' };
  const json = JSON.stringify(buildReplyCard({ report, variant: stale, alternatives: [], affiliateId: '1' }));
  expect(json).toContain('ราคาล่าสุดที่บันทึกได้ 26 ต.ค.');
});

test('card text is shortened without splitting emoji', () => {
  const long = { ...report, title: 'ก'.repeat(78) + '😺😺😺 หูฟัง' };
  const json = JSON.stringify(buildReplyCard({ report: long, variant: long.variants[0]!, alternatives: [], affiliateId: '1' }));
  expect(json.isWellFormed()).toBe(true);
  expect(JSON.parse(json).contents.body.contents[0].text.isWellFormed()).toBe(true);
});
