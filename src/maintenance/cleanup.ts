import type { Db } from '../db/db.js';
import type { ParsedItem } from '../feed/parseRow.js';
import { applyScope, matchRule, type CategoryScope } from '../feed/scope.js';

export interface CleanupStats {
  itemsRemoved: number;
  variantsRemoved: number;
  priceRowsRemoved: number;
  shopsRemoved: number;
}

interface ItemRow { item_id: number; title: string; category1: string; category2: string; category3: string; item_sold: number }
interface VariantRow { model_id: number; item_id: number; name: string; price_satang: number }

/**
 * One-off: delete stored products (and their variants, price history and now-unused shops) that the
 * current scope would not collect. Same rules as the daily run, applied to what is stored.
 * Owner-approved on 28 Oct 2026 after a backup; never run automatically.
 */
export async function cleanupOutOfScope(db: Db, scope: CategoryScope): Promise<CleanupStats> {
  const items = (await db.query<ItemRow>(
    'select item_id, title, category1, category2, category3, item_sold from items')).rows;
  const variantsByItem = new Map<number, VariantRow[]>();
  for (const v of (await db.query<VariantRow>('select model_id, item_id, name, price_satang from variants')).rows) {
    const list = variantsByItem.get(Number(v.item_id)) ?? [];
    list.push(v);
    variantsByItem.set(Number(v.item_id), list);
  }

  const dropItems: number[] = [];
  const dropModels: number[] = [];
  for (const it of items) {
    const id = Number(it.item_id);
    const variants = variantsByItem.get(id) ?? [];
    const rule = matchRule(
      { global_category1: it.category1, global_category2: it.category2, global_category3: it.category3, title: it.title }, scope);
    const asParsed = {
      itemId: id, title: it.title, itemSold: Number(it.item_sold),
      variants: variants.map(v => ({ modelId: Number(v.model_id), name: v.name, priceSatang: Number(v.price_satang) })),
    } as ParsedItem;
    const kept = rule ? applyScope(asParsed, rule) : null;
    if (!kept) {
      dropItems.push(id);
      dropModels.push(...variants.map(v => Number(v.model_id)));
      continue;
    }
    const keepIds = new Set(kept.variants.map(v => v.modelId));
    dropModels.push(...variants.map(v => Number(v.model_id)).filter(m => !keepIds.has(m)));
  }

  return db.transaction(async tx => {
    const del = async (sql: string, ids: number[]) =>
      ids.length ? (await tx.query(`${sql} returning 1`, [ids])).rows.length : 0;
    const priceRowsRemoved = await del('delete from price_changes where model_id = any($1::bigint[])', dropModels);
    const variantsRemoved = await del('delete from variants where model_id = any($1::bigint[])', dropModels);
    const itemsRemoved = await del('delete from items where item_id = any($1::bigint[])', dropItems);
    const shopsRemoved = (await tx.query(
      'delete from shops s where not exists (select 1 from items i where i.shop_id = s.shop_id) returning 1')).rows.length;
    return { itemsRemoved, variantsRemoved, priceRowsRemoved, shopsRemoved };
  });
}
