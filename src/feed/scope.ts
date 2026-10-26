import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FeedRecord } from './columns.js';

/** Which feed categories are collected (the free database is 1 GB; spec 6.1). */
export interface CategoryScope {
  /** global_category1 values to keep */
  include: string[];
  /** global_category2 values to drop, per global_category1 */
  excludeCategory2: Record<string, string[]>;
}

const DEFAULT_PATH = fileURLToPath(new URL('../../config/categories.json', import.meta.url));

export function loadScope(path: string = DEFAULT_PATH): CategoryScope {
  return JSON.parse(readFileSync(path, 'utf8')) as CategoryScope;
}

export function inScope(r: FeedRecord, scope: CategoryScope): boolean {
  const c1 = (r.global_category1 ?? '').trim();
  if (!scope.include.includes(c1)) return false;
  return !(scope.excludeCategory2[c1] ?? []).includes((r.global_category2 ?? '').trim());
}
