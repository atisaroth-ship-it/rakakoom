import type { Db } from '../db/db.js';
import { baht } from './format.js';
import { MAX_BUBBLES, type ListedProduct } from './list.js';
import { shopFromRow } from './report.js';

/** Words of a search, lower-cased; at most 5, each at least 2 characters (by code point). */
export function searchWords(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(w => [...w].length >= 2).slice(0, 5);
}

const likeEscape = (w: string) => w.replace(/[\\%_]/g, c => '\\' + c);

/**
 * Products whose title or brand contains every word, best sellers first. Only products seen in the feed
 * recently (latest_prices), so every result has a current price. Thai has no spaces between words,
 * so this is a substring match, not word search.
 */
export async function searchProducts(db: Db, q: string): Promise<ListedProduct[]> {
  const words = searchWords(q);
  if (!words.length) return [];
  const rows = (await db.query<Record<string, unknown>>(
    `select item_id, shop_id, title, image_key, min_price_satang, max_price_satang, variant_count,
            shop_name, shop_rating, penalty_score, is_official, is_preferred, holiday_mode
       from latest_prices
      where lower(title || ' ' || brand) like all ($1::text[])
      order by item_sold desc, item_id
      limit ${MAX_BUBBLES}`,
    [words.map(w => `%${likeEscape(w)}%`)])).rows;
  return rows.map(r => {
    const min = Number(r.min_price_satang);
    const max = Number(r.max_price_satang);
    return {
      itemId: Number(r.item_id),
      shopId: Number(r.shop_id),
      title: String(r.title),
      imageLink: r.image_key ? `https://cf.shopee.co.th/file/${String(r.image_key)}` : '',
      priceSatang: min,
      shop: shopFromRow(r),
      lines: [min === max ? 'ราคาล่าสุดที่เห็น' : `มี ${Number(r.variant_count)} แบบ ถึง ${baht(max)}`],
    };
  });
}
