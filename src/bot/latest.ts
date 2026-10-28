import type { Db } from '../db/db.js';
import { shopBadge } from './badge.js';
import { baht, thaiDate } from './format.js';
import { affiliateLink } from './links.js';
import { shopFromRow, type ShopInfo } from './report.js';
import { codeLines } from './card.js';
import { bangkokToday, codeFootnote, estimateCodes } from './codes.js';

/** A product seen recently in the feed but without collected history (spec 11 fallback). */
export interface LatestPrice {
  itemId: number;
  shopId: number;
  title: string;
  imageLink: string;
  minPriceSatang: number;
  maxPriceSatang: number;
  variantCount: number;
  lastSeen: string;
  shop: ShopInfo;
}

export async function loadLatestPrice(db: Db, itemId: number): Promise<LatestPrice | null> {
  const r = (await db.query<Record<string, unknown>>(
    `select item_id, shop_id, title, image_key, min_price_satang, max_price_satang, variant_count,
            to_char(last_seen, 'YYYY-MM-DD') as last_seen,
            shop_name, shop_rating, penalty_score, is_official, is_preferred, holiday_mode
       from latest_prices where item_id = $1`, [itemId])).rows[0];
  if (!r) return null;
  return {
    itemId: Number(r.item_id),
    shopId: Number(r.shop_id),
    title: String(r.title),
    imageLink: r.image_key ? `https://cf.shopee.co.th/file/${String(r.image_key)}` : '',
    minPriceSatang: Number(r.min_price_satang),
    maxPriceSatang: Number(r.max_price_satang),
    variantCount: Number(r.variant_count),
    lastSeen: String(r.last_seen),
    shop: shopFromRow(r),
  };
}

const INK = '#0E3B2C';
const GREEN = '#1FA463';
const MUTED = '#6B7D74';
const text = (t: string, o: Record<string, unknown> = {}) => ({ type: 'text', text: t, wrap: true, size: 'sm', color: INK, ...o });
/** Shorten by code point so an emoji is never split (LINE rejects broken text). */
const cut = (s: string, n: number) => {
  const cps = [...s];
  return cps.length > n ? cps.slice(0, n - 1).join('') + '…' : s;
};

export function buildLatestCard(lp: LatestPrice, affiliateId: string, today: string = bangkokToday()) {
  const price = lp.minPriceSatang === lp.maxPriceSatang ? baht(lp.minPriceSatang) : `${baht(lp.minPriceSatang)} – ${baht(lp.maxPriceSatang)}`;
  const badge = shopBadge(lp.shop, lp.minPriceSatang, []);
  const link = affiliateLink({ shopId: lp.shopId, itemId: lp.itemId }, affiliateId, 'rakakoom-line');
  // Cheapest variant: the price the code estimate starts from.
  const codes = estimateCodes(lp.minPriceSatang, lp.shop.isOfficial, today);
  const bubble = {
    type: 'bubble',
    ...(lp.imageLink.startsWith('https://') ? { hero: { type: 'image', url: lp.imageLink, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' } } : {}),
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        text(cut(lp.title, 80), { weight: 'bold', size: 'md', maxLines: 3 }),
        text(cut(lp.shop.name, 30), { size: 'xs', color: MUTED }),
        { type: 'box', layout: 'horizontal', margin: 'md', contents: [
          text(`ราคาล่าสุดที่เห็น ${thaiDate(lp.lastSeen)}`, { color: MUTED, flex: 5 }),
          text(price, { align: 'end', weight: 'bold', size: 'md', flex: 5 }),
        ] },
        ...(codes ? [{ type: 'box', layout: 'vertical', spacing: 'xs', contents: codeLines(codes) }] : []),
        text(`${badge.label} · ${badge.reason}`, { size: 'xs', margin: 'md' }),
        text('ยังไม่มีประวัติราคาของสินค้านี้ — เริ่มติดตามให้แล้ว ถ้าสินค้านี้อยู่ในหมวดที่เก็บประวัติ ครั้งหน้าจะเห็นราคาต่ำสุด/สูงสุด',
          { size: 'xxs', color: MUTED, margin: 'lg' }),
        ...(codes ? [text(codeFootnote(codes), { size: 'xxs', color: MUTED })] : []),
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', contents: [{
        type: 'button', style: 'primary', color: GREEN, height: 'md',
        action: { type: 'uri', label: cut(`ดูร้านนี้ใน Shopee ${baht(lp.minPriceSatang)}`, 40), uri: link },
      }],
    },
  };
  return { type: 'flex' as const, altText: cut(`ราคาคุ้ม: ${lp.title}`, 380), contents: bubble };
}
