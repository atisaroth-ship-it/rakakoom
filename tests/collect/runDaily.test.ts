import type { Db } from '../../src/db/db.js';
import { runDaily, type RunDeps } from '../../src/collect/runDaily.js';
import type { FeedRecord } from '../../src/feed/columns.js';
import { makeFeedRecord } from '../helpers/feedRecord.js';
import { createTestDb } from '../helpers/testDb.js';

let db: Db;
beforeEach(async () => { db = await createTestDb(); });
afterEach(async () => { await db.close(); });

const NOW = new Date('2026-10-27T03:30:00Z'); // 10:30 Bangkok
const PREV = new Date('2026-10-26T03:30:00Z');

type FileSpec = FeedRecord[] | (() => AsyncIterable<FeedRecord>) | { records: FeedRecord[]; lastModified: string };

function feeds(files: Record<string, FileSpec>) {
  return vi.fn((url: string, onMeta?: (m: { lastModified: string | null }) => void) => {
    const f = files[url];
    if (typeof f === 'function') return f();
    const spec = Array.isArray(f) || f === undefined ? { records: f ?? [], lastModified: null } : f;
    return (async function* () {
      onMeta?.({ lastModified: spec.lastModified });
      yield* spec.records;
    })();
  });
}

const at = (iso: string) => () => new Date(iso);
const many = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => rec(String(1000 + offset + i), String(5000 + offset + i)));

function deps(over: Partial<RunDeps> & Pick<RunDeps, 'openFeed'>): RunDeps & { alert: ReturnType<typeof vi.fn>; ping: ReturnType<typeof vi.fn> } {
  return { db, feedUrls: ['u1'], alert: vi.fn(async () => {}), ping: vi.fn(async () => {}), now: () => NOW, ...over } as never;
}

const rec = (itemid: string, modelId: string, extra: Partial<FeedRecord> = {}) =>
  makeFeedRecord({ itemid, model_ids: modelId, ...extra });

const runs = async () =>
  (await db.query<{ feed_date: string; status: string }>(
    `select to_char(feed_date,'YYYY-MM-DD') as feed_date, status from feed_runs order by id`)).rows;

test('success run records feed_runs and pings success', async () => {
  const d = deps({ openFeed: feeds({ u1: [rec('1', '11')] }) });
  const r = await runDaily(d);
  expect(r).toMatchObject({ status: 'success', feedDate: '2026-10-27', rowsRead: 1, rowsKept: 1 });
  expect(await runs()).toEqual([{ feed_date: '2026-10-27', status: 'success' }]);
  expect(d.ping).toHaveBeenCalledWith('success');
  expect(d.alert).not.toHaveBeenCalled();
});

test('second run same day is skipped', async () => {
  await runDaily(deps({ openFeed: feeds({ u1: [rec('1', '11')] }) }));
  const open = feeds({ u1: [rec('1', '11')] });
  const d = deps({ openFeed: open });
  expect((await runDaily(d)).status).toBe('skipped');
  expect(open).not.toHaveBeenCalled();
  expect(d.ping).not.toHaveBeenCalled();
});

test('counts skip reasons', async () => {
  const r = await runDaily(deps({ openFeed: feeds({ u1: [rec('1', '11', { global_brand: 'NoBrand' }), rec('2', '22')] }) }));
  expect(r).toMatchObject({ rowsRead: 2, rowsKept: 1, skipped: { no_brand: 1 } });
});

test('zero kept rows is failure', async () => {
  const d = deps({ openFeed: feeds({ u1: [rec('1', '11', { global_brand: 'NoBrand' })] }) });
  const r = await runDaily(d);
  expect(r.status).toBe('failed');
  expect(d.alert).toHaveBeenCalledWith(expect.stringContaining('ล้มเหลว'));
  expect(d.ping).toHaveBeenCalledWith('fail');
  expect((await db.query('select * from price_changes')).rows).toHaveLength(0);
});

