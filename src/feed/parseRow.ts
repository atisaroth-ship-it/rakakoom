import type { FeedRecord } from './columns.js';

export interface ParsedShop {
  shopId: number;
  shopName: string;
  sellerName: string;
  shopRating: number | null;
  penaltyScore: number | null;
  isOfficial: boolean;
  isPreferred: boolean;
  holidayMode: boolean;
}

export interface ParsedVariant {
  modelId: number;
  name: string;
  priceSatang: number;
}

export interface ParsedItem {
  itemId: number;
  shopId: number;
  title: string;
  brand: string;
  categories: [string, string, string];
  categoryIds: [number | null, number | null, number | null];
  attributes: unknown;
  productLink: string;
  affiliateLink: string;
  imageLink: string;
  itemRating: number | null;
  itemSold: number;
  stock: number;
  crossBorder: boolean;
  condition: string;
  priceSatang: number;
  salePriceSatang: number;
  discountPercentage: number;
  variants: ParsedVariant[];
  shop: ParsedShop;
}

export type SkipReason = 'out_of_scope' | 'no_brand' | 'bad_ids' | 'variant_mismatch' | 'bad_price';

export type ParseResult = { ok: true; item: ParsedItem } | { ok: false; reason: SkipReason };

/** แปลงราคาข้อความเป็นสตางค์โดยไม่ผ่าน float เช่น "19.99" → 1999 */
export function toSatang(s: string): number | null {
  const m = /^(\d+)(?:\.(\d{0,2})\d*)?$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

const id = (s: string | undefined): number | null => {
  if (!s || !/^\d+$/.test(s.trim())) return null;
  const n = Number(s.trim());
  return Number.isSafeInteger(n) ? n : null;
};
/** Postgres text/jsonb reject NUL and lone surrogates; one such value would fail the whole day's apply. */
const clean = (s: string): string => s.replace(/\u0000/g, '').toWellFormed();
const cleanDeep = (v: unknown): unknown => {
  if (typeof v === 'string') return clean(v);
  if (Array.isArray(v)) return v.map(cleanDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [clean(k), cleanDeep(x)]));
  return v;
};
const num = (s: string | undefined): number | null => {
  if (!s || !s.trim()) return null;
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
};
const int = (s: string | undefined): number => Math.trunc(num(s) ?? 0);
const list = (s: string | undefined): string[] => {
  const parts = (s ?? '').split('|').map(p => p.trim());
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
};
const isNoBrand = (b: string): boolean => {
  const k = b.toLowerCase().replace(/\s+/g, '');
  return k === '' || k === 'nobrand';
};

export function parseFeedRow(raw: FeedRecord): ParseResult {
  const r: FeedRecord = {};
  for (const [k, v] of Object.entries(raw)) r[k] = clean(v ?? '');
  const brand = (r.global_brand ?? '').trim();
  if (isNoBrand(brand)) return { ok: false, reason: 'no_brand' };

  const itemId = id(r.itemid);
  const shopId = id(r.shopid);
  if (itemId === null || shopId === null) return { ok: false, reason: 'bad_ids' };

  const ids = list(r.model_ids);
  const names = list(r.model_names);
  const prices = list(r.model_prices);
  if (ids.length === 0 || ids.length !== names.length || ids.length !== prices.length) {
    return { ok: false, reason: 'variant_mismatch' };
  }
  const variants: ParsedVariant[] = [];
  for (let i = 0; i < ids.length; i++) {
    const modelId = id(ids[i]);
    if (modelId === null) return { ok: false, reason: 'bad_ids' };
    const priceSatang = toSatang(prices[i]!);
    if (priceSatang === null) return { ok: false, reason: 'bad_price' };
    variants.push({ modelId, name: names[i]!, priceSatang });
  }

  let attributes: unknown = null;
  try {
    attributes = r.global_item_attributes ? cleanDeep(JSON.parse(r.global_item_attributes)) : null;
  } catch {
    attributes = null;
  }

  return {
    ok: true,
    item: {
      itemId,
      shopId,
      title: r.title ?? '',
      brand,
      categories: [r.global_category1 ?? '', r.global_category2 ?? '', r.global_category3 ?? ''],
      categoryIds: [id(r.global_catid1), id(r.global_catid2), id(r.global_catid3)],
      attributes,
      productLink: r.product_link ?? '',
      affiliateLink: r['product_short link'] ?? '',
      imageLink: r.image_link ?? '',
      itemRating: num(r.item_rating),
      itemSold: int(r.item_sold),
      stock: int(r.stock),
      crossBorder: r.cb_option === 'Cross border',
      condition: r.condition ?? '',
      priceSatang: toSatang(r.price ?? '') ?? 0,
      salePriceSatang: toSatang(r.sale_price ?? '') ?? 0,
      discountPercentage: int(r.discount_percentage),
      variants,
      shop: {
        shopId,
        shopName: r.shop_name ?? '',
        sellerName: r.seller_name ?? '',
        shopRating: num(r.shop_rating),
        penaltyScore: num(r.seller_penalty_score),
        isOfficial: r.is_official_shop === 'Official shop',
        isPreferred: r.is_preferred_shop === 'Preferred shop',
        holidayMode: r.holiday_mode_on === 'On',
      },
    },
  };
}
