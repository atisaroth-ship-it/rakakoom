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

test('Xtra shop codes show a separate price only when they beat the platform codes', () => {
  // ฿10,000 non-Mall: platform 17% capped 3000 → ฿7,000; Xtra 30% → ฿8,000; Xtra 33% x3 (cap 1,111) → ฿9,630 per piece,
  // so no Xtra row
  expect(estimateCodes(10000 * B, false, '2026-11-09')!.xtra).toBeNull();
  // ฿3,000 non-Mall: platform 22% capped 2000 → ฿2,340; Xtra 30% → ฿2,100 wins
  const e = estimateCodes(3000 * B, false, '2026-11-09')!;
  expect(e.everyone!.priceSatang).toBe(2340 * B);
  expect(e.xtra).toMatchObject({ priceSatang: 2100 * B, code: { percent: 30 } });
  const last = codeRows(e).at(-1)!;
  expect(last.left).toBe('ถ้าร้านนี้ร่วม Xtra');
  expect(last.note).toContain('เฉพาะร้านที่ร่วม Xtra');
});

test('Xtra 33% needs 3 pieces and is shown per piece; the 11-minute 20% code counts for big prices', () => {
  // ฿20 x3 = 60, 33% = 19.8 (cap 1111) → 40.2/3 = ฿13.40 per piece; platform codes need ฿200 minimum
  const small = estimateCodes(20 * B, false, '2026-11-09')!;
  expect(small.xtra).toMatchObject({ priceSatang: 1340, code: { percent: 33, minQty: 3 } });
  const row = codeRows(small).at(-1)!;
  expect(row.left).toBe('ถ้าซื้อ 3 ชิ้น ที่ร้านร่วม Xtra');
  expect(row.right).toBe('฿13.40/ชิ้น');
  // ฿20,000 non-Mall: platform 17% capped 3000 → ฿17,000; Xtra 20% (min 1,111) → ฿16,000 wins, with its time condition
  const big = estimateCodes(20000 * B, false, '2026-11-09')!;
  expect(big.xtra).toMatchObject({ priceSatang: 16000 * B, code: { percent: 20 } });
  expect(codeRows(big).at(-1)!.note).toContain('11 นาทีทอง');
});
