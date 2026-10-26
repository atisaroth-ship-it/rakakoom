import type { Db } from '../db/db.js';
import { applyRun, clearStaging, stageItems } from '../db/store.js';
import type { FeedRecord } from '../feed/columns.js';
import { parseFeedRow, type ParsedItem, type SkipReason } from '../feed/parseRow.js';
import { bangkokDate } from '../time.js';

export interface RunDeps {
  db: Db;
  feedUrls: string[];
  openFeed: (url: string) => AsyncIterable<FeedRecord>;
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

/** A day with fewer kept rows than this share of the last good day is flagged. */
const SUSPECT_RATIO = 0.5;

export async function runDaily(deps: RunDeps): Promise<RunResult> {
  const { db, alert, ping } = deps;
  const batchSize = deps.batchSize ?? 1000;
  const feedDate = bangkokDate(deps.now());
  const result: RunResult = { status: 'skipped', feedDate, rowsRead: 0, rowsKept: 0, skipped: {} };

  const done = await db.query(
    `select 1 from feed_runs where feed_date = $1 and status in ('success', 'suspect')`, [feedDate]);
  if (done.rows.length) return result;

  const prev = (await db.query<{ rows_kept: number; feed_date: string }>(
    `select rows_kept, to_char(feed_date, 'YYYY-MM-DD') as feed_date from feed_runs
      where status in ('success', 'suspect') and feed_date < $1 order by feed_date desc limit 1`, [feedDate])).rows[0];

  // Only one collector runs at a time, so any staging left over is from a killed run.
  await db.query('delete from staging_items');
  await db.query('delete from staging_variants');
  const runId = (await db.query<{ id: number }>(
    `insert into feed_runs (feed_date, status) values ($1, 'running') returning id`, [feedDate])).rows[0]!.id;

  try {
    let batch: ParsedItem[] = [];
    for (const url of deps.feedUrls) {
      for await (const record of deps.openFeed(url)) {
        result.rowsRead++;
        const parsed = parseFeedRow(record);
        if (!parsed.ok) {
          result.skipped[parsed.reason] = (result.skipped[parsed.reason] ?? 0) + 1;
          continue;
        }
        result.rowsKept++;
        batch.push(parsed.item);
        if (batch.length >= batchSize) {
          await stageItems(db, runId, batch);
          batch = [];
        }
      }
    }
    await stageItems(db, runId, batch);
    if (result.rowsKept === 0) throw new Error(`no branded items in feed (${result.rowsRead} rows read)`);

    await db.transaction(tx => applyRun(tx, runId, feedDate));

    const suspect = prev !== undefined && result.rowsKept < SUSPECT_RATIO * Number(prev.rows_kept);
    result.status = suspect ? 'suspect' : 'success';
    await finish(db, runId, result);
    if (suspect) {
      await alert(`RakaKoom: เก็บราคาวันที่ ${feedDate} ได้ข้อมูลน้อยผิดปกติ (${result.rowsKept} รายการ เทียบกับ ${Number(prev!.rows_kept)} เมื่อ ${prev!.feed_date})`);
    }
    await ping('success');
  } catch (e) {
    result.status = 'failed';
    result.error = e instanceof Error ? e.message : String(e);
    // The database itself may be what failed; the alert must still go out.
    await clearStaging(db, runId).catch(err => console.error('clearStaging failed', err));
    await finish(db, runId, result).catch(err => console.error('feed_runs update failed', err));
    await alert(`RakaKoom: เก็บราคาวันที่ ${feedDate} ล้มเหลว — ${result.error}`);
    await ping('fail');
  }
  return result;
}

async function finish(db: Db, runId: number, r: RunResult): Promise<void> {
  await db.query(
    `update feed_runs set status = $2, finished_at = now(), rows_read = $3, rows_kept = $4, skipped = $5::jsonb, error = $6
      where id = $1`,
    [runId, r.status, r.rowsRead, r.rowsKept, JSON.stringify(r.skipped), r.error ?? null],
  );
}
