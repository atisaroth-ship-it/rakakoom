import { shopBadge, type Badge } from './badge.js';
import { affiliateLink } from './links.js';
import type { Alternative } from './match.js';
import type { ItemReport, ShopInfo, VariantReport } from './report.js';
import { baht, thaiDate } from './format.js';
import { verdict } from './verdict.js';
import { bangkokToday, codeFootnote, codeRows, estimateCodes } from './codes.js';

export { baht, thaiDate };

const INK = '#0E3B2C';
const GREEN = '#1FA463';
const MUTED = '#6B7D74';
const SOFT_GREEN = '#E3F4EA';
const SOFT_YELLOW = '#FFF5D9';
const SUB_ID = 'rakakoom-line';
/** Shorten by code point so an emoji is never split (LINE rejects broken text). */
const cut = (s: string, n: number) => {
  const cps = [...s];
  return cps.length > n ? cps.slice(0, n - 1).join('') + '…' : s;
};
const text = (t: string, o: Record<string, unknown> = {}) => ({ type: 'text', text: t, wrap: true, size: 'sm', color: INK, ...o });
const row = (left: string, right: string, o: Record<string, unknown> = {}) => ({
  type: 'box', layout: 'horizontal', contents: [text(left, { color: MUTED, flex: 5 }), text(right, { align: 'end', weight: 'bold', flex: 4, ...o })],
});

/** Code-price rows; without a campaign the row says there is no code data (spec 11). */
export function codeLines(codes: ReturnType<typeof estimateCodes>) {
  return codeRows(codes).flatMap(r => [
    row(r.left, r.right, codes && r.right.startsWith('฿') ? { color: GREEN } : { weight: 'regular', color: MUTED }),
    ...(r.note ? [text(r.note, { size: 'xxs', color: MUTED, align: 'end' })] : []),
  ]);
}

interface Offer {
  itemId: number;
  shopId: number;
  shop: ShopInfo;
  priceSatang: number;
  badge: Badge;
  mine: boolean;
}

export interface CardInput {
  report: ItemReport;
  variant: VariantReport;
  alternatives: Alternative[];
  affiliateId: string;
  /** Bangkok date that picks the code campaign; defaults to now */
  today?: string;
}

/** The chat card (LINE Flex Message) from spec 7 / 11, without the chart and code-price parts of v1. */
export function buildReplyCard({ report, variant, alternatives, affiliateId, today = bangkokToday() }: CardInput) {
  const peers = alternatives.map(a => a.priceSatang).concat(variant.priceSatang);
  const offers: Offer[] = [
    { itemId: report.itemId, shopId: report.shopId, shop: report.shop, priceSatang: variant.priceSatang, mine: true,
      badge: shopBadge(report.shop, variant.priceSatang, peers.filter(p => p !== variant.priceSatang)) },
    ...alternatives.map(a => ({ itemId: a.itemId, shopId: a.shopId, shop: a.shop, priceSatang: a.priceSatang, mine: false,
      badge: shopBadge(a.shop, a.priceSatang, peers.filter(p => p !== a.priceSatang)) })),
  ];
  const safe = offers.filter(o => o.badge.level !== 'red').sort((a, b) => a.priceSatang - b.priceSatang);
  const best = safe[0] ?? offers[0]!;
  const mine = offers[0]!;
  const v = verdict(variant, report.firstRecorded);
  const stale = variant.lastSeen < report.latestRecorded;
  const link = affiliateLink({ shopId: best.shopId, itemId: best.itemId }, affiliateId, SUB_ID);
  const codes = estimateCodes(variant.priceSatang, report.shop.isOfficial, today);

  const cheaper = offers.filter(o => !o.mine && o.priceSatang < mine.priceSatang).slice(0, 3);
  const others = cheaper.length
    ? [text('ร้านอื่นที่ขายรุ่นเดียวกัน', { weight: 'bold', margin: 'lg' }),
       ...cheaper.map(o => ({ type: 'box', layout: 'vertical', margin: 'sm', contents: [
         row(cut(o.shop.name || `ร้าน ${o.shopId}`, 28), baht(o.priceSatang), { color: o.badge.level === 'red' ? '#A52A2E' : GREEN }),
         text(`${o.badge.label} · ${o.badge.reason}`, { size: 'xs', color: MUTED }),
       ] }))]
    : [text('ยังหารุ่นที่ตรงเป๊ะจากร้านอื่นไม่เจอ', { size: 'xs', color: MUTED, margin: 'lg' })];

  const bubble = {
    type: 'bubble',
    ...(report.imageLink.startsWith('https://') ? { hero: { type: 'image', url: report.imageLink, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' } } : {}),
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        text(cut(report.title, 80), { weight: 'bold', size: 'md', maxLines: 3 }),
        text(`${variant.name !== report.title ? cut(variant.name, 40) + ' · ' : ''}${cut(report.shop.name, 30)}`, { size: 'xs', color: MUTED }),
        { type: 'box', layout: 'vertical', margin: 'md', paddingAll: '10px', cornerRadius: '14px',
          backgroundColor: v.kind === 'ok' ? SOFT_GREEN : SOFT_YELLOW,
          contents: [text(`${v.kind === 'ok' ? '✅' : '⏳'} ${v.title}`, { weight: 'bold' }), text(v.detail, { size: 'xs' })] },
        { type: 'box', layout: 'vertical', margin: 'md', spacing: 'xs', contents: [
          row(stale ? `ราคาล่าสุดที่บันทึกได้ ${thaiDate(variant.lastSeen)}` : 'ราคาตอนนี้', baht(variant.priceSatang), { size: 'md' }),
          row(`ต่ำสุด (${thaiDate(variant.low.date)})`, baht(variant.low.priceSatang)),
          row(`สูงสุด (${thaiDate(variant.high.date)})`, baht(variant.high.priceSatang)),
          ...codeLines(codes),
        ] },
        text(`${mine.badge.label} · ${mine.badge.reason}`, { size: 'xs', margin: 'md' }),
        ...others,
        text(`ประวัติราคาตั้งแต่เริ่มบันทึก ${thaiDate(report.firstRecorded)}`, { size: 'xxs', color: MUTED, margin: 'lg' }),
        ...(codes ? [text(codeFootnote(codes), { size: 'xxs', color: MUTED })] : []),
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', contents: [{
        type: 'button', style: 'primary', color: GREEN, height: 'md',
        action: { type: 'uri', label: cut(`ซื้อ${best.mine ? 'ร้านนี้' : 'ร้านที่ถูกกว่า'} ${baht(best.priceSatang)}`, 40), uri: link },
      }],
    },
  };
  return { type: 'flex' as const, altText: cut(`ราคาคุ้ม: ${report.title}`, 380), contents: bubble };
}
