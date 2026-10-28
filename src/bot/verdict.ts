import { baht, thaiDate } from './format.js';
import type { VariantReport } from './report.js';

export interface Verdict {
  kind: 'ok' | 'wait';
  title: string;
  detail: string;
}

/** Within this share above the recorded low counts as a good price (spec 6.5). */
const NEAR_LOW = 0.05;

/** Spec 6.5 / 11: never claims beyond what was recorded, so every line says since when. */
export function verdict(v: VariantReport, firstRecorded: string): Verdict {
  const since = `ตั้งแต่เริ่มบันทึก ${thaiDate(firstRecorded)}`;
  if (v.priceSatang <= v.low.priceSatang * (1 + NEAR_LOW)) {
    return { kind: 'ok', title: 'ราคานี้โอเคแล้ว', detail: `ใกล้ราคาต่ำสุดที่เห็น${since}` };
  }
  return {
    kind: 'wait',
    title: 'มีช่วงที่ราคาถูกกว่านี้',
    detail: `เคยลงถึง ${baht(v.low.priceSatang)} เมื่อ ${thaiDate(v.low.date)} (${since}) — รอได้ก็รอ`,
  };
}
