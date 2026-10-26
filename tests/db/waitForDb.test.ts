import type { Db } from '../../src/db/db.js';
import { waitForDb } from '../../src/db/waitForDb.js';

const fakeDb = (failures: number): Db & { calls: number } => {
  const db = {
    calls: 0,
    query: async () => {
      db.calls++;
      if (db.calls <= failures) throw new Error('the database system is starting up');
      return { rows: [] };
    },
    transaction: async () => { throw new Error('unused'); },
    close: async () => {},
  };
  return db as never;
};

test('waitForDb retries until the database answers', async () => {
  const db = fakeDb(2);
  await waitForDb(db, { attempts: 5, delayMs: 1 });
  expect(db.calls).toBe(3);
});

test('waitForDb gives up after the last attempt with the last error', async () => {
  const db = fakeDb(99);
  await expect(waitForDb(db, { attempts: 3, delayMs: 1 })).rejects.toThrow(/starting up/);
  expect(db.calls).toBe(3);
});