test('drop below half of last success is suspect', async () => {
  const four = ['1', '2', '3', '4'].map(i => rec(i, i + '0'));
  await runDaily(deps({ openFeed: feeds({ u1: four }), now: () => PREV }));
  const d = deps({ openFeed: feeds({ u1: [rec('1', '10')] }) });
  const r = await runDaily(d);
  expect(r.status).toBe('suspect');
  expect(d.alert).toHaveBeenCalledWith(
    'RakaKoom: เก็บราคาวันที่ 2026-10-27 ข้อมูลผิดปกติ — รวม 1 รายการ ปกติราว 4; ไฟล์ที่ 1 มี 1 แถว ปกติราว 4',
  );
  expect(d.ping).toHaveBeenCalledWith('success');
  expect((await db.query('select * from variants where last_seen = $1', ['2026-10-27'])).rows).toHaveLength(1);
});

test('stream error mid-file fails without partial apply', async () => {
  const broken = () => (async function* () { yield rec('9', '99'); throw new Error('socket hang up'); })();
  const d = deps({ feedUrls: ['u1', 'u2'], openFeed: feeds({ u1: [rec('1', '11')], u2: broken }), batchSize: 1 });
  const r = await runDaily(d);
  expect(r).toMatchObject({ status: 'failed', error: 'socket hang up' });
  expect(d.alert).toHaveBeenCalledWith('RakaKoom: เก็บราคาวันที่ 2026-10-27 ล้มเหลว — socket hang up');
  expect((await db.query('select * from items')).rows).toHaveLength(0);
  expect((await db.query('select * from staging_items')).rows).toHaveLength(0);
});

test('rerun after failure leaves no leftovers', async () => {
  const broken = () => (async function* () { yield rec('1', '11'); throw new Error('boom'); })();
  await runDaily(deps({ openFeed: feeds({ u1: broken }), batchSize: 1 }));
  const r = await runDaily(deps({ openFeed: feeds({ u1: [rec('1', '11')] }) }));
  expect(r.status).toBe('success');
  expect((await db.query('select * from price_changes')).rows).toHaveLength(1);
  expect((await db.query('select * from staging_items')).rows).toHaveLength(0);
  expect((await runs()).map(x => x.status)).toEqual(['failed', 'success']);
});

test('does not run before 10:00 Bangkok (boot-time catch-up must not take yesterday\'s feed)', async () => {
  const open = feeds({ u1: [rec('1', '11')] });
  const r = await runDaily(deps({ openFeed: open, now: at('2026-10-26T18:00:00Z') })); // 01:00 Bangkok 27th
  expect(r.status).toBe('skipped');
  expect(open).not.toHaveBeenCalled();
  expect(await runs()).toEqual([]);
});

test('unchanged Last-Modified before the last slot waits silently', async () => {
  await runDaily(deps({ openFeed: feeds({ u1: { records: [rec('1', '11')], lastModified: 'Mon, 26 Oct 2026 02:20:00 GMT' } }), now: () => PREV }));
  const d = deps({ openFeed: feeds({ u1: { records: [rec('1', '11')], lastModified: 'Mon, 26 Oct 2026 02:20:00 GMT' } }) });
  const r = await runDaily(d);
  expect(r).toMatchObject({ status: 'skipped', error: expect.stringMatching(/not refreshed/) });
  expect(d.alert).not.toHaveBeenCalled();
  expect(d.ping).not.toHaveBeenCalled();
  expect((await db.query(`select * from variants where last_seen = '2026-10-27'`)).rows).toHaveLength(0);
});

test('unchanged Last-Modified at the last slot fails with an alert', async () => {
  await runDaily(deps({ openFeed: feeds({ u1: { records: [rec('1', '11')], lastModified: 'X' } }), now: () => PREV }));
  const d = deps({ openFeed: feeds({ u1: { records: [rec('1', '11')], lastModified: 'X' } }), now: at('2026-10-27T09:30:00Z') });
  const r = await runDaily(d);
  expect(r.status).toBe('failed');
  expect(d.alert).toHaveBeenCalledWith(expect.stringContaining('ฟีดยังไม่อัปเดต'));
  expect(d.ping).toHaveBeenCalledWith('fail');
});

test('a file returning no rows fails the run', async () => {
  const d = deps({ feedUrls: ['u1', 'u2'], openFeed: feeds({ u1: [rec('1', '11')], u2: [] }) });
  const r = await runDaily(d);
  expect(r).toMatchObject({ status: 'failed', error: expect.stringMatching(/file 2 returned no rows/) });
});

