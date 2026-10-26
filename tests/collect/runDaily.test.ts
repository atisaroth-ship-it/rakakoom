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

function feeds(files: Record<string, FeedRecord[] | (() => AsyncIterable<FeedRecord>)>) {
  return vi.fn((url: string) => {
    const f = files[url];
    if (typeof f === 'function') return f();
    return (async function* () { yield* f ?? []; })();
  });
}

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
    'RakaKoom: เก็บราคาวันที่ 2026-10-27 ได้ข้อมูลน้อยผิดปกติ (1 รายการ เทียบกับ 4 เมื่อ 2026-10-26)',
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
