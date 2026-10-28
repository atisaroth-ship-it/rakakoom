import type { Db } from '../db/db.js';
import { shopBadge } from './badge.js';
import { baht } from './format.js';
import { MAX_BUBBLES, type ListedProduct } from './list.js';
import { shopFromRow } from './report.js';

/** A drop must be at least this share of the earlier price to count as a deal. */
export const MIN_DROP = 0.1;

/**
 * Today's deals: variants seen on the latest collected day whose price is below the price recorded
 * before it by at least MIN_DROP, and is also the lowest price recorded for that variant. Compared with
 * our own history, not the shop's crossed-out price, so a fake "before" price never counts.
 * One variant per product (the biggest drop); risky shops (red badge) are left out.
 */
export async function loadDeals(db: Db): Promise<ListedProduct[]> {
  const rows = (await db.query<Record<string, unknown>>(
    `with latest as (select max(feed_date) as d from feed_runs where status in ('success', 'suspect')),
     cur as (
       select pc.model_id, pc.price_satang, pc.effective_date
         from price_changes pc, latest where pc.last_seen = latest.d),
     prev as (
       select distinct on (c.model_id) c.model_id, p.price_satang
         from cur c join price_changes p on p.model_id = c.model_id and p.effective_date < c.effective_date
        order by c.model_id, p.effective_date desc),
     drops as (
       select distinct on (v.item_id) v.item_id, v.name, c.price_satang as now_price, pr.price_satang as before_price,
              1 - c.price_satang::numeric / pr.price_satang as drop
         from cur c join prev pr using (model_id) join variants v on v.model_id = c.model_id
        where c.price_satang <= pr.price_satang * (1 - $1::numeric)
          and c.price_satang <= (select min(x.price_satang) from price_changes x where x.model_id = c.model_id)
        order by v.item_id, drop desc)
     select d.*, i.shop_id, i.title, i.image_link,
            s.shop_name, s.shop_rating, s.penalty_score, s.is_official, s.is_preferred, s.holiday_mode
       from drops d join items i on i.item_id = d.item_id left join shops s on s.shop_id = i.shop_id
      order by d.drop desc, i.item_sold desc
      limit 40`,
    [MIN_DROP])).rows;
  const deals: ListedProduct[] = [];
  for (const r of rows) {
    const now = Number(r.now_price);
    const before = Number(r.before_price);
    const shop = shopFromRow(r);
    if (shopBadge(shop, now, []).level === 'red') continue;
    deals.push({
      itemId: Number(r.item_id),
      shopId: Number(r.shop_id),
      title: String(r.title),
      imageLink: String(r.image_link ?? ''),
      priceSatang: now,
      shop,
      lines: [
        ...(r.name && r.name !== r.title ? [`แบบ ${String(r.name)}`] : []),
        `เดิม ${baht(before)} · ลด ${Math.round((1 - now / before) * 100)}%`, 'ต่ำสุดตั้งแต่เริ่มบันทึก',
      ],
    });
    if (deals.length >= MAX_BUBBLES) break;
  }
  return deals;
}
