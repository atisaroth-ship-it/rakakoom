import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FeedRecord } from './columns.js';
import type { ParsedItem } from './parseRow.js';

/** One kind of product to collect (the free database is 1 GB; spec 6.1). The first matching rule applies. */
export interface ScopeRule {
  name: string;
  /** global_category1 values */
  category1: string[];
  /** if set, global_category2 must be one of these */
  category2?: string[];
  excludeCategory2?: string[];
  /** if set, global_category3 must be one of these */
  category3?: string[];
  /** if set, the title must match (case-insensitive regex) */
  titlePattern?: string;
  /** if set, a title matching this (case-insensitive regex) is not collected */
  excludeTitlePattern?: string;
  /** minimum units sold (feed item_sold) */
  minSold: number;
  /** keep only variants whose size is at least this many kg (variant name, else title) */
  minKg?: number;
}

export interface CategoryScope {
  rules: ScopeRule[];
}

const DEFAULT_PATH = fileURLToPath(new URL('../../config/categories.json', import.meta.url));

export function loadScope(path: string = DEFAULT_PATH): CategoryScope {
  return JSON.parse(readFileSync(path, 'utf8')) as CategoryScope;
}

const patterns = new Map<string, RegExp>();
const pattern = (p: string): RegExp => {
  let re = patterns.get(p);
  if (!re) patterns.set(p, (re = new RegExp(p, 'i')));
  return re;
};

/** The rule a feed row falls under, by category and title only (sales and weight are checked after parsing). */
export function matchRule(r: FeedRecord, scope: CategoryScope): ScopeRule | null {
  const c1 = (r.global_category1 ?? '').trim();
  const c2 = (r.global_category2 ?? '').trim();
  const c3 = (r.global_category3 ?? '').trim();
  for (const rule of scope.rules) {
    if (!rule.category1.includes(c1)) continue;
    if (rule.category2 && !rule.category2.includes(c2)) continue;
    if (rule.excludeCategory2?.includes(c2)) continue;
    if (rule.category3 && !rule.category3.includes(c3)) continue;
    if (rule.titlePattern && !pattern(rule.titlePattern).test(r.title ?? '')) continue;
    if (rule.excludeTitlePattern && pattern(rule.excludeTitlePattern).test(r.title ?? '')) continue;
    return rule;
  }
  return null;
}

const KG = /(\d+(?:[.,]\d+)?)\s*(?:kgs?\b|กิโลกรัม|กิโล|กก|โล)/gi;

/** Largest weight in kg written in the text, e.g. "10 กก.", "7.5kg", "10/20/30กิโล" (→ 30); null if none. */
export function weightKg(text: string): number | null {
  let best: number | null = null;
  const t = text.replace(/(\d+(?:[.,]\d+)?)((?:\s*\/\s*\d+(?:[.,]\d+)?)+)\s*(kgs?\b|กิโลกรัม|กิโล|กก|โล)/gi,
    (_m, first: string, rest: string, unit: string) => [first, ...rest.split('/').map(s => s.trim()).filter(Boolean)].map(n => `${n}${unit}`).join(' '));
  for (const m of t.matchAll(KG)) {
    const n = Number(m[1]!.replace(',', '.'));
    if (Number.isFinite(n) && (best === null || n > best)) best = n;
  }
  return best;
}

/** Apply a rule's sales and weight limits; null when the item is not collected. */
export function applyScope(item: ParsedItem, rule: ScopeRule): ParsedItem | null {
  if (item.itemSold < rule.minSold) return null;
  if (rule.minKg === undefined) return item;
  const sized = item.variants.map(v => ({ v, kg: weightKg(v.name) }));
  if (sized.some(s => s.kg !== null)) {
    const keep = sized.filter(s => s.kg !== null && s.kg >= rule.minKg!).map(s => s.v);
    return keep.length ? { ...item, variants: keep } : null;
  }
  const titleKg = weightKg(item.title);
  return titleKg !== null && titleKg >= rule.minKg ? item : null;
}
