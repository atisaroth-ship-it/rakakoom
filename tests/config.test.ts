import { assertAlertsConfigured, loadConfig } from '../src/config.js';

test('loadConfig splits FEED_URLS and nulls optional vars', () => {
  const c = loadConfig({ DATABASE_URL: 'postgres://x', FEED_URLS: ' https://a/1 , https://a/2 ,' });
  expect(c.feedUrls).toEqual(['https://a/1', 'https://a/2']);
  expect(c.lineChannelAccessToken).toBeNull();
});

test('loadConfig names every missing var', () => {
  expect(() => loadConfig({})).toThrow(/DATABASE_URL.*FEED_URLS/);
});

test('assertAlertsConfigured names every missing alert setting', () => {
  const c = loadConfig({ DATABASE_URL: 'postgres://x', FEED_URLS: 'https://a/1' });
  expect(() => assertAlertsConfigured(c)).toThrow(/LINE_CHANNEL_ACCESS_TOKEN.*ADMIN_LINE_USER_ID.*HEALTHCHECK_URL/);
  const ok = loadConfig({ DATABASE_URL: 'postgres://x', FEED_URLS: 'https://a/1', LINE_CHANNEL_ACCESS_TOKEN: 't', ADMIN_LINE_USER_ID: 'U', HEALTHCHECK_URL: 'https://hc/x' });
  expect(() => assertAlertsConfigured(ok)).not.toThrow();
});
