import type { Db } from '../db/db.js';
import { shopFromRow, type ItemReport, type ShopInfo, type VariantReport } from './report.js';

export interface Alternative {
  itemId: number;
  shopId: number;
  title: string;
  variantName: string;
  priceSatang: number;
  lastSeen: string;
  shop: ShopInfo;
}

/** Sizes and units look like model codes ("128GB", "5G", "65W") but say nothing about the model. */
const UNIT = /^\d+(?:[.]\d+)?(?:GB|TB|MB|MAH|W|KW|V|HZ|KHZ|CM|MM|M|L|ML|KG|G|IN|INCH|K|P|FPS|BIT|PCS|BTU|CC|LBS?)$/;

/** Model codes in a title: ASCII tokens with letters and digits, 4+ chars after dropping - _ . / */
export function modelTokens(title: string): string[] {
  const out = new Set<string>();
  for (const raw of title.split(/[^A-Za-z0-9\-_.]+/)) {
    const t = raw.replace(/[-_.]/g, '').toUpperCase();
    if (t.length < 4 || !/[A-Z]/.test(t) || !/\d/.test(t) || UNIT.test(t)) continue;
    out.add(t);
  }
  return [...out];
}

const COLOURS: [string, string][] = [
  ['น้ำเงิน', 'blue'], ['กรมท่า', 'navy'], ['ดำ', 'black'], ['ขาว', 'white'], ['เงิน', 'silver'], ['ทอง', 'gold'],
  ['แดง', 'red'], ['เขียว', 'green'], ['ฟ้า', 'blue'], ['ชมพู', 'pink'], ['เทา', 'gray'], ['ม่วง', 'purple'],
  ['ส้ม', 'orange'], ['เหลือง', 'yellow'], ['น้ำตาล', 'brown'], ['grey', 'gray'],
];

/** Comparable form of a variant name ("สีดำ" ≈ "Black"). */
export function normalizeVariant(name: string): string {
  let s = name.toLowerCase().trim();
  for (const [from, to] of COLOURS) s = s.split(from).join(to);
  return s.replace(/สี|colou?r/g, '').replace(/[^a-z0-9฀-๿]/g, '');
}

/** Other shops' listings of the same brand + model code + variant, seen in the last week of data; cheapest first. */
export async function findSameModel(db: Db, item: ItemReport, variant: VariantReport): Promise<Alternative[]> {
  const tokens = modelTokens(item.title);
  if (tokens.length === 0) return [];
  const rows = (await db.query<Record<string, unknown>>(
    `select i.item_id, i.shop_id, i.title, v.model_id, v.name, v.price_satang,
            to_char(v.last_seen, 'YYYY-MM-DD') as last_seen,
            (select count(*) from variants v2 where v2.item_id = i.item_id) as variant_count,
            s.shop_name, s.shop_rating, s.penalty_score, s.is_official, s.is_preferred, s.holiday_mode
       from items i
       join variants v on v.item_id = i.item_id
       left join shops s on s.shop_id = i.shop_id
      where lower(i.brand) = lower($1) and i.item_id <> $2 and i.category1 = $3
        and v.last_seen >= $4::date - 6`,
    [item.brand, item.itemId, item.category1, item.latestRecorded])).rows;

  const wanted = normalizeVariant(variant.name);
  const single = item.variants.length === 1;
  const out: Alternative[] = [];
  for (const r of rows) {
    const theirs = modelTokens(String(r.title));
    if (!tokens.some(t => theirs.includes(t))) continue;
    const sameVariant = single ? Number(r.variant_count) === 1 : normalizeVariant(String(r.name)) === wanted;
    if (!sameVariant) continue;
    out.push({
      itemId: Number(r.item_id),
      shopId: Number(r.shop_id),
      title: String(r.title),
      variantName: String(r.name),
      priceSatang: Number(r.price_satang),
      lastSeen: String(r.last_seen),
      shop: shopFromRow(r),
    });
  }
  return out.sort((a, b) => a.priceSatang - b.priceSatang);
}
