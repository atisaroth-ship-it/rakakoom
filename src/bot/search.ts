import type { Db } from '../db/db.js';
import { baht } from './format.js';
import { MAX_BUBBLES, type ListedProduct } from './list.js';
import { shopFromRow } from './report.js';

/** Words of a search, lower-cased; at most 5, each at least 2 characters (by code point). */
export function searchWords(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(w => [...w].length >= 2).slice(0, 5);
}

const likeEscape = (w: string) => w.replace(/[\\%_]/g, c => '\\' + c);

export interface SearchPage {
  products: ListedProduct[];
  /** there are more results after this page */
  more: boolean;
}

/** Title and brand without spaces and hyphens, lower-cased; the same expression as the index in migration 007. */
const SEARCH_TEXT = `replace(replace(lower(title || ' ' || brand), ' ', ''), '-', '')`;

/**
 * Products whose title or brand contains every word, best sellers first, one product per shop (its best seller).
 * Only products seen in the feed recently (latest_prices), so every result has a current price. Thai has no
 * spaces between words, so this is a substring match, not word search; spaces and hyphens in titles are ignored.
 * `offset` pages through the results.
 */
export async function searchProducts(db: Db, q: string, offset = 0): Promise<SearchPage> {
  // Hyphens are ignored on both sides; a word that is only hyphens drops out.
  const words = searchWords(q).map(w => w.replace(/-/g, '')).filter(w => w);
  if (!words.length) return { products: [], more: false };
  const where = words.map((_, i) => `${SEARCH_TEXT} like $${i + 1}`).join(' and ');
  const rows = (await db.query<Record<string, unknown>>(
    `select * from (
       select distinct on (shop_id) item_id, shop_id, title, image_key, min_price_satang, max_price_satang, variant_count,
              item_sold, shop_name, shop_rating, penalty_score, is_official, is_preferred, holiday_mode
         from latest_prices
        where ${where}
        order by shop_id, item_sold desc, item_id
     ) per_shop
     order by item_sold desc, item_id
     limit ${MAX_BUBBLES + 1} offset $${words.length + 1}`,
    [...words.map(w => `%${likeEscape(w)}%`), offset])).rows;
  const products = rows.slice(0, MAX_BUBBLES).map(r => {
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
  return { products, more: rows.length > MAX_BUBBLES };
}
