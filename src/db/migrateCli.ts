import { loadConfig } from '../config.js';
import { migrate } from './migrate.js';
import { createPgDb } from './pg.js';

const db = createPgDb(loadConfig(process.env).databaseUrl);
await migrate(db);
await db.close();
console.log('migrations applied');
