/** Heartbeat in healthchecks.io style: GET {url} on success, GET {url}/fail on failure. Never throws. */
export function createPing(url: string | null, fetchFn: typeof fetch = fetch): (status: 'success' | 'fail') => Promise<void> {
  return async status => {
    if (!url) return;
    try {
      await fetchFn(status === 'success' ? url : `${url}/fail`);
    } catch (e) {
      console.error('heartbeat ping failed:', e);
    }
  };
}
