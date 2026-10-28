import { shopBadge } from './badge.js';
import { baht } from './format.js';
import { affiliateLink } from './links.js';
import type { ShopInfo } from './report.js';

const INK = '#0E3B2C';
const GREEN = '#1FA463';
const MUTED = '#6B7D74';
const text = (t: string, o: Record<string, unknown> = {}) => ({ type: 'text', text: t, wrap: true, size: 'sm', color: INK, ...o });
/** Shorten by code point so an emoji is never split (LINE rejects broken text). */
const cut = (s: string, n: number) => {
  const cps = [...s];
  return cps.length > n ? cps.slice(0, n - 1).join('') + '…' : s;
};

/** LINE carousels hold at most 12 bubbles. */
export const MAX_BUBBLES = 10;

export interface ListedProduct {
  itemId: number;
  shopId: number;
  title: string;
  imageLink: string;
  priceSatang: number;
  shop: ShopInfo;
  /** lines under the price, e.g. the drop or the price range */
  lines: string[];
}

/** A small product bubble: "เช็คราคา" opens the full card (postback), the green button goes to Shopee. */
export function productBubble(p: ListedProduct, affiliateId: string) {
  const badge = shopBadge(p.shop, p.priceSatang, []);
  return {
    type: 'bubble', size: 'kilo',
    ...(p.imageLink.startsWith('https://') ? { hero: { type: 'image', url: p.imageLink, size: 'full', aspectRatio: '1:1', aspectMode: 'cover' } } : {}),
    body: {
      type: 'box', layout: 'vertical', spacing: 'xs', contents: [
        text(cut(p.title, 60), { weight: 'bold', maxLines: 2 }),
        text(baht(p.priceSatang), { weight: 'bold', size: 'lg', color: GREEN }),
        ...p.lines.map(l => text(l, { size: 'xs', color: MUTED })),
        text(`${badge.label}`, { size: 'xxs', margin: 'sm' }),
        text(cut(p.shop.name, 30), { size: 'xxs', color: MUTED }),
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'xs', contents: [
        { type: 'button', style: 'primary', color: GREEN, height: 'sm',
          action: { type: 'uri', label: 'ดูใน Shopee', uri: affiliateLink({ shopId: p.shopId, itemId: p.itemId }, affiliateId, 'rakakoom-line') } },
        { type: 'button', style: 'secondary', height: 'sm',
          action: { type: 'postback', label: 'เช็คราคา', data: `item:${p.itemId}:${p.shopId}`, displayText: 'เช็คราคา' } },
      ],
    },
  };
}

export function productCarousel(products: ListedProduct[], affiliateId: string, altText: string) {
  return {
    type: 'flex' as const,
    altText: cut(altText, 380),
    contents: { type: 'carousel', contents: products.slice(0, MAX_BUBBLES).map(p => productBubble(p, affiliateId)) },
  };
}
