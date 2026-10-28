import { bangkokToday, codeFootnote, codeRows, estimateCodes } from '../../src/bot/codes.js';

const B = 100;

test('outside the campaign days there is no code estimate', () => {
  expect(estimateCodes(1000 * B, false, '2026-11-12')).toBeNull();
  expect(codeRows(null)).toEqual([{ left: 'ราคาใช้โค้ด', right: 'ยังไม่มีข้อมูลโค้ด', note: '' }]);
});

test('non-Mall shop: best code everyone can use, and the VIP code when it beats it', () => {
  // ฿500: 22% → 110 off (cap 2000) beats 25% capped at 250? 25% of 500 = 125 → ฿375 wins; VIP 90% capped 150 → ฿350
  const e = estimateCodes(500 * B, false, '2026-10-29')!;
  expect(e.everyone).toMatchObject({ priceSatang: 375 * B, code: { percent: 25, capSatang: 250 * B } });
  expect(e.best).toMatchObject({ priceSatang: 350 * B, code: { percent: 90 } });
  const rows = codeRows(e);
  expect(rows[1]!.note).toContain('สมาชิก Shopee VIP');
});

test('Mall-only codes count only for Mall shops; caps apply', () => {
  // ฿20,000 at a Mall shop: 17% capped at 3000 → ฿17,000; Mall 25% capped at 2000 → ฿18,000
  expect(estimateCodes(20000 * B, true, '2026-11-11')!.everyone!.priceSatang).toBe(17000 * B);
  // ฿1,000 at Mall: Mall 30% capped at 300 → ฿700; non-Mall gets 25% capped at 250 → ฿750
  expect(estimateCodes(1000 * B, true, '2026-11-11')!.everyone!.priceSatang).toBe(700 * B);
  expect(estimateCodes(1000 * B, false, '2026-11-11')!.everyone!.priceSatang).toBe(750 * B);
});

test('below every minimum spend there is no code price, and the VIP row is hidden when it does not win', () => {
  const e = estimateCodes(100 * B, false, '2026-11-01')!;
  expect(e.everyone).toBeNull();
  expect(e.best).toBeNull();
  expect(codeRows(e)[0]!.right).toBe('ไม่ถึงขั้นต่ำ');
  expect(codeFootnote(e)).toContain('ราคาประเมิน');
  expect(codeFootnote(e)).toContain('ปี 68');
});

test('Bangkok date rolls over at 17:00 UTC', () => {
  expect(bangkokToday(new Date('2026-11-10T16:59:00Z'))).toBe('2026-11-10');
  expect(bangkokToday(new Date('2026-11-10T17:00:00Z'))).toBe('2026-11-11');
});
