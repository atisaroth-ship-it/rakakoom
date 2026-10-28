export interface ItemRef {
  shopId: number;
  itemId: number;
}

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const SHOPEE_HOST = /^(?:[a-z0-9-]+\.)?(?:shopee\.co\.th|shope\.ee|shp\.ee)$/i;
const MAX_HOPS = 5;

export function extractShopeeUrls(text: string): string[] {
  return (text.match(URL_RE) ?? []).filter(u => {
    try {
      return SHOPEE_HOST.test(new URL(u).hostname);
    } catch {
      return false;
    }
  });
}

const safeId = (s: string | null | undefined): number | null => {
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
};

/** shopid/itemid from a full Shopee product URL; null for anything else (short links need resolveItemRef). */
export function parseItemRef(raw: string): ItemRef | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)shopee\.co\.th$/i.test(u.hostname)) return null;
  const path = decodeURIComponent(u.pathname);
  const pick = (a: string | null | undefined, b: string | null | undefined): ItemRef | null => {
    const shopId = safeId(a);
    const itemId = safeId(b);
    return shopId !== null && itemId !== null ? { shopId, itemId } : null;
  };
  // ...-i.{shop}.{item}
  const dotted = /-i\.(\d+)\.(\d+)(?:$|[/?#])/.exec(path + '/');
  if (dotted) return pick(dotted[1], dotted[2]);
  // /product/{shop}/{item}  or  /{username}/{shop}/{item}
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 3 && /^\d+$/.test(parts.at(-1)!) && /^\d+$/.test(parts.at(-2)!)) return pick(parts.at(-2), parts.at(-1));
  // ?shopId=&itemId=
  return pick(u.searchParams.get('shopId') ?? u.searchParams.get('shopid'), u.searchParams.get('itemId') ?? u.searchParams.get('itemid'));
}

/**
 * Item behind any Shopee link. Short links are followed with HEAD requests and the Location header only;
 * page content is never read (no scraping).
 */
export async function resolveItemRef(url: string, fetchFn: typeof fetch = fetch): Promise<ItemRef | null> {
  let current = url;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const direct = parseItemRef(current);
    if (direct) return direct;
    let res: Response;
    try {
      res = await fetchFn(current, { method: 'HEAD', redirect: 'manual' });
    } catch {
      return null;
    }
    const next = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !next) return null;
    current = new URL(next, current).toString();
  }
  return parseItemRef(current);
}

/** Shopee's documented link format for product-feed partners ("การสร้างลิงก์สั้นแบบกำหนดเอง"). */
export function affiliateLink(ref: ItemRef, affiliateId: string, subId: string): string {
  const origin = `https://shopee.co.th/product/${ref.shopId}/${ref.itemId}`;
  return `https://s.shopee.co.th/an_redir?origin_link=${encodeURIComponent(origin)}&affiliate_id=${encodeURIComponent(affiliateId)}&sub_id=${encodeURIComponent(subId)}`;
}
