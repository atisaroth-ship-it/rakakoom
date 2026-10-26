import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { stringify } from 'csv-stringify/sync';
import { FEED_COLUMNS, type FeedRecord } from '../../src/feed/columns.js';
import { openFeed } from '../../src/feed/openFeed.js';
import { makeFeedRecord } from '../helpers/feedRecord.js';

const MULTILINE = 'บรรทัด 1\nบรรทัด "2", มีลูกน้ำ 💡';

function toCsv(records: FeedRecord[], columns: readonly string[] = FEED_COLUMNS): string {
  return '﻿' + stringify(records, { header: true, columns: [...columns] });
}

let server: Server;
let base: string;
let body = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/feed' }); res.end(); return; }
    if (req.url === '/feed') { res.writeHead(200, { 'content-type': 'binary/octet-stream' }); res.end(body); return; }
    if (req.url === '/drop') {
      res.writeHead(200, { 'content-type': 'binary/octet-stream' });
      res.write(body);
      setTimeout(() => res.socket?.destroy(), 20);
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

async function collect(url: string): Promise<FeedRecord[]> {
  const out: FeedRecord[] = [];
  for await (const r of openFeed(url)) out.push(r);
  return out;
}

test('openFeed parses quoted multiline fields', async () => {
  body = toCsv([makeFeedRecord({ description: MULTILINE }), makeFeedRecord({ itemid: '2' })]);
  const records = await collect(`${base}/feed`);
  expect(records).toHaveLength(2);
  expect(records[0]!.description).toBe(MULTILINE);
  expect(records[0]!.itemid).toBe('53001999315');
});

test('openFeed strips BOM so first column name is exact', async () => {
  body = toCsv([makeFeedRecord()]);
  const records = await collect(`${base}/feed`);
  expect(Object.keys(records[0]!)[0]).toBe('image_link_4');
});

test('openFeed follows redirect', async () => {
  body = toCsv([makeFeedRecord()]);
  expect(await collect(`${base}/redirect`)).toHaveLength(1);
});

test('openFeed throws on 404 without leaking url', async () => {
  const err = await collect(`${base}/missing`).catch((e: Error) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toMatch(/404/);
  expect((err as Error).message).not.toMatch(/missing|127\.0\.0\.1/);
});

test('openFeed rejects (not crashes) when the connection drops mid-file', async () => {
  body = toCsv([makeFeedRecord(), makeFeedRecord({ itemid: '2' })]);
  const crashes: unknown[] = [];
  const onCrash = (e: unknown) => crashes.push(e);
  process.on('uncaughtException', onCrash);
  try {
    await expect(collect(`${base}/drop`)).rejects.toThrow();
    await new Promise(r => setTimeout(r, 50));
  } finally {
    process.off('uncaughtException', onCrash);
  }
  expect(crashes).toEqual([]);
});

test('openFeed fails on an unterminated quote instead of buffering the rest of the file', async () => {
  const header = '﻿' + FEED_COLUMNS.join(',') + '\n';
  body = header + '"' + 'x'.repeat(3 * 1024 * 1024) + '\n';
  await expect(collect(`${base}/feed`)).rejects.toThrow();
});

test('openFeed throws when header changed', async () => {
  body = toCsv([makeFeedRecord()], FEED_COLUMNS.filter(c => c !== 'model_prices'));
  await expect(collect(`${base}/feed`)).rejects.toThrow(/feed header changed: missing model_prices/);
});
