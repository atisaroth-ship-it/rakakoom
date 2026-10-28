import type { Db } from '../../src/db/db.js';
import { applyRun, stageItems, upsertLatestPrices } from '../../src/db/store.js';
import { handleEvent, verifySignature, type BotDeps, type LineEvent } from '../../src/bot/handler.js';
import { parseFeedRow, type ParsedItem } from '../../src/feed/parseRow.js';
import { makeFeedRecord } from '../helpers/feedRecord.js';
import { createTestDb } from '../helpers/testDb.js';

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await db.query(`insert into feed_runs (feed_date, status) values ('2026-10-28', 'success')`);
});
afterEach(async () => { await db.close(); });

const item = (o: Record<string, string>): ParsedItem => {
  const r = parseFeedRow(makeFeedRecord(o));
  if (!r.ok) throw new Error(r.reason);
  return r.item;
};
async function seed(items: ParsedItem[]) {
  await stageItems(db, 1, items);
  await db.transaction(tx => applyRun(tx, 1, '2026-10-28', null));
}

function deps(over: Partial<BotDeps> = {}): BotDeps & { reply: ReturnType<typeof vi.fn> } {
  return {
    db, affiliateId: '15311240105',
    reply: vi.fn(async () => {}),
    resolve: async (url: string) => (url.includes('-i.10.1') ? { shopId: 10, itemId: 1 } : url.includes('-i.10.9') ? { shopId: 10, itemId: 9 } : null),
    ...over,
  } as never;
}
const textEvent = (text: string): LineEvent => ({ type: 'message', replyToken: 'R1', message: { type: 'text', text } });

test('a pasted link to a known single-variant item gets a Flex card', async () => {
  await seed([item({ itemid: '1', shopid: '10', global_category1: 'Audio', title: 'Sony WH-1000XM5' })]);
  const d = deps();
  await handleEvent(textEvent('ราคานี้ดีไหม https://shopee.co.th/x-i.10.1'), d);
  const [token, messages] = d.reply.mock.calls[0]!;
  expect(token).toBe('R1');
  expect(messages[0].type).toBe('flex');
  expect(JSON.stringify(messages[0])).toContain('affiliate_id=15311240105');
});

test('an item with several variants asks which one, then answers the choice', async () => {
  await seed([item({ itemid: '1', shopid: '10', model_ids: '11|12', model_names: 'สีดำ|สีขาว', model_prices: '100|110' })]);
  const d = deps();
  await handleEvent(textEvent('https://shopee.co.th/x-i.10.1'), d);
  const ask = d.reply.mock.calls[0]![1][0];
  expect(ask.type).toBe('text');
  expect(ask.quickReply.items.map((i: { action: { label: string; data: string } }) => [i.action.label, i.action.data]))
    .toEqual([['สีดำ', 'variant:1:11'], ['สีขาว', 'variant:1:12']]);

  await handleEvent({ type: 'postback', replyToken: 'R2', postback: { data: 'variant:1:12' } }, d);
  const card = d.reply.mock.calls[1]![1][0];
  expect(card.type).toBe('flex');
  expect(JSON.stringify(card)).toContain('สีขาว');
});

test('an unknown item is answered honestly and recorded without the user id', async () => {
  const d = deps();
  await handleEvent({ ...textEvent('https://shopee.co.th/x-i.10.9'), source: { type: 'user', userId: 'Uabc' } } as LineEvent, d);
  expect(d.reply.mock.calls[0]![1][0].text).toContain('ยังไม่มีข้อมูลสินค้านี้');
  const logged = await db.query('select * from link_requests');
  expect(logged.rows).toEqual([expect.objectContaining({ item_id: 9, shop_id: 10 })]);
  expect(JSON.stringify(logged.rows)).not.toContain('Uabc');
});

test('text without a Shopee link gets the how-to, unreadable links say so', async () => {
  const d = deps();
  await handleEvent(textEvent('สวัสดี'), d);
  expect(d.reply.mock.calls[0]![1][0].text).toContain('วางลิงก์สินค้า Shopee');
  await handleEvent(textEvent('https://s.shopee.co.th/broken'), d);
  expect(d.reply.mock.calls[1]![1][0].text).toContain('อ่านลิงก์นี้ไม่ได้');
});

test('follow event gets a welcome', async () => {
  const d = deps();
  await handleEvent({ type: 'follow', replyToken: 'R3' }, d);
  expect(d.reply.mock.calls[0]![1][0].text).toContain('ราคาคุ้ม');
});

test('verifySignature accepts LINE HMAC-SHA256 base64 and rejects others', async () => {
  const body = '{"events":[]}';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))));
  expect(await verifySignature(body, sig, 'secret')).toBe(true);
  expect(await verifySignature(body, sig, 'other')).toBe(false);
  expect(await verifySignature(body, null, 'secret')).toBe(false);
});

