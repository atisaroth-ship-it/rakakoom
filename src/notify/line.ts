const PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const MAX_TEXT = 4900;

/** Push a text message to the owner. A broken alert must never change a run's outcome, so this never throws. */
export function createLineAlert(
  token: string | null,
  userId: string | null,
  fetchFn: typeof fetch = fetch,
): (msg: string) => Promise<void> {
  return async msg => {
    if (!token || !userId) {
      console.warn('LINE alert not configured:', msg);
      return;
    }
    try {
      const res = await fetchFn(PUSH_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: msg.slice(0, MAX_TEXT) }] }),
      });
      if (!res.ok) console.error(`LINE alert failed: HTTP ${res.status}`, msg);
    } catch (e) {
      console.error('LINE alert failed:', e, msg);
    }
  };
}
