import { neon } from '@neondatabase/serverless';
import type { Db } from '../db/db.js';
import { handleEvent, verifySignature, type LineEvent } from './handler.js';
import { resolveItemRef } from './links.js';

/** Cloudflare Worker bindings: secrets set with `wrangler secret put`, AFFILIATE_ID in wrangler.toml. */
export interface Env {
  DATABASE_URL: string;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  AFFILIATE_ID: string;
}

interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

/** Neon over HTTP: no connection to hold open, fits the Worker request model. */
function neonDb(url: string): Db {
  const sql = neon(url);
  const db: Db = {
    query: async <T>(text: string, params?: unknown[]) => ({ rows: (await sql.query(text, params ?? [])) as T[] }),
    // The bot only reads (and inserts single rows); no multi-statement transactions needed.
    transaction: async fn => fn(db),
    close: async () => {},
  };
  return db;
}

async function lineReply(token: string, replyToken: string, messages: unknown[]): Promise<void> {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) console.error(`LINE reply failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
}

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return new Response('RakaKoom bot');
    if (req.method !== 'POST' || url.pathname !== '/line/webhook') return new Response('not found', { status: 404 });

    const body = await req.text();
    if (!(await verifySignature(body, req.headers.get('x-line-signature'), env.LINE_CHANNEL_SECRET))) {
      return new Response('bad signature', { status: 401 });
    }
    const events: LineEvent[] = JSON.parse(body).events ?? [];
    const deps = {
      db: neonDb(env.DATABASE_URL),
      affiliateId: env.AFFILIATE_ID,
      reply: (t: string, m: unknown[]) => lineReply(env.LINE_CHANNEL_ACCESS_TOKEN, t, m),
      resolve: (u: string) => resolveItemRef(u),
    };
    // LINE wants a fast 200; the reply token stays valid while we look things up.
    ctx.waitUntil(Promise.all(events.map(ev => handleEvent(ev, deps).catch(err => console.error('event failed', err)))));
    return new Response('ok');
  },
};
