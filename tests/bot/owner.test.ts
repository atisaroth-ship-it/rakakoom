import type { Db } from '../../src/db/db.js';
import { applyRun, stageItems } from '../../src/db/store.js';
import { handleEvent, type BotDeps, type LineEvent } from '../../src/bot/handler.js';
import { parseCode, parseDayMonth, parseRecord } from '../../src/bot/owner.js';
import { parseFeedRow } from '../../src/feed/parseRow.js';
import { makeFeedRecord } from '../helpers/feedRecord.js';
import { createTestDb } from '../helpers/testDb.js';

test('dates: d/m this year (next year once past), two-digit and 25xx years are Buddhist Era', () => {
  expect(parseDayMonth('31/10', '2026-10-30')).toBe('2026-10-31');
  expect(parseDayMonth('5/1', '2026-10-30')).toBe('2027-01-05');
  expect(parseDayMonth('31/10/69', '2026-10-30')).toBe('2026-10-31');
  expect(parseDayMonth('31/10/2569', '2026-10-30')).toBe('2026-10-31');
  expect(parseDayMonth('31/10/2026', '2026-10-30')).toBe('2026-10-31');
  expect(parseDayMonth('31/2', '2026-10-30')).toBeNull();
});

test('code command: percent and cap required, minimum 0 and today-only by default, mall flag', () => {
  expect(parseCode('โค้ด 30% ขั้นต่ำ 0 ลดสูงสุด 1,500 ถึง 31/10', '2026-10-30'))
    .toEqual({ percent: 30, minSatang: 0, capSatang: 150000, mallOnly: false, until: '2026-10-31' });
  expect(parseCode('โค้ด 10% สูงสุด 2000 mall', '2026-10-30'))
    .toEqual({ percent: 10, minSatang: 0, capSatang: 200000, mallOnly: true, until: '2026-10-30' });
  expect(parseCode('โค้ด 30%', '2026-10-30')).toContain('ต้องมีเปอร์เซ็นต์และลดสูงสุด');
  expect(parseCode('โค้ด 30% สูงสุด 100 ถึง 1/1/69', '2026-10-30')).toContain('ผ่านไปแล้ว');
});

test('record command: link, price, note', () => {
  expect(parseRecord('บันทึก https://shopee.co.th/x-i.10.1 4,990 แฟลชเซลล์+โค้ด30%'))
    .toEqual({ url: 'https://shopee.co.th/x-i.10.1', priceSatang: 499000, note: 'แฟลชเซลล์+โค้ด30%' });
  expect(parseRecord('บันทึก https://shopee.co.th/x-i.10.1 ฿5,050.50')).toEqual({ url: 'https://shopee.co.th/x-i.10.1', priceSatang: 505050, note: '' });
  expect(parseRecord('บันทึก 4990')).toContain('ไม่เจอลิงก์');
  expect(parseRecord('บันทึก https://shopee.co.th/x-i.10.1 ถูกมาก')).toContain('ไม่เจอราคา');
});

describe('in LINE', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
    await db.query(`insert into feed_runs (feed_date, status) values ('2026-10-28', 'success')`);
    const r = parseFeedRow(makeFeedRecord({ itemid: '1', shopid: '10', title: 'ห้องน้ำแมวอัตโนมัติ', model_ids: '11', model_prices: '1000', price: '1000', sale_price: '1000' }));
    if (!r.ok) throw new Error(r.reason);
    await stageItems(db, 1, [r.item]);
    await db.transaction(tx => applyRun(tx, 1, '2026-10-28', null));
  });
  afterEach(async () => { await db.close(); });

  const deps = (): BotDeps & { reply: ReturnType<typeof vi.fn> } => ({
    db, affiliateId: '15311240105', adminIds: ['Uowner'],
    reply: vi.fn(async () => {}),
    resolve: async (url: string) => (url.includes('-i.10.1') ? { shopId: 10, itemId: 1 } : null),
  }) as never;
  const say = (text: string, userId: string): LineEvent => ({ type: 'message', replyToken: 'R', message: { type: 'text', text }, source: { type: 'user', userId } });
  const lastReply = (d: ReturnType<typeof deps>) => d.reply.mock.calls.at(-1)![1][0];
  const card = async (d: ReturnType<typeof deps>) => {
    await handleEvent({ type: 'postback', replyToken: 'R', postback: { data: 'item:1:10' } }, d);
    return JSON.stringify(lastReply(d));
  };

  test('the owner records a real price; the card shows the lowest one with its note', async () => {
    const d = deps();
    await handleEvent(say('บันทึก https://shopee.co.th/x-i.10.1 5,050 แฟลชเซลล์', 'Uowner'), d);
    expect(lastReply(d).text).toContain('บันทึกแล้ว: ฿5,050 (แฟลชเซลล์)');
    await handleEvent(say('บันทึก https://shopee.co.th/x-i.10.1 4990 แฟลชเซลล์+โค้ด30%', 'Uowner'), d);
    const json = await card(d);
    expect(json).toContain('เคยซื้อได้จริง');
    expect(json).toContain('฿4,990');
    expect(json).toContain('แฟลชเซลล์+โค้ด30%');
    expect(json).not.toContain('฿5,050');

    await handleEvent(say('ลบบันทึก https://shopee.co.th/x-i.10.1', 'Uowner'), d);
    expect(lastReply(d).text).toContain('2 รายการ');
    expect(await card(d)).not.toContain('เคยซื้อได้จริง');
  });

  test('the owner adds a daily code; every card counts it as one more code, and it can be listed and removed', async () => {
    const d = deps();
    await handleEvent(say('โค้ด 50% ขั้นต่ำ 0 ลดสูงสุด 400', 'Uowner'), d);
    expect(lastReply(d).text).toMatch(/บันทึกโค้ด #\d+ แล้ว/);
    const json = await card(d);
    expect(json).toContain('฿600');
    expect(json).toContain('โค้ดที่บันทึก ลด 50%');

    await handleEvent(say('โค้ด', 'Uowner'), d);
    const list = lastReply(d).text as string;
    const id = /#(\d+)/.exec(list)![1];
    await handleEvent(say(`ลบโค้ด ${id}`, 'Uowner'), d);
    expect(lastReply(d).text).toBe(`ลบโค้ด #${id} แล้ว`);
    expect(await card(d)).not.toContain('โค้ดที่บันทึก');
  });

  test('anyone else typing a command gets a normal search, and nothing is stored', async () => {
    const d = deps();
    await handleEvent(say('โค้ด 50% ลดสูงสุด 400', 'Ustranger'), d);
    await handleEvent(say('บันทึก https://shopee.co.th/x-i.10.1 1', 'Ustranger'), d);
    expect((await db.query('select * from daily_codes')).rows).toHaveLength(0);
    expect((await db.query('select * from recorded_prices')).rows).toHaveLength(0);
    expect(lastReply(d).type).toBe('flex');
  });
});
