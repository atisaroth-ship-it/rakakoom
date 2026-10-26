import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { parse } from 'csv-parse';
import type { FeedRecord } from './columns.js';

const REQUIRED_COLUMNS = ['itemid', 'model_ids', 'model_prices', 'global_brand'];

/**
 * Stream a feed CSV over HTTP one record at a time; the multi-GB file never sits in memory.
 * The URL carries a secret token, so it never appears in error messages.
 */
export async function* openFeed(url: string, fetchFn: typeof fetch = fetch): AsyncIterable<FeedRecord> {
  const res = await fetchFn(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`feed download failed: HTTP ${res.status}`);

  const source = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
  // A single field above this means a broken quote is swallowing the file; fail instead of buffering gigabytes.
  const parser = parse({ columns: true, bom: true, relax_quotes: true, relax_column_count: true, max_record_size: 2 * 1024 * 1024 });
  // .pipe() does not forward source errors: a dropped connection would hang the parser or crash the process.
  source.on('error', err => parser.destroy(err));
  source.pipe(parser);

  let checked = false;
  for await (const record of parser as AsyncIterable<FeedRecord>) {
    if (!checked) {
      const missing = REQUIRED_COLUMNS.filter(c => !(c in record));
      if (missing.length) {
        parser.destroy();
        throw new Error(`feed header changed: missing ${missing.join(', ')}`);
      }
      checked = true;
    }
    yield record;
  }
}
