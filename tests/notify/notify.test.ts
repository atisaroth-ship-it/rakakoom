import { createLineAlert } from '../../src/notify/line.js';
import { createPing } from '../../src/notify/ping.js';

const ok = () => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{}', { status: 200 }));

test('line alert posts push message', async () => {
  const f = ok();
  await createLineAlert('tok', 'U1', f as unknown as typeof fetch)('RakaKoom: x');
  const [url, init] = f.mock.calls[0]!;
  expect(url).toBe('https://api.line.me/v2/bot/message/push');
  expect(init?.method).toBe('POST');
  expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  const body = JSON.parse(String(init?.body));
  expect(body.to).toBe('U1');
  expect(body.messages[0]).toEqual({ type: 'text', text: 'RakaKoom: x' });
});

test('line alert truncates to 4900 characters', async () => {
  const f = ok();
  await createLineAlert('tok', 'U1', f as unknown as typeof fetch)('ก'.repeat(6000));
  expect(JSON.parse(String(f.mock.calls[0]![1]?.body)).messages[0].text).toHaveLength(4900);
});

test('line alert without token does not call fetch', async () => {
  const f = ok();
  await createLineAlert(null, 'U1', f as unknown as typeof fetch)('x');
  await createLineAlert('tok', null, f as unknown as typeof fetch)('x');
  expect(f).not.toHaveBeenCalled();
});

test('line alert swallows http error', async () => {
  const f = vi.fn(async () => new Response('err', { status: 500 }));
  await expect(createLineAlert('tok', 'U1', f as unknown as typeof fetch)('x')).resolves.toBeUndefined();
  const g = vi.fn(async () => { throw new Error('network down'); });
  await expect(createLineAlert('tok', 'U1', g as unknown as typeof fetch)('x')).resolves.toBeUndefined();
});

test('ping reports success and fail', async () => {
  const f = ok();
  const ping = createPing('https://hc/abc', f as unknown as typeof fetch);
  await ping('success');
  await ping('fail');
  expect(f.mock.calls.map(c => c[0])).toEqual(['https://hc/abc', 'https://hc/abc/fail']);
});

test('ping without url and on network error does nothing harmful', async () => {
  const f = ok();
  await createPing(null, f as unknown as typeof fetch)('success');
  expect(f).not.toHaveBeenCalled();
  const g = vi.fn(async () => { throw new Error('down'); });
  await expect(createPing('https://hc/abc', g as unknown as typeof fetch)('fail')).resolves.toBeUndefined();
});
