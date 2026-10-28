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
