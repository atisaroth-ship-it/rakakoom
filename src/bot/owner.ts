import type { Db } from '../db/db.js';
import type { PlatformCode } from './codes.js';
import { baht, thaiDate } from './format.js';
import { extractShopeeUrls, type ItemRef } from './links.js';

/**
 * Owner-only LINE commands (the LINE user ids in ADMIN_LINE_USER_ID):
 *   บันทึก <link> 4990 แฟลชเซลล์+โค้ด30%   a price really paid or seen (flash sale + codes the feed never shows)
 *   ลบบันทึก <link>                         removes the recorded prices of that product
 *   โค้ด 30% ขั้นต่ำ 0 ลดสูงสุด 1500 ถึง 31/10 [mall]   a platform code; every card counts it until that day
 *   โค้ด                                     lists today's codes
 *   ลบโค้ด <number>                          removes one
 */
export const OWNER_COMMAND = /^(บันทึก|ลบบันทึก|โค้ด|ลบโค้ด)(\s|$)/;

export interface RecordedPrice {
  priceSatang: number;
  note: string;
  date: string;
}

/** The lowest price the owner recorded for this product (latest first on a tie). */
export async function loadRecordedPrice(db: Db, itemId: number): Promise<RecordedPrice | null> {
  const r = (await db.query<Record<string, unknown>>(
    `select price_satang, note, to_char(recorded_on, 'YYYY-MM-DD') as recorded_on
       from recorded_prices where item_id = $1 order by price_satang, recorded_on desc, id desc limit 1`, [itemId])).rows[0];
  return r ? { priceSatang: Number(r.price_satang), note: String(r.note), date: String(r.recorded_on) } : null;
}

interface DailyCodeRow {
  id: number;
  percent: number;
  minSatang: number;
  capSatang: number;
  mallOnly: boolean;
  until: string;
}

const codeLabel = (c: { percent: number; mallOnly: boolean }) => `โค้ดที่บันทึก ลด ${c.percent}%${c.mallOnly ? ' (Mall)' : ''}`;

async function dailyCodeRows(db: Db, today: string): Promise<DailyCodeRow[]> {
  return (await db.query<Record<string, unknown>>(
    `select id, percent, min_satang, cap_satang, mall_only, to_char(valid_until, 'YYYY-MM-DD') as valid_until
       from daily_codes where valid_from <= $1::date and $1::date <= valid_until order by id`, [today])).rows
    .map(r => ({ id: Number(r.id), percent: Number(r.percent), minSatang: Number(r.min_satang), capSatang: Number(r.cap_satang),
      mallOnly: Boolean(r.mall_only), until: String(r.valid_until) }));
}

/** Codes valid today, ready for the code estimate. */
export async function loadDailyCodes(db: Db, today: string): Promise<PlatformCode[]> {
  return (await dailyCodeRows(db, today)).map(c => ({
    label: codeLabel(c), percent: c.percent, minSatang: c.minSatang, capSatang: c.capSatang, ...(c.mallOnly ? { mallOnly: true } : {}),
  }));
}

/** "4,990" / "฿4990.50" → satang. */
const toSatang = (s: string) => Math.round(Number(s.replace(/[,฿]/g, '')) * 100);

/**
 * d/m, d/m/yy or d/m/yyyy; a two-digit or 25xx year is Buddhist Era (69 = 2569 = 2026).
 * Without a year, a day already past means next year's.
 */
export function parseDayMonth(s: string, today: string): string | null {
  const m = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(s);
  if (!m) return null;
  let year = Number(today.slice(0, 4));
  if (m[3]) {
    let y = Number(m[3]);
    if (y < 100) y += 2500;
    year = y > 2400 ? y - 543 : y;
  }
  const make = (y: number) => {
    const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
    return d.getUTCDate() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 ? d.toISOString().slice(0, 10) : null;
  };
  const iso = make(year);
  return iso && !m[3] && iso < today ? make(year + 1) : iso;
}

export interface CodeInput {
  percent: number;
  minSatang: number;
  capSatang: number;
  mallOnly: boolean;
  until: string;
}

const CODE_HOW = 'พิมพ์แบบนี้: โค้ด 30% ขั้นต่ำ 0 ลดสูงสุด 1500 ถึง 31/10\n(ถ้าเป็นโค้ดเฉพาะ Mall ใส่คำว่า mall ต่อท้าย ถ้าไม่ใส่ "ถึง" จะใช้ได้แค่วันนี้)';

export function parseCode(text: string, today: string): CodeInput | string {
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(text);
  const cap = /สูงสุด\s*฿?\s*([\d,]+(?:\.\d+)?)/.exec(text);
  const min = /ขั้นต่ำ\s*฿?\s*([\d,]+(?:\.\d+)?)/.exec(text);
  const untilText = /ถึง\s*(\S+)/.exec(text);
  if (!pct || !cap) return `ต้องมีเปอร์เซ็นต์และลดสูงสุด\n${CODE_HOW}`;
  const percent = Number(pct[1]);
  if (!(percent > 0 && percent <= 100)) return `เปอร์เซ็นต์ต้องอยู่ระหว่าง 1–100\n${CODE_HOW}`;
  const until = untilText ? parseDayMonth(untilText[1]!, today) : today;
  if (!until) return `อ่านวันที่ไม่ออก ใช้แบบ 31/10 หรือ 31/10/69\n${CODE_HOW}`;
  if (until < today) return 'วันที่ "ถึง" ผ่านไปแล้ว';
  return { percent, minSatang: min ? toSatang(min[1]!) : 0, capSatang: toSatang(cap[1]!), mallOnly: /mall|มอล/i.test(text), until };
}

