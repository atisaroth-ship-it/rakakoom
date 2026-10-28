import type { Db } from '../db/db.js';
import { buildReplyCard } from './card.js';
import { buildLatestCard, loadLatestPrice } from './latest.js';
import { extractShopeeUrls, type ItemRef } from './links.js';
import { findSameModel } from './match.js';
import { loadItemReport, type ItemReport, type VariantReport } from './report.js';

export interface LineEvent {
  type: string;
  replyToken?: string;
  message?: { type: string; text?: string };
  postback?: { data: string };
  source?: { type: string; userId?: string };
}

export interface BotDeps {
  db: Db;
  affiliateId: string;
  reply: (replyToken: string, messages: unknown[]) => Promise<void>;
  resolve: (url: string) => Promise<ItemRef | null>;
}

/** LINE quick replies allow at most 13 buttons; labels at most 20 characters. */
const MAX_CHOICES = 13;

const HOW_TO = 'วางลิงก์สินค้า Shopee มาในแชทได้เลย ราคาคุ้มจะบอกราคาตอนนี้ ราคาต่ำสุดที่เคยบันทึก ร้านอื่นที่ขายรุ่นเดียวกันถูกกว่า และร้านไหนน่าไว้ใจ';
const WELCOME = `ยินดีต้อนรับสู่ราคาคุ้ม 🛍️\n${HOW_TO}\n\nตอนนี้ดูได้: มือถือ เครื่องใช้ไฟฟ้า คอม กล้อง เครื่องเสียง เกม เครื่องมือบ้านและสวน เครื่องใช้ไฟฟ้าสัตว์เลี้ยง ทรายแมว และอาหารสัตว์ 7 กก. ขึ้นไป`;
const NO_DATA = 'ยังไม่มีข้อมูลสินค้านี้ 🙏 ราคาคุ้มเก็บราคาสินค้ายอดนิยมจากหมวดที่รองรับทุกวัน จดไว้แล้วว่ามีคนอยากรู้ราคาชิ้นนี้';
const UNREADABLE = 'อ่านลิงก์นี้ไม่ได้ ลองกด "แชร์" ในแอป Shopee แล้วคัดลอกลิงก์สินค้ามาวางใหม่อีกครั้งนะ';

/** By code point, so an emoji is never split. */
const firstChars = (s: string, n: number) => [...s].slice(0, n).join('');

const textMessage = (text: string, extra: Record<string, unknown> = {}) => ({ type: 'text', text, ...extra });

async function answerVariant(report: ItemReport, variant: VariantReport, deps: BotDeps, token: string) {
  const alternatives = await findSameModel(deps.db, report, variant);
  await deps.reply(token, [buildReplyCard({ report, variant, alternatives, affiliateId: deps.affiliateId })]);
}

async function answerItem(ref: ItemRef, deps: BotDeps, token: string) {
  const report = await loadItemReport(deps.db, ref.itemId);
  if (!report || report.variants.length === 0) {
    await deps.db.query('insert into link_requests (item_id, shop_id) values ($1, $2)', [ref.itemId, ref.shopId])
      .catch(err => console.error('link_requests insert failed', err));
    const latest = await loadLatestPrice(deps.db, ref.itemId).catch(err => {
      console.error('latest price lookup failed', err);
      return null;
    });
    await deps.reply(token, [latest ? buildLatestCard(latest, deps.affiliateId) : textMessage(NO_DATA)]);
    return;
  }
  if (report.variants.length === 1) {
    await answerVariant(report, report.variants[0]!, deps, token);
    return;
  }
  const choices = [...report.variants].sort((a, b) => a.priceSatang - b.priceSatang).slice(0, MAX_CHOICES);
  await deps.reply(token, [textMessage('สินค้านี้มีหลายแบบ เลือกแบบที่สนใจ 👇', {
    quickReply: { items: choices.map(v => ({
      type: 'action',
      action: { type: 'postback', label: firstChars(v.name, 20), data: `variant:${report.itemId}:${v.modelId}`, displayText: firstChars(v.name, 300) },
    })) },
  })]);
}

export async function handleEvent(ev: LineEvent, deps: BotDeps): Promise<void> {
  const token = ev.replyToken;
  if (!token) return;
  if (ev.type === 'follow') {
    await deps.reply(token, [textMessage(WELCOME)]);
    return;
  }
  if (ev.type === 'postback' && ev.postback) {
    const m = /^variant:(\d+):(\d+)$/.exec(ev.postback.data);
    if (!m) return;
    const report = await loadItemReport(deps.db, Number(m[1]));
    const variant = report?.variants.find(v => v.modelId === Number(m[2]));
    if (report && variant) await answerVariant(report, variant, deps, token);
    else await deps.reply(token, [textMessage(NO_DATA)]);
    return;
  }
  if (ev.type === 'message' && ev.message?.type === 'text') {
    const url = extractShopeeUrls(ev.message.text ?? '')[0];
    if (!url) {
      await deps.reply(token, [textMessage(HOW_TO)]);
      return;
    }
    const ref = await deps.resolve(url);
    if (!ref) {
      // Host and path only (no query string) so the cause can be found in the logs.
      try {
        const u = new URL(url);
        console.log('unreadable link', u.host + u.pathname);
      } catch { /* not a URL */ }
      await deps.reply(token, [textMessage(UNREADABLE)]);
      return;
    }
    await answerItem(ref, deps, token);
  }
}

/** LINE webhook signature: base64(HMAC-SHA256(channel secret, raw body)). */
export async function verifySignature(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
