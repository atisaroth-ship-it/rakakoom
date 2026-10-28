import { writeFileSync } from 'node:fs';
import { assertAlertsConfigured, loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPgDb } from '../db/pg.js';
import { waitForDb } from '../db/waitForDb.js';
import { openFeed } from '../feed/openFeed.js';
import { loadScope } from '../feed/scope.js';
import { createLineAlert } from '../notify/line.js';
import { createPing } from '../notify/ping.js';
import { runDaily } from './runDaily.js';

/** Tells the workflow's backstop step that the owner was already alerted, so it does not alert twice. */
const markAlerted = () => {
  if (process.env.ALERT_MARKER) writeFileSync(process.env.ALERT_MARKER, 'alerted\n');
};

const config = loadConfig(process.env);
if (process.env.ALLOW_NO_ALERTS !== '1') assertAlertsConfigured(config);
const alert = createLineAlert(config.lineChannelAccessToken, config.adminLineUserId);
const ping = createPing(config.healthcheckUrl);

const db = createPgDb(config.databaseUrl);
let exitCode = 0;
try {
  await waitForDb(db);
  await migrate(db);
  const result = await runDaily({ db, feedUrls: config.feedUrls, openFeed: (url, onMeta) => openFeed(url, onMeta), scope: loadScope(), dbSizeLimitBytes: config.dbSizeLimitBytes, latestPriceDays: config.latestPriceDays, alert, ping, now: () => new Date() });
  console.log(JSON.stringify(result));
  if (result.status === 'failed') {
    markAlerted();
    exitCode = 1;
  }
} catch (e) {
  // Failures before the run starts (database unreachable, migration error) must alert too.
  const msg = e instanceof Error ? e.message : String(e);
  console.error(e);
  await alert(`RakaKoom: ระบบเก็บราคาเริ่มทำงานไม่ได้ — ${msg}`);
  await ping('fail');
  markAlerted();
  exitCode = 1;
} finally {
  await db.close().catch(() => {});
}
process.exit(exitCode);
