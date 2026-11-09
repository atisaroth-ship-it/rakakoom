import type { Db } from '../db/db.js';
import { buildReplyCard } from './card.js';
import { bangkokToday, type PlatformCode } from './codes.js';
import { buildLatestCard, loadLatestPrice } from './latest.js';
import { extractShopeeUrls, type ItemRef } from './links.js';
import { loadDeals } from './deals.js';
import { productCarousel } from './list.js';
import { findSameModel } from './match.js';
import { loadDailyCodes, loadRecordedPrice, OWNER_COMMAND, ownerReply, type RecordedPrice } from './owner.js';
import { loadItemReport, type ItemReport, type VariantReport } from './report.js';
import { searchProducts, searchWords } from './search.js';

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
  /** LINE user ids allowed to use the owner commands (บันทึก / โค้ด) */
  adminIds?: string[];
}

/** LINE quick replies allow at most 13 buttons; labels at most 20 characters. */
const MAX_CHOICES = 13;

const HOW_TO = 'วางลิงก์สินค้า Shopee มาในแชทได้เลย ราคาคุ้มจะบอกราคาตอนนี้ ราคาต่ำสุดที่เคยบันทึก ราคาหลังใช้โค้ด ร้านอื่นที่ขายรุ่นเดียวกันถูกกว่า และร้านไหนน่าไว้ใจ\n\nหรือพิมพ์ชื่อสินค้า เช่น "หูฟัง sony" เพื่อค้นหา หรือพิมพ์ "ดีลวันนี้" ดูของที่ราคาลดลงจริง';
const NO_RESULTS = 'ไม่เจอสินค้าที่ชื่อตรงกัน ลองพิมพ์ยี่ห้อหรือรุ่นให้สั้นลง เช่น "แอร์ daikin" หรือวางลิงก์สินค้า Shopee มาเลย';
const NO_DEALS = 'วันนี้ยังไม่เจอสินค้าที่ราคาลดลงจริงจากราคาที่บันทึกไว้ (ราคาคุ้มเทียบกับราคาที่เก็บเอง ไม่ใช่ราคาขีดฆ่าของร้าน) ลองใหม่พรุ่งนี้นะ';
const DEALS_WORDS = /^(ดีล|ดีลวันนี้|ดีลเด็ด|deal|deals)$/i;
/** Quick reply under answers, so the deals list is one tap away. */
const MENU = { quickReply: { items: [{ type: 'action', action: { type: 'message', label: 'ดีลวันนี้', text: 'ดีลวันนี้' } }] } };
const WELCOME = `ยินดีต้อนรับสู่ราคาคุ้ม 🛍️\n${HOW_TO}\n\nตอนนี้ดูได้: มือถือ เครื่องใช้ไฟฟ้า คอม กล้อง เครื่องเสียง เกม เครื่องมือบ้านและสวน เครื่องใช้ไฟฟ้าสัตว์เลี้ยง ทรายแมว และอาหารสัตว์ 7 กก. ขึ้นไป`;
const NO_DATA = 'ยังไม่มีข้อมูลสินค้านี้ 🙏 ราคาคุ้มเก็บราคาสินค้ายอดนิยมจากหมวดที่รองรับทุกวัน จดไว้แล้วว่ามีคนอยากรู้ราคาชิ้นนี้';
const UNREADABLE = 'อ่านลิงก์นี้ไม่ได้ ลองกด "แชร์" ในแอป Shopee แล้วคัดลอกลิงก์สินค้ามาวางใหม่อีกครั้งนะ';

/** By code point, so an emoji is never split. */
const firstChars = (s: string, n: number) => [...s].slice(0, n).join('');

const textMessage = (text: string, extra: Record<string, unknown> = {}) => ({ type: 'text', text, ...extra });

/** What the owner entered (today's codes, the price she recorded); a lookup failure only drops these lines. */
async function ownerEntries(deps: BotDeps, itemId: number, today: string): Promise<{ daily: PlatformCode[]; recorded: RecordedPrice | null }> {
  const [daily, recorded] = await Promise.all([
    loadDailyCodes(deps.db, today).catch(err => { console.error('daily codes lookup failed', err); return []; }),
    loadRecordedPrice(deps.db, itemId).catch(err => { console.error('recorded price lookup failed', err); return null; }),
  ]);
  return { daily, recorded };
}

