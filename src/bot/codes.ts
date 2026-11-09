import { baht } from './format.js';

/** One platform code from a campaign's code table (spec 6.4; platform codes only, no shop codes). */
export interface PlatformCode {
  label: string;
  percent: number;
  minSatang: number;
  capSatang: number;
  /** Shopee Mall (official shops) only */
  mallOnly?: boolean;
  /** a condition not everyone meets (e.g. Shopee VIP); such codes only count toward the max-code price */
  condition?: string;
}

/** Shop codes of shops in Shopee's "ร้านโค้ดคุ้ม Xtra" programme; the feed does not say which shops take part. */
export interface XtraCode {
  label: string;
  percent: number;
  minSatang: number;
  capSatang: number;
}

export interface CodeCampaign {
  name: string;
  /** Bangkok dates, inclusive: the card shows estimates for this campaign on these days */
  showFrom: string;
  showUntil: string;
  /** where the codes come from, shown on the card */
  basis: string;
  codes: PlatformCode[];
  /** Xtra shop codes of this campaign; a price "if the shop is in Xtra", never counted as a code everyone can use */
  xtra?: XtraCode[];
}

const B = 100;

/**
 * Code calendar. 11.11 of 2026 is estimated from Shopee's 11.11 code table of 2025 (11 Nov 2568),
 * entered by the owner on 28 Oct 2026. Coin cashback and free shipping are left out: they do not lower
 * the price paid (spec 6.4 excludes shipping).
 */
export const CAMPAIGNS: CodeCampaign[] = [{
  name: '11.11',
  showFrom: '2026-10-28',
  showUntil: '2026-11-11',
  basis: 'อิงโค้ด 11.11 ปี 68',
  codes: [
    { label: 'โค้ด 10DD11 ลด 10%', percent: 10, minSatang: 200 * B, capSatang: 300 * B },
    { label: 'โค้ด 10MALL11 ลด 10%', percent: 10, minSatang: 200 * B, capSatang: 2000 * B, mallOnly: true },
    { label: 'โค้ดหน้ากิจกรรม ลด 30%', percent: 30, minSatang: 300 * B, capSatang: 300 * B, mallOnly: true },
    { label: 'โค้ดหน้ากิจกรรม ลด 25%', percent: 25, minSatang: 1000 * B, capSatang: 2000 * B, mallOnly: true },
    { label: 'โค้ดหน้ากิจกรรม ลด 25%', percent: 25, minSatang: 300 * B, capSatang: 250 * B },
    { label: 'โค้ดหน้ากิจกรรม ลด 22%', percent: 22, minSatang: 500 * B, capSatang: 2000 * B },
    { label: 'โค้ดหน้ากิจกรรม ลด 17%', percent: 17, minSatang: 200 * B, capSatang: 3000 * B },
    { label: 'โค้ดหน้ากิจกรรม ลด 10%', percent: 10, minSatang: 200 * B, capSatang: 3000 * B },
    { label: 'โค้ด VIP ลด 90%', percent: 90, minSatang: 150 * B, capSatang: 150 * B, condition: 'สมาชิก Shopee VIP · เที่ยงคืน–ตีสอง' },
    { label: 'โค้ด VIP ลด 50%', percent: 50, minSatang: 200 * B, capSatang: 120 * B, condition: 'สมาชิก Shopee VIP' },
  ],
  // From shopee.co.th/m/11-11, read 9 Nov 2026 (valid to 11 Nov). The 33% code (min 3 items) is left out:
  // the estimate is for one item.
  xtra: [
    { label: 'โค้ดร้านโค้ดคุ้ม Xtra ลด 30%', percent: 30, minSatang: 1000 * B, capSatang: 2000 * B },
    { label: 'โค้ดร้านโค้ดคุ้ม Xtra ลด 25%', percent: 25, minSatang: 200 * B, capSatang: 500 * B },
  ],
}];

export interface CodePrice {
  code: PlatformCode;
  priceSatang: number;
}

export interface CodeEstimate {
  campaign: CodeCampaign;
  /** best code everyone can use; null when none applies to this price */
  everyone: CodePrice | null;
  /** best code overall; only set when it beats `everyone` */
  best: CodePrice | null;
  /** best Xtra shop code; only set when it beats `everyone` (and `best`) and only valid at Xtra shops */
  xtra: CodePrice | null;
}

