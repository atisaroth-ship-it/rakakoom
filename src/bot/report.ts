import type { Db } from '../db/db.js';

export interface ShopInfo {
  shopId: number;
  name: string;
  rating: number | null;
  penaltyScore: number | null;
  isOfficial: boolean;
  isPreferred: boolean;
  holidayMode: boolean;
}

export interface PricePoint {
  priceSatang: number;
  date: string;
}

export interface VariantReport {
  modelId: number;
  name: string;
  /** price on lastSeen (the feed only shows each product on some days) */
  priceSatang: number;
  lastSeen: string;
  low: PricePoint;
  high: PricePoint;
}

export interface ItemReport {
  itemId: number;
  shopId: number;
  title: string;
  brand: string;
  category1: string;
  imageLink: string;
  itemSold: number;
  shop: ShopInfo;
  variants: VariantReport[];
  /** first and latest day the collector saved data; every "since" claim is bounded by these */
  firstRecorded: string;
  latestRecorded: string;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function shopFromRow(r: Record<string, unknown>): ShopInfo {
  return {
    shopId: Number(r.shop_id),
    name: String(r.shop_name ?? ''),
    rating: num(r.shop_rating),
    penaltyScore: num(r.penalty_score),
    isOfficial: Boolean(r.is_official),
    isPreferred: Boolean(r.is_preferred),
    holidayMode: Boolean(r.holiday_mode),
  };
}

export async function loadItemReport(db: Db, itemId: number): Promise<ItemReport | null> {
  const it = (await db.query<Record<string, unknown>>(
    `select i.item_id, i.shop_id, i.title, i.brand, i.category1, i.image_link, i.item_sold,
            s.shop_name, s.shop_rating, s.penalty_score, s.is_official, s.is_preferred, s.holiday_mode
       from items i left join shops s on s.shop_id = i.shop_id
      where i.item_id = $1`, [itemId])).rows[0];
  if (!it) return null;

  const range = (await db.query<{ first: string | null; latest: string | null }>(
    `select to_char(min(feed_date), 'YYYY-MM-DD') as first, to_char(max(feed_date), 'YYYY-MM-DD') as latest
       from feed_runs where status in ('success', 'suspect')`)).rows[0]!;

  const variants = (await db.query<Record<string, unknown>>(
    `select v.model_id, v.name, v.price_satang, to_char(v.last_seen, 'YYYY-MM-DD') as last_seen,
            lo.price_satang as low_price, to_char(lo.effective_date, 'YYYY-MM-DD') as low_date,
            hi.price_satang as high_price, to_char(hi.effective_date, 'YYYY-MM-DD') as high_date
       from variants v
       left join lateral (select price_satang, effective_date from price_changes p where p.model_id = v.model_id
                           order by price_satang asc, effective_date asc limit 1) lo on true
       left join lateral (select price_satang, effective_date from price_changes p where p.model_id = v.model_id
                           order by price_satang desc, effective_date asc limit 1) hi on true
      where v.item_id = $1
      order by v.model_id`, [itemId])).rows;

  return {
    itemId: Number(it.item_id),
    shopId: Number(it.shop_id),
    title: String(it.title),
    brand: String(it.brand),
    category1: String(it.category1),
    imageLink: String(it.image_link ?? ''),
    itemSold: Number(it.item_sold),
    shop: shopFromRow(it),
    firstRecorded: range.first ?? '',
    latestRecorded: range.latest ?? '',
    variants: variants.map(v => {
      const price = Number(v.price_satang);
      const lastSeen = String(v.last_seen);
      return {
        modelId: Number(v.model_id),
        name: String(v.name),
        priceSatang: price,
        lastSeen,
        low: v.low_price === null ? { priceSatang: price, date: lastSeen } : { priceSatang: Number(v.low_price), date: String(v.low_date) },
        high: v.high_price === null ? { priceSatang: price, date: lastSeen } : { priceSatang: Number(v.high_price), date: String(v.high_date) },
      };
    }),
  };
}
