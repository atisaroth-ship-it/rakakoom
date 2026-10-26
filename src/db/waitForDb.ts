import type { Db } from './db.js';

/** At boot the collector can start before Postgres accepts connections; wait instead of losing the day. */
export async function waitForDb(db: Db, { attempts = 20, delayMs = 15000 } = {}): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await db.query('select 1');
      return;
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}