const discount = (c: PlatformCode, priceSatang: number) => Math.min(Math.round((priceSatang * c.percent) / 100), c.capSatang);

/** One platform code per order, so the best single code wins (codes in one table do not stack). */
function bestOf(codes: PlatformCode[], priceSatang: number, isMall: boolean): CodePrice | null {
  let best: CodePrice | null = null;
  for (const c of codes) {
    if (priceSatang < c.minSatang || (c.mallOnly && !isMall)) continue;
    const p = priceSatang - discount(c, priceSatang);
    if (!best || p < best.priceSatang) best = { code: c, priceSatang: p };
  }
  return best;
}

export function campaignOn(today: string, campaigns: CodeCampaign[] = CAMPAIGNS): CodeCampaign | null {
  return campaigns.find(c => c.showFrom <= today && today <= c.showUntil) ?? null;
}

/**
 * Codes the owner entered for today join the campaign's table (still one code per order);
 * on days without a campaign they make a table of their own.
 */
function withDaily(found: CodeCampaign | null, daily: PlatformCode[], today: string): CodeCampaign | null {
  if (!daily.length) return found;
  if (found) return { ...found, basis: `${found.basis} + โค้ดที่บันทึกไว้`, codes: [...found.codes, ...daily] };
  return { name: 'วันนี้', showFrom: today, showUntil: today, basis: 'โค้ดที่บันทึกไว้', codes: daily };
}

export function estimateCodes(priceSatang: number, isMall: boolean, today: string, campaigns: CodeCampaign[] = CAMPAIGNS,
  daily: PlatformCode[] = []): CodeEstimate | null {
  const campaign = withDaily(campaignOn(today, campaigns), daily, today);
  if (!campaign) return null;
  const everyone = bestOf(campaign.codes.filter(c => !c.condition), priceSatang, isMall);
  const any = bestOf(campaign.codes, priceSatang, isMall);
  const best = any && (!everyone || any.priceSatang < everyone.priceSatang) ? any : null;
  const xtraBest = bestOf((campaign.xtra ?? []).map(x => ({ ...x })), priceSatang, true);
  const floor = Math.min(everyone?.priceSatang ?? Infinity, any?.priceSatang ?? Infinity);
  const xtra = xtraBest && xtraBest.priceSatang < floor ? xtraBest : null;
  return { campaign, everyone, best, xtra };
}

/** Card rows for the code prices: [left, right, note] — the note says which code and its condition. */
export function codeRows(est: CodeEstimate | null): { left: string; right: string; note: string }[] {
  if (!est) return [{ left: 'ราคาใช้โค้ด', right: 'ยังไม่มีข้อมูลโค้ด', note: '' }];
  const rows: { left: string; right: string; note: string }[] = [];
  const n = est.campaign.name;
  rows.push(est.everyone
    ? { left: `ใช้โค้ด ${n} ที่ทุกคนใช้ได้`, right: baht(est.everyone.priceSatang), note: est.everyone.code.label }
    : { left: `ใช้โค้ด ${n} ที่ทุกคนใช้ได้`, right: 'ไม่ถึงขั้นต่ำ', note: '' });
  if (est.best) {
    rows.push({ left: `ใช้โค้ด ${n} ลดมากสุด`, right: baht(est.best.priceSatang), note: `${est.best.code.label} · ${est.best.code.condition ?? ''}`.replace(/ · $/, '') });
  }
  if (est.xtra) rows.push({ left: 'ถ้าร้านนี้ร่วม Xtra', right: baht(est.xtra.priceSatang), note: `${est.xtra.code.label} · ใช้ได้เฉพาะร้านที่ร่วม Xtra` });
  return rows;
}

export const codeFootnote = (est: CodeEstimate | null) =>
  est ? `ราคาโค้ดเป็นราคาประเมินช่วง ${est.campaign.name} (${est.campaign.basis}) โค้ดมีจำนวนจำกัด เช็คในแอปก่อนจ่าย` : '';

/** Bangkok calendar date (UTC+7, no DST). */
export const bangkokToday = (now: Date = new Date()) => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