export interface RecordInput {
  url: string;
  priceSatang: number;
  note: string;
}

const RECORD_HOW = 'พิมพ์แบบนี้: บันทึก <ลิงก์สินค้า> 4990 แฟลชเซลล์+โค้ด30%';

export function parseRecord(text: string): RecordInput | string {
  const url = extractShopeeUrls(text)[0];
  if (!url) return `ไม่เจอลิงก์สินค้า Shopee\n${RECORD_HOW}`;
  const rest = text.replace(/^บันทึก/, '').replace(url, ' ').trim();
  const m = /^฿?\s*([\d,]+(?:\.\d+)?)\s*(?:บาท)?\s*(.*)$/s.exec(rest);
  if (!m) return `ไม่เจอราคา\n${RECORD_HOW}`;
  const priceSatang = toSatang(m[1]!);
  if (!(priceSatang > 0)) return `ราคาต้องมากกว่า 0\n${RECORD_HOW}`;
  return { url, priceSatang, note: m[2]!.trim().slice(0, 100) };
}

export interface OwnerDeps {
  db: Db;
  resolve: (url: string) => Promise<ItemRef | null>;
  today: string;
}

const UNREADABLE = 'อ่านลิงก์นี้ไม่ได้ ลองกด "แชร์" ในแอป Shopee แล้วคัดลอกลิงก์สินค้ามาใหม่';

/** The reply to an owner command (OWNER_COMMAND already matched). */
export async function ownerReply(said: string, deps: OwnerDeps): Promise<string> {
  const [cmd = ''] = said.split(/\s/, 1);
  const { db, today } = deps;

  if (cmd === 'โค้ด') {
    if (said.trim() === 'โค้ด') {
      const codes = await dailyCodeRows(db, today);
      if (!codes.length) return `วันนี้ยังไม่มีโค้ดที่บันทึกไว้\n${CODE_HOW}`;
      return ['โค้ดที่ใช้ได้วันนี้:',
        ...codes.map(c => `#${c.id} ${codeLabel(c)} ขั้นต่ำ ${baht(c.minSatang)} ลดสูงสุด ${baht(c.capSatang)} ถึง ${thaiDate(c.until)}`),
        'ลบ: พิมพ์ ลบโค้ด <เลข>'].join('\n');
    }
    const c = parseCode(said, today);
    if (typeof c === 'string') return c;
    const id = (await db.query<{ id: number }>(
      `insert into daily_codes (percent, min_satang, cap_satang, mall_only, valid_from, valid_until)
       values ($1, $2, $3, $4, $5, $6) returning id`, [c.percent, c.minSatang, c.capSatang, c.mallOnly, today, c.until])).rows[0]!.id;
    return `บันทึกโค้ด #${id} แล้ว: ${codeLabel(c)} ขั้นต่ำ ${baht(c.minSatang)} ลดสูงสุด ${baht(c.capSatang)} ใช้ได้ถึง ${thaiDate(c.until)}\nการ์ดราคาทุกสินค้าจะคิดราคาหลังโค้ดนี้ให้`;
  }

  if (cmd === 'ลบโค้ด') {
    const id = /\d+/.exec(said.slice(cmd.length))?.[0];
    if (!id) return 'พิมพ์ ลบโค้ด <เลข> (ดูเลขได้จากคำว่า โค้ด)';
    const gone = (await db.query('delete from daily_codes where id = $1 returning id', [Number(id)])).rows.length;
    return gone ? `ลบโค้ด #${id} แล้ว` : `ไม่เจอโค้ด #${id}`;
  }

  if (cmd === 'บันทึก') {
    const r = parseRecord(said);
    if (typeof r === 'string') return r;
    const ref = await deps.resolve(r.url);
    if (!ref) return UNREADABLE;
    await db.query('insert into recorded_prices (item_id, shop_id, price_satang, note, recorded_on) values ($1, $2, $3, $4, $5)',
      [ref.itemId, ref.shopId, r.priceSatang, r.note, today]);
    return `บันทึกแล้ว: ${baht(r.priceSatang)}${r.note ? ` (${r.note})` : ''} วันที่ ${thaiDate(today)}\nการ์ดของสินค้านี้จะขึ้นเป็น "เคยซื้อได้จริง" (ถ้ามีหลายครั้ง จะโชว์ครั้งที่ถูกสุด)`;
  }

  // ลบบันทึก
  const url = extractShopeeUrls(said)[0];
  if (!url) return 'พิมพ์ ลบบันทึก <ลิงก์สินค้า>';
  const ref = await deps.resolve(url);
  if (!ref) return UNREADABLE;
  const n = (await db.query('delete from recorded_prices where item_id = $1 returning id', [ref.itemId])).rows.length;
  return n ? `ลบราคาที่บันทึกไว้ของสินค้านี้แล้ว ${n} รายการ` : 'สินค้านี้ยังไม่มีราคาที่บันทึกไว้';
}