test('a file much smaller than its usual size is suspect', async () => {
  await runDaily(deps({ feedUrls: ['u1', 'u2'], openFeed: feeds({ u1: many(10), u2: many(10, 100) }), now: () => PREV }));
  const d = deps({ feedUrls: ['u1', 'u2'], openFeed: feeds({ u1: many(10), u2: many(6, 100) }) });
  const r = await runDaily(d);
  expect(r.status).toBe('suspect');
  expect(d.alert).toHaveBeenCalledWith(expect.stringContaining('ไฟล์ที่ 2'));
});

test('baseline is the median of recent days, so a slow drift is still caught', async () => {
  const days = [['2026-10-20', 10], ['2026-10-21', 10], ['2026-10-22', 10], ['2026-10-23', 6], ['2026-10-24', 6], ['2026-10-25', 6]] as const;
  for (const [day, n] of days) {
    await runDaily(deps({ openFeed: feeds({ u1: many(n) }), now: at(`${day}T03:30:00Z`) }));
  }
  const d = deps({ openFeed: feeds({ u1: many(4) }), now: at('2026-10-26T03:30:00Z') });
  expect((await runDaily(d)).status).toBe('suspect');
});

test('a high share of malformed rows is suspect', async () => {
  const bad = Array.from({ length: 2 }, (_, i) => rec(String(90 + i), '1', { model_prices: 'abc' }));
  const d = deps({ openFeed: feeds({ u1: [...many(10), ...bad] }) });
  const r = await runDaily(d);
  expect(r.status).toBe('suspect');
  expect(d.alert).toHaveBeenCalledWith(expect.stringContaining('ข้อมูลผิดรูปแบบ'));
});

test('a suspect day can be re-collected by a later slot', async () => {
  await runDaily(deps({ openFeed: feeds({ u1: many(10) }), now: () => PREV }));
  await runDaily(deps({ openFeed: feeds({ u1: many(2) }) }));
  const r = await runDaily(deps({ openFeed: feeds({ u1: many(10) }), now: at('2026-10-27T05:30:00Z') }));
  expect(r.status).toBe('success');
  expect((await runs()).map(x => x.status)).toEqual(['success', 'suspect', 'success']);
});

test('skips while another run is in progress', async () => {
  await db.query(`insert into feed_runs (feed_date, status, started_at) values ('2026-10-27', 'running', now())`);
  const open = feeds({ u1: [rec('1', '11')] });
  const r = await runDaily(deps({ openFeed: open }));
  expect(r).toMatchObject({ status: 'skipped', error: expect.stringMatching(/in progress/) });
  expect(open).not.toHaveBeenCalled();
});

test('out-of-scope rows are skipped but not counted as malformed', async () => {
  const scope = { include: ['Audio'], excludeCategory2: {} };
  const inside = many(10).map(r => ({ ...r, global_category1: 'Audio' }));
  const outside = many(5, 100).map(r => ({ ...r, global_category1: 'Home & Living' }));
  const d = deps({ openFeed: feeds({ u1: [...inside, ...outside] }), scope });
  const r = await runDaily(d);
  expect(r).toMatchObject({ status: 'success', rowsKept: 10, skipped: { out_of_scope: 5 } });
  expect(d.alert).not.toHaveBeenCalled();
});

test('alerts when the database reaches 80% of the limit', async () => {
  const size = Number((await db.query<{ n: string }>('select pg_database_size(current_database()) as n')).rows[0]!.n);
  const d = deps({ openFeed: feeds({ u1: many(3) }), dbSizeLimitBytes: Math.floor(size / 0.85) });
  const r = await runDaily(d);
  expect(r.status).toBe('success');
  expect(r.dbSizeBytes).toBeGreaterThan(0);
  expect(d.alert).toHaveBeenCalledWith(expect.stringMatching(/^RakaKoom: ฐานข้อมูลใช้ไป \d+ MB จาก \d+ MB \(\d+%\) ใกล้เต็มแล้ว$/));
});

test('no size alert below 80%', async () => {
  const d = deps({ openFeed: feeds({ u1: many(3) }), dbSizeLimitBytes: 100 * 1024 * 1024 * 1024 });
  await runDaily(d);
  expect(d.alert).not.toHaveBeenCalled();
});
