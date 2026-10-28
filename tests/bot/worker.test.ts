vi.mock('@neondatabase/serverless', () => ({ neon: () => ({ query: async () => [] }) }));

import worker from '../../src/bot/worker.js';

const env = { DATABASE_URL: 'postgres://x', LINE_CHANNEL_SECRET: 'secret', LINE_CHANNEL_ACCESS_TOKEN: 'tok', AFFILIATE_ID: '1' };
const ctx = () => {
  const pending: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, pending };
};
async function sign(body: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))));
}

test('health check on GET /', async () => {
  const r = await worker.fetch(new Request('https://bot.example/'), env, ctx());
  expect(r.status).toBe(200);
});

test('webhook rejects a bad signature', async () => {
  const r = await worker.fetch(new Request('https://bot.example/line/webhook', { method: 'POST', body: '{}', headers: { 'x-line-signature': 'nope' } }), env, ctx());
  expect(r.status).toBe(401);
});

test('webhook answers 200 at once and replies in the background', async () => {
  const replies: unknown[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
    replies.push({ url: String(u), body: JSON.parse(String(init?.body)) });
    return new Response('{}');
  }) as typeof fetch;
  try {
    const body = JSON.stringify({ events: [{ type: 'message', replyToken: 'R1', message: { type: 'text', text: 'สวัสดี' } }] });
    const c = ctx();
    const r = await worker.fetch(new Request('https://bot.example/line/webhook', { method: 'POST', body, headers: { 'x-line-signature': await sign(body, 'secret') } }), env, c);
    expect(r.status).toBe(200);
    await Promise.all(c.pending);
    expect(replies).toEqual([{ url: 'https://api.line.me/v2/bot/message/reply', body: { replyToken: 'R1', messages: [expect.objectContaining({ type: 'text' })] } }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('unknown paths are 404', async () => {
  expect((await worker.fetch(new Request('https://bot.example/x'), env, ctx())).status).toBe(404);
});