test('an item with no history but a recent latest price gets the latest-price card', async () => {
  await upsertLatestPrices(db, '2026-10-27', [item({ itemid: '9', shopid: '10', title: 'แอร์ Daikin FTKF12XV2S', model_ids: '91|92', model_names: 'a|b', model_prices: '15900|16900', image_link: 'https://cf.shopee.co.th/file/th-abc' })]);
  const d = deps();
  await handleEvent(textEvent('https://shopee.co.th/x-i.10.9'), d);
  const msg = d.reply.mock.calls[0]![1][0];
  expect(msg.type).toBe('flex');
  const json = JSON.stringify(msg);
  expect(json).toContain('฿15,900 – ฿16,900');
  expect(json).toContain('ราคาล่าสุดที่เห็น 27 ต.ค.');
  expect(json).toContain('ยังไม่มีประวัติราคา');
  expect(json).toContain('https://cf.shopee.co.th/file/th-abc');
  expect(json).toContain('origin_link=https%3A%2F%2Fshopee.co.th%2Fproduct%2F10%2F9');
  expect((await db.query('select * from link_requests')).rows).toHaveLength(1);
});

async function day(runId: number, date: string, prev: string | null, items: ParsedItem[]) {
  if (date !== '2026-10-28') await db.query(`insert into feed_runs (feed_date, status) values ($1, 'success')`, [date]);
  await stageItems(db, runId, items);
  await db.transaction(tx => applyRun(tx, runId, date, prev));
}

test('typing a product name searches recent products, best sellers first, with check-price buttons', async () => {
  await upsertLatestPrices(db, '2026-10-28', [
    item({ itemid: '1', shopid: '10', global_brand: 'Sony', title: 'หูฟัง Sony WH-1000XM5', item_sold: '50' }),
    item({ itemid: '2', shopid: '20', global_brand: 'Sony', title: 'หูฟังไร้สาย Sony WF-C700N', item_sold: '900' }),
    item({ itemid: '3', shopid: '30', global_brand: 'JBL', title: 'หูฟัง JBL Tune 520BT', item_sold: '999' }),
  ]);
  const d = deps();
  await handleEvent(textEvent('หูฟัง sony'), d);
  const msg = d.reply.mock.calls[0]![1][0];
  expect(msg.contents.type).toBe('carousel');
  const bubbles = msg.contents.contents.map((b: unknown) => JSON.stringify(b));
  expect(bubbles).toHaveLength(2);
  expect(bubbles[0]).toContain('WF-C700N');
  expect(bubbles[0]).toContain('"data":"item:2:20"');
  expect(bubbles[0]).toContain('affiliate_id=15311240105');
});

test('a search with no match says so; "%" in a search is not a wildcard', async () => {
  await upsertLatestPrices(db, '2026-10-28', [item({ itemid: '1', title: 'พัดลม Hatari 16 นิ้ว' })]);
  const d = deps();
  await handleEvent(textEvent('แอร์ daikin'), d);
  expect(d.reply.mock.calls[0]![1][0].text).toContain('ไม่เจอสินค้า');
  await handleEvent(textEvent('%%'), d);
  expect(d.reply.mock.calls[1]![1][0].text).toContain('ไม่เจอสินค้า');
});

test('the check-price button opens the full answer for that product', async () => {
  await seed([item({ itemid: '1', shopid: '10', global_category1: 'Audio', title: 'Sony WH-1000XM5' })]);
  const d = deps();
  await handleEvent({ type: 'postback', replyToken: 'R4', postback: { data: 'item:1:10' } }, d);
  expect(d.reply.mock.calls[0]![1][0].type).toBe('flex');
  expect(JSON.stringify(d.reply.mock.calls[0]![1][0])).toContain('ราคาตอนนี้');
});

test('deals: only real drops of 10%+ that are the lowest recorded, never risky shops', async () => {
  const p = (itemid: string, shopid: string, price: string, o: Record<string, string> = {}) =>
    item({ itemid, shopid, model_ids: itemid + '1', model_prices: price, price, sale_price: price, title: `สินค้า ${itemid}`, ...o });
  await day(1, '2026-10-28', null, [p('1', '10', '1000'), p('2', '20', '1000'), p('3', '30', '1000'), p('4', '40', '1000', { seller_penalty_score: '5' })]);
  await day(2, '2026-10-29', '2026-10-28', [p('1', '10', '800'), p('2', '20', '950'), p('3', '30', '1000'), p('4', '40', '500', { seller_penalty_score: '5' })]);
  const d = deps();
  await handleEvent(textEvent('ดีลวันนี้'), d);
  const msg = d.reply.mock.calls[0]![1][0];
  const bubbles = msg.contents.contents.map((b: unknown) => JSON.stringify(b));
  expect(bubbles).toHaveLength(1);
  expect(bubbles[0]).toContain('สินค้า 1');
  expect(bubbles[0]).toContain('เดิม ฿1,000 · ลด 20%');
});

test('deals: a price back down to an earlier level that is not the lowest is not a deal; none says so', async () => {
  const p = (price: string) => item({ itemid: '1', shopid: '10', model_ids: '11', model_prices: price, price, sale_price: price });
  await day(1, '2026-10-28', null, [p('700')]);
  await day(2, '2026-10-29', '2026-10-28', [p('1000')]);
  await day(3, '2026-10-30', '2026-10-29', [p('850')]);
  const d = deps();
  await handleEvent(textEvent('ดีล'), d);
  expect(d.reply.mock.calls[0]![1][0].text).toContain('ยังไม่เจอสินค้าที่ราคาลดลงจริง');
});
