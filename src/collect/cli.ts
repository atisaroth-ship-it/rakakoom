import { loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPgDb } from '../db/pg.js';
import { openFeed } from '../feed/openFeed.js';
import { createLineAlert } from '../notify/line.js';
import { createPing } from '../notify/ping.js';
import { runDaily } from './runDaily.js';

const config = loadConfig(process.env);
const alert = createLineAlert(config.lineChannelAccessToken, config.adminLineUserId);
const ping = createPing(config.healthcheckUrl);

const db = createPgDb(config.databaseUrl);
let exitCode = 0;
try {
  await migrate(db);
  const result = await runDaily({ db, feedUrls: config.feedUrls, openFeed: url => openFeed(url), alert, ping, now: () => new Date() });
  console.log(JSON.stringify(result));
  if (result.status === 'failed') exitCode = 1;
} catch (e) {
  // Failures before the run starts (database unreachable, migration error) must alert too.
  const msg = e instanceof Error ? e.message : String(e);
  console.error(e);
  await alert(`RakaKoom: ระบบเก็บราคาเริ่มทำงานไม่ได้ — ${msg}`);
  await ping('fail');
  exitCode = 1;
} finally {
  await db.close().catch(() => {});
}
process.exit(exitCode);
