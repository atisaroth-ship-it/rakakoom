import type { Db } from '../db/db.js';
import { applyRun, clearStaging, stageItems } from '../db/store.js';
import type { FeedRecord } from '../feed/columns.js';
import type { FeedMeta } from '../feed/openFeed.js';
import { parseFeedRow, type ParsedItem, type SkipReason } from '../feed/parseRow.js';
import { bangkokDate } from '../time.js';

export interface RunDeps {
  db: Db;
  feedUrls: string[];
  openFeed: (url: string, onMeta?: (meta: FeedMeta) => void) => AsyncIterable<FeedRecord>;
  alert: (msg: string) => Promise<void>;
  ping: (status: 'success' | 'fail') => Promise<void>;
  now: () => Date;
  batchSize?: number;
}

export interface RunResult {
  status: 'success' | 'suspect' | 'failed' | 'skipped';
  feedDate: string;
  rowsRead: number;
  rowsKept: number;
  skipped: Partial<Record<SkipReason, number>>;
  error?: string;
}

/** The feed refreshes around 09:20 Bangkok; earlier runs (e.g. a catch-up at boot) would take yesterday's file. */
const EARLIEST_HOUR = 10;
/** From this hour on, a feed that still has not refreshed is a failure rather than "try the next slot". */
const LAST_SLOT_HOUR = 16;
/** Kept rows below this share of the recent median flag the day. */
const TOTAL_RATIO = 0.5;
/** Any single file below this share of its own recent median flags the day. */
const FILE_RATIO = 0.8;
/** Malformed rows above this share of rows read flag the day. */
const MALFORMED_RATIO = 0.05;
const BASELINE_DAYS = 7;
/** A 'running' row without a heartbeat for this long belongs to a dead process. */
const STALE_RUN = "interval '3 hours'";

const MALFORMED: SkipReason[] = ['bad_ids', 'variant_mismatch', 'bad_price'];

class FeedNotRefreshed extends Error {}

