import type { Db } from '../db/db.js';

export interface ResetStats {
  items: number;
  variants: number;
  priceChanges: number;
  shops: number;
}

/**
 * One-off: delete all price history so collecting starts again. The history before 29 Oct 2026 held list
 * prices, not the discounted prices the app shows. feed_runs (stale-feed and suspect checks), latest_prices
 * and link_requests are kept. Owner-approved on 28 Oct 2026 after a backup; never run automatically.
 */
export async function resetPriceHistory(db: Db): Promise<ResetStats> {
  return db.transaction(async tx => {
    const n = async (t: string) => Number((await tx.query<{ n: number }>(`select count(*) as n from ${t}`)).rows[0]!.n);
    const stats = { items: await n('items'), variants: await n('variants'), priceChanges: await n('price_changes'), shops: await n('shops') };
    await tx.query('truncate price_changes, variants, items, shops');
    return stats;
  });
}