async function answerVariant(report: ItemReport, variant: VariantReport, deps: BotDeps, token: string) {
  const today = bangkokToday();
  const [alternatives, owner] = await Promise.all([findSameModel(deps.db, report, variant), ownerEntries(deps, report.itemId, today)]);
  await deps.reply(token, [buildReplyCard({ report, variant, alternatives, affiliateId: deps.affiliateId, today, ...owner })]);
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
    const today = bangkokToday();
    const owner = latest ? await ownerEntries(deps, ref.itemId, today) : null;
    await deps.reply(token, [latest && owner ? buildLatestCard(latest, deps.affiliateId, today, owner.daily, owner.recorded) : textMessage(NO_DATA)]);
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

/** Text without a link: the deals list, a product search, or the how-to. */
async function answerText(said: string, deps: BotDeps, token: string) {
  if (DEALS_WORDS.test(said.replace(/\s+/g, ''))) {
    const deals = await loadDeals(deps.db);
    await deps.reply(token, [deals.length
      ? productCarousel(deals, deps.affiliateId, 'ราคาคุ้ม: ดีลวันนี้ ราคาลดลงจริง')
      : textMessage(NO_DEALS, MENU)]);
    return;
  }
  if (!searchWords(said).length) {
    await deps.reply(token, [textMessage(HOW_TO, MENU)]);
    return;
  }
  await answerSearch(searchWords(said).join(' '), 0, deps, token, said);
}

/** postback data of the "more" bubble: `more:<offset>:<words>`; LINE allows 300 characters. */
const moreData = (offset: number, words: string) => {
  const data = `more:${offset}:${words}`;
  return data.length <= 300 ? data : undefined;
};

async function answerSearch(words: string, offset: number, deps: BotDeps, token: string, label: string) {
  const started = Date.now();
  const { products, more } = await searchProducts(deps.db, words, offset);
  console.log('search', { words: searchWords(words).length, offset, results: products.length, more, ms: Date.now() - started });
  await deps.reply(token, [products.length
    ? productCarousel(products, deps.affiliateId, `ราคาคุ้ม: ผลค้นหา ${label}`, more ? moreData(offset + products.length, words) : undefined)
    : textMessage(offset ? 'ไม่มีสินค้าเพิ่มแล้ว' : NO_RESULTS, MENU)]);
}

export async function handleEvent(ev: LineEvent, deps: BotDeps): Promise<void> {
  const token = ev.replyToken;
  if (!token) return;
  if (ev.type === 'follow') {
    await deps.reply(token, [textMessage(WELCOME, MENU)]);
    return;
  }
  if (ev.type === 'postback' && ev.postback) {
    const it = /^item:(\d+):(\d+)$/.exec(ev.postback.data);
    if (it) {
      await answerItem({ itemId: Number(it[1]), shopId: Number(it[2]) }, deps, token);
      return;
    }
    const more = /^more:(\d+):(.+)$/s.exec(ev.postback.data);
    if (more) {
      await answerSearch(more[2]!, Number(more[1]), deps, token, more[2]!);
      return;
    }
    const m = /^variant:(\d+):(\d+)$/.exec(ev.postback.data);
    if (!m) return;
    const report = await loadItemReport(deps.db, Number(m[1]));
    const variant = report?.variants.find(v => v.modelId === Number(m[2]));
    if (report && variant) await answerVariant(report, variant, deps, token);
    else await deps.reply(token, [textMessage(NO_DATA)]);
    return;
  }
  if (ev.type === 'message' && ev.message?.type === 'text') {
    const said = (ev.message.text ?? '').trim();
    const userId = ev.source?.userId;
    if (userId && deps.adminIds?.includes(userId) && OWNER_COMMAND.test(said)) {
      await deps.reply(token, [textMessage(await ownerReply(said, { db: deps.db, resolve: deps.resolve, today: bangkokToday() }))]);
      return;
    }
    const url = extractShopeeUrls(said)[0];
    if (!url) {
      await answerText(said, deps, token);
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
