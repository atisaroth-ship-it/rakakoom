import type { ParsedItem } from '../feed/parseRow.js';
import type { Db } from './db.js';

export interface ApplyStats {
  items: number;
  variants: number;
  priceChanges: number;
}

/** Stage one batch for a run. Sent as a single JSON parameter, so batch size never hits the bind-parameter limit. */
export async function stageItems(db: Db, runId: number, items: ParsedItem[]): Promise<void> {
  if (items.length === 0) return;
  // attributes and links are not stored (migration 003); leave them out of staging too.
  const itemRows = items.map(({ variants: _v, attributes: _a, productLink: _p, affiliateLink: _l, ...rest }) => rest);
  const variantRows = items.flatMap(it => it.variants.map(v => ({ ...v, itemId: it.itemId })));
  await db.query(
    `insert into staging_items (run_id, item_id, data)
     select $1, (e->>'itemId')::bigint, e from jsonb_array_elements($2::jsonb) with ordinality as t(e, n) order by n`,
    [runId, JSON.stringify(itemRows)],
  );
  await db.query(
    `insert into staging_variants (run_id, item_id, model_id, name, price_satang)
     select $1, (e->>'itemId')::bigint, (e->>'modelId')::bigint, e->>'name', (e->>'priceSatang')::bigint
       from jsonb_array_elements($2::jsonb) with ordinality as t(e, n) order by n`,
    [runId, JSON.stringify(variantRows)],
  );
}

export async function clearStaging(db: Db, runId: number): Promise<void> {
  await db.query('delete from staging_items where run_id = $1', [runId]);
  await db.query('delete from staging_variants where run_id = $1', [runId]);
}

/**
 * Move a run's staging rows into the main tables. Must be called inside db.transaction.
 * When a row repeats within the run, the last staged one wins.
 */
export async function applyRun(db: Db, runId: number, feedDate: string, prevDate: string | null): Promise<ApplyStats> {
  await db.query(
    `create temp table run_items on commit drop as
       select distinct on (item_id) item_id, data from staging_items where run_id = $1 order by item_id, seq desc`,
    [runId],
  );
  await db.query(
    `create temp table run_variants on commit drop as
       select distinct on (model_id) model_id, item_id, name, price_satang
         from staging_variants where run_id = $1 order by model_id, seq desc`,
    [runId],
  );

  await db.query(
    `insert into shops (shop_id, shop_name, seller_name, shop_rating, penalty_score, is_official, is_preferred, holiday_mode, updated_on)
     select distinct on (s."shopId") s."shopId", s."shopName", s."sellerName", s."shopRating", s."penaltyScore",
            s."isOfficial", s."isPreferred", s."holidayMode", $1::date
       from run_items ri,
            jsonb_to_record(ri.data->'shop') as s("shopId" bigint, "shopName" text, "sellerName" text, "shopRating" numeric,
              "penaltyScore" numeric, "isOfficial" boolean, "isPreferred" boolean, "holidayMode" boolean)
      order by s."shopId", ri.item_id desc
     on conflict (shop_id) do update set
       shop_name = excluded.shop_name, seller_name = excluded.seller_name, shop_rating = excluded.shop_rating,
       penalty_score = excluded.penalty_score, is_official = excluded.is_official, is_preferred = excluded.is_preferred,
       holiday_mode = excluded.holiday_mode, updated_on = excluded.updated_on`,
    [feedDate],
  );

  const items = await db.query(
    `insert into items (item_id, shop_id, title, brand, category1, category2, category3, category_id1, category_id2,
       category_id3, image_link, item_rating, item_sold, stock, cross_border,
       condition, price_satang, sale_price_satang, discount_percentage, first_seen, last_seen)
     select item_id, (data->>'shopId')::bigint, data->>'title', data->>'brand',
            data->'categories'->>0, data->'categories'->>1, data->'categories'->>2,
            (data->'categoryIds'->>0)::bigint, (data->'categoryIds'->>1)::bigint, (data->'categoryIds'->>2)::bigint,
            data->>'imageLink',
            (data->>'itemRating')::numeric, (data->>'itemSold')::bigint, (data->>'stock')::bigint, (data->>'crossBorder')::boolean,
            data->>'condition', (data->>'priceSatang')::bigint, (data->>'salePriceSatang')::bigint,
            (data->>'discountPercentage')::numeric, $1::date, $1::date
       from run_items
     on conflict (item_id) do update set
       shop_id = excluded.shop_id, title = excluded.title, brand = excluded.brand,
       category1 = excluded.category1, category2 = excluded.category2, category3 = excluded.category3,
       category_id1 = excluded.category_id1, category_id2 = excluded.category_id2, category_id3 = excluded.category_id3,
       image_link = excluded.image_link, item_rating = excluded.item_rating, item_sold = excluded.item_sold,
       stock = excluded.stock, cross_border = excluded.cross_border, condition = excluded.condition,
       price_satang = excluded.price_satang, sale_price_satang = excluded.sale_price_satang,
       discount_percentage = excluded.discount_percentage, last_seen = excluded.last_seen
     returning item_id`,
    [feedDate],
  );

  const variants = await db.query(
    `insert into variants (model_id, item_id, name, price_satang, first_seen, last_seen)
     select model_id, item_id, name, price_satang, $1::date, $1::date from run_variants
     on conflict (model_id) do update set
       item_id = excluded.item_id, name = excluded.name, price_satang = excluded.price_satang, last_seen = excluded.last_seen
     returning model_id`,
    [feedDate],
  );

  // price_changes rows are spans: a price seen on every collected day from effective_date to last_seen.
  // A span only grows when the variant was also seen on the previous collected day; any gap starts a new span,
  // so "not in the feed" is never mistaken for "price unchanged".

  // Undo extensions made by an earlier run today (they were extended from prevDate).
  if (prevDate) {
    await db.query(
      `update price_changes set last_seen = $2::date
        where last_seen = $1::date and effective_date < $1::date`,
      [feedDate, prevDate],
    );
  }
  await db.query(
    `delete from price_changes pc using run_variants rv
      where pc.model_id = rv.model_id and pc.effective_date = $1::date`,
    [feedDate],
  );

  await db.query(
    `create temp table run_prev on commit drop as
       select rv.model_id, rv.price_satang as today, p.effective_date as span_start, p.price_satang as prev, p.last_seen as prev_last
         from run_variants rv
         left join lateral (
           select pc.effective_date, pc.price_satang, pc.last_seen from price_changes pc
            where pc.model_id = rv.model_id and pc.effective_date < $1::date
            order by pc.effective_date desc limit 1
         ) p on true`,
    [feedDate],
  );
  await db.query(
    `update price_changes pc set last_seen = $1::date
       from run_prev rp
      where pc.model_id = rp.model_id and pc.effective_date = rp.span_start
        and rp.prev = rp.today and rp.prev_last = $2::date`,
    [feedDate, prevDate],
  );
  const changes = await db.query(
    `insert into price_changes (model_id, effective_date, price_satang, last_seen)
     select model_id, $1::date, today, $1::date from run_prev
      where prev is null or prev <> today or prev_last is distinct from $2::date
     returning model_id`,
    [feedDate, prevDate],
  );

  await clearStaging(db, runId);
  return { items: items.rows.length, variants: variants.rows.length, priceChanges: changes.rows.length };
}
