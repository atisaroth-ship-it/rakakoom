import type { Db } from '../db/db.js';
import { pruneLatestPrices, upsertLatestPrices } from '../db/store.js';
import type { FeedRecord } from '../feed/columns.js';
import { parseFeedRow, type ParsedItem } from '../feed/parseRow.js';
import { bangkokDate } from '../time.js';

export interface RefreshDeps {
  db: Db;
  feedUrls: string[];
  openFeed: (url: string) => AsyncIterable<FeedRecord>;
  now: () => Date;
  keepDays: number;
  batchSize?: number;
}

/** Manual: fill only the latest-price table from today's feed. No price history, no feed_runs row. */
export async function refreshLatestPrices(deps: RefreshDeps): Promise<{ feedDate: string; rowsRead: number; saved: number }> {
  const feedDate = bangkokDate(deps.now());
  const batchSize = deps.batchSize ?? 1000;
  let rowsRead = 0;
  let saved = 0;
  let batch: ParsedItem[] = [];
  for (const url of deps.feedUrls) {
    for await (const record of deps.openFeed(url)) {
      rowsRead++;
      const p = parseFeedRow(record);
      if (!p.ok) continue;
      batch.push(p.item);
      saved++;
      if (batch.length >= batchSize) {
        await upsertLatestPrices(deps.db, feedDate, batch);
        batch = [];
      }
    }
  }
  await upsertLatestPrices(deps.db, feedDate, batch);
  await pruneLatestPrices(deps.db, feedDate, deps.keepDays);
  return { feedDate, rowsRead, saved };
}
