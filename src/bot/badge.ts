import type { ShopInfo } from './report.js';

export type BadgeLevel = 'green' | 'yellow' | 'red';

export interface Badge {
  level: BadgeLevel;
  label: string;
  reason: string;
}

const LABEL: Record<BadgeLevel, string> = {
  green: '🟢 ร้านนี้ส่งของจริงเป็นส่วนใหญ่',
  yellow: '🟡 ควรระวัง',
  red: '🔴 เสี่ยงโดนยกเลิก',
};

/** Too far below the same model elsewhere usually means a fake listing or a cancel. */
const SUSPICIOUS_DISCOUNT = 0.3;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Spec 11: shop warning from feed signals (penalty score, rating, Mall/Preferred, holiday mode, price vs peers). */
export function shopBadge(shop: ShopInfo, priceSatang: number, peerPricesSatang: number[]): Badge {
  const facts: string[] = [];
  if (shop.isOfficial) facts.push('Mall');
  else if (shop.isPreferred) facts.push('Preferred');
  if (shop.rating !== null) facts.push(`คะแนน ${shop.rating.toFixed(1)}`);
  if (shop.penaltyScore) facts.push(`คะแนนโทษ ${shop.penaltyScore}`);

  const red: string[] = [];
  if ((shop.penaltyScore ?? 0) >= 2) red.push(`คะแนนโทษผู้ขาย ${shop.penaltyScore}`);
  if (shop.holidayMode) red.push('ร้านปิดพักอยู่');
  if (shop.rating !== null && shop.rating < 4.0) red.push(`คะแนนร้าน ${shop.rating.toFixed(1)}`);
  if (peerPricesSatang.length >= 2) {
    const m = median(peerPricesSatang);
    if (priceSatang < (1 - SUSPICIOUS_DISCOUNT) * m) red.push(`ถูกกว่าร้านอื่นที่ขายรุ่นเดียวกัน ${Math.round((1 - priceSatang / m) * 100)}%`);
  }
  if (red.length) return { level: 'red', label: LABEL.red, reason: red.join(' · ') };

  const green = (shop.isOfficial || shop.isPreferred) && (shop.penaltyScore ?? 0) === 0 && (shop.rating ?? 0) >= 4.7;
  const level: BadgeLevel = green ? 'green' : 'yellow';
  return { level, label: LABEL[level], reason: facts.join(' · ') || 'ข้อมูลร้านยังน้อย' };
}
