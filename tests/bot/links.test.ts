import { affiliateLink, extractShopeeUrls, parseItemRef, resolveItemRef } from '../../src/bot/links.js';

test('extractShopeeUrls finds Shopee links in a chat message', () => {
  const text = 'ดูอันนี้หน่อย https://shopee.co.th/Sony-WH-1000XM5-i.123456.789012?sp_atk=x แล้วก็ https://s.shopee.co.th/AbCd12 นะ และ https://google.com';
  expect(extractShopeeUrls(text)).toEqual(['https://shopee.co.th/Sony-WH-1000XM5-i.123456.789012?sp_atk=x', 'https://s.shopee.co.th/AbCd12']);
});

test('extractShopeeUrls stops at Thai text or brackets glued to the link', () => {
  expect(extractShopeeUrls('https://shopee.co.th/product/1382961114/26264722963ราคาเท่าไหร่')).toEqual(['https://shopee.co.th/product/1382961114/26264722963']);
  expect(extractShopeeUrls('(https://s.shopee.co.th/AbCd12)')).toEqual(['https://s.shopee.co.th/AbCd12']);
  expect(extractShopeeUrls('`https://shopee.co.th/product/1/2`')).toEqual(['https://shopee.co.th/product/1/2']);
});

test('parseItemRef reads the common Shopee product URL forms', () => {
  expect(parseItemRef('https://shopee.co.th/Sony-WH-1000XM5-i.123456.789012?sp_atk=x')).toEqual({ shopId: 123456, itemId: 789012 });
  expect(parseItemRef('https://shopee.co.th/product/101487342/53001999315')).toEqual({ shopId: 101487342, itemId: 53001999315 });
  expect(parseItemRef('https://shopee.co.th/cerave_official_shop?categoryId=100630&itemId=13981329717&shopId=55')).toEqual({ shopId: 55, itemId: 13981329717 });
  expect(parseItemRef('https://shopee.co.th/opaanlp/101487342/53001999315')).toEqual({ shopId: 101487342, itemId: 53001999315 });
  expect(parseItemRef('https://shopee.co.th/flash_sale')).toBeNull();
});

test('resolveItemRef follows short-link redirects without reading pages', async () => {
  const hops: Record<string, string> = {
    'https://s.shopee.co.th/AbCd12': 'https://shopee.co.th/universal-link/xyz',
    'https://shopee.co.th/universal-link/xyz': 'https://shopee.co.th/Some-Item-i.10.20',
  };
  const fetchFn = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe('manual');
    expect(init?.method).toBe('HEAD');
    // Without a User-Agent Shopee redirects short links to shope.ee/error_page.
    expect((init?.headers as Record<string, string>)['User-Agent']).toMatch(/^RakaKoomBot\//);
    const to = hops[String(u)];
    return new Response(null, { status: to ? 302 : 200, headers: to ? { location: to } : {} });
  });
  expect(await resolveItemRef('https://s.shopee.co.th/AbCd12', fetchFn as unknown as typeof fetch)).toEqual({ shopId: 10, itemId: 20 });
  expect(fetchFn).toHaveBeenCalledTimes(2);
});

test('resolveItemRef gives up after 5 hops or on a dead end', async () => {
  const loop = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://s.shopee.co.th/again' } }));
  expect(await resolveItemRef('https://s.shopee.co.th/again', loop as unknown as typeof fetch)).toBeNull();
  expect(loop).toHaveBeenCalledTimes(5);
  const dead = vi.fn(async () => new Response(null, { status: 404 }));
  expect(await resolveItemRef('https://s.shopee.co.th/x', dead as unknown as typeof fetch)).toBeNull();
});

test('affiliateLink follows Shopee\'s product-feed short-link format', () => {
  expect(affiliateLink({ shopId: 101487342, itemId: 53001999315 }, '15311240105', 'rakakoom-line')).toBe(
    'https://s.shopee.co.th/an_redir?origin_link=https%3A%2F%2Fshopee.co.th%2Fproduct%2F101487342%2F53001999315&affiliate_id=15311240105&sub_id=rakakoom-line',
  );
});
