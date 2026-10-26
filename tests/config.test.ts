import { loadConfig } from '../src/config.js';

test('loadConfig splits FEED_URLS and nulls optional vars', () => {
  const c = loadConfig({ DATABASE_URL: 'postgres://x', FEED_URLS: ' https://a/1 , https://a/2 ,' });
  expect(c.feedUrls).toEqual(['https://a/1', 'https://a/2']);
  expect(c.lineChannelAccessToken).toBeNull();
});

test('loadConfig names every missing var', () => {
  expect(() => loadConfig({})).toThrow(/DATABASE_URL.*FEED_URLS/);
});