const bangkokHour = (d: Date): number =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hourCycle: 'h23' }).format(d));

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export async function runDaily(deps: RunDeps): Promise<RunResult> {
  const { db, alert, ping } = deps;
  const batchSize = deps.batchSize ?? 1000;
  const now = deps.now();
  const feedDate = bangkokDate(now);
  const result: RunResult = { status: 'skipped', feedDate, rowsRead: 0, rowsKept: 0, skipped: {} };

  if (bangkokHour(now) < EARLIEST_HOUR) return result;

  const done = await db.query(`select 1 from feed_runs where feed_date = $1 and status = 'success'`, [feedDate]);
  if (done.rows.length) return result;

  const active = await db.query(
    `select 1 from feed_runs where status = 'running' and heartbeat_at > now() - ${STALE_RUN}`);
  if (active.rows.length) return { ...result, error: 'another run in progress' };

  // Recent applied days, newest first.
  const recent = (await db.query<{ feed_date: string; rows_kept: number; file_rows: number[]; last_modified: (string | null)[] }>(
    `select distinct on (feed_date) to_char(feed_date, 'YYYY-MM-DD') as feed_date, rows_kept, file_rows, last_modified
       from feed_runs where status in ('success', 'suspect') and feed_date < $1
      order by feed_date desc, (status = 'success') desc, id desc limit ${BASELINE_DAYS}`, [feedDate])).rows;
  const prev = recent[0];

  // No other collector is alive (checked above), so leftover staging belongs to a dead run.
  await db.query('delete from staging_items');
  await db.query('delete from staging_variants');
  const runId = (await db.query<{ id: number }>(
    `insert into feed_runs (feed_date, status) values ($1, 'running') returning id`, [feedDate])).rows[0]!.id;
  const beat = () => db.query('update feed_runs set heartbeat_at = now() where id = $1', [runId]);

  const fileRows: number[] = [];
  const lastModified: (string | null)[] = [];
  try {
    let batch: ParsedItem[] = [];
    for (const [i, url] of deps.feedUrls.entries()) {
      fileRows[i] = 0;
      lastModified[i] = null;
      const onMeta = (m: FeedMeta) => {
        lastModified[i] = m.lastModified;
        const before = prev?.last_modified?.[i] ?? null;
        if (m.lastModified !== null && before !== null && m.lastModified === before) {
          throw new FeedNotRefreshed(`feed file ${i + 1} not refreshed since ${prev!.feed_date}`);
        }
      };
      for await (const record of deps.openFeed(url, onMeta)) {
        result.rowsRead++;
        fileRows[i]!++;
        const parsed = parseFeedRow(record);
        if (!parsed.ok) {
          result.skipped[parsed.reason] = (result.skipped[parsed.reason] ?? 0) + 1;
          continue;
        }
        result.rowsKept++;
        batch.push(parsed.item);
        if (batch.length >= batchSize) {
          await stageItems(db, runId, batch);
          await beat();
          batch = [];
        }
      }
      if (fileRows[i] === 0) throw new Error(`feed file ${i + 1} returned no rows`);
    }
    await stageItems(db, runId, batch);
    if (result.rowsKept === 0) throw new Error(`no branded items in feed (${result.rowsRead} rows read)`);

    await beat();
    await db.transaction(tx => applyRun(tx, runId, feedDate, prev?.feed_date ?? null));

    const reasons = suspectReasons(result, fileRows, recent);
    result.status = reasons.length ? 'suspect' : 'success';
    await finish(db, runId, result, fileRows, lastModified);
    if (reasons.length) await alert(`RakaKoom: เก็บราคาวันที่ ${feedDate} ข้อมูลผิดปกติ — ${reasons.join('; ')}`);
    await ping('success');
  } catch (e) {
    const waiting = e instanceof FeedNotRefreshed && bangkokHour(now) < LAST_SLOT_HOUR;
    result.status = waiting ? 'skipped' : 'failed';
    result.error = e instanceof Error ? e.message : String(e);
    // The database itself may be what failed; the alert must still go out.
    await clearStaging(db, runId).catch(err => console.error('clearStaging failed', err));
    await finish(db, runId, { ...result, status: 'failed' }, fileRows, lastModified)
      .catch(err => console.error('feed_runs update failed', err));
    if (!waiting) {
      const msg = e instanceof FeedNotRefreshed
        ? `RakaKoom: เก็บราคาวันที่ ${feedDate} ล้มเหลว — ฟีดยังไม่อัปเดตจนถึงรอบสุดท้ายของวัน (${result.error})`
        : `RakaKoom: เก็บราคาวันที่ ${feedDate} ล้มเหลว — ${result.error}`;
      await alert(msg);
      await ping('fail');
    }
  }
  return result;
}

function suspectReasons(
  r: RunResult,
  fileRows: number[],
  recent: { rows_kept: number; file_rows: number[] }[],
): string[] {
  const reasons: string[] = [];
  const keptMedian = median(recent.map(d => Number(d.rows_kept)));
  if (keptMedian !== null && r.rowsKept < TOTAL_RATIO * keptMedian) {
    reasons.push(`รวม ${r.rowsKept} รายการ ปกติราว ${keptMedian}`);
  }
  fileRows.forEach((n, i) => {
    const m = median(recent.map(d => d.file_rows?.[i]).filter((x): x is number => typeof x === 'number'));
    if (m !== null && n < FILE_RATIO * m) reasons.push(`ไฟล์ที่ ${i + 1} มี ${n} แถว ปกติราว ${m}`);
  });
  const malformed = MALFORMED.reduce((s, k) => s + (r.skipped[k] ?? 0), 0);
  if (r.rowsRead > 0 && malformed / r.rowsRead > MALFORMED_RATIO) {
    reasons.push(`ข้อมูลผิดรูปแบบ ${malformed} จาก ${r.rowsRead} แถว`);
  }
  return reasons;
}

async function finish(db: Db, runId: number, r: RunResult, fileRows: number[], lastModified: (string | null)[]): Promise<void> {
  await db.query(
    `update feed_runs set status = $2, finished_at = now(), rows_read = $3, rows_kept = $4, skipped = $5::jsonb, error = $6,
            file_rows = $7::jsonb, last_modified = $8::jsonb
      where id = $1`,
    [runId, r.status, r.rowsRead, r.rowsKept, JSON.stringify(r.skipped), r.error ?? null,
      JSON.stringify(fileRows), JSON.stringify(lastModified)],
  );
}
