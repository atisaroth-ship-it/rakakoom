import { applyScope, loadScope, matchRule, weightKg, type CategoryScope } from '../../src/feed/scope.js';
import { parseFeedRow, type ParsedItem } from '../../src/feed/parseRow.js';
import { makeFeedRecord } from '../helpers/feedRecord.js';

const scope: CategoryScope = {
  rules: [
    { name: 'mobile', category1: ['Mobile & Gadgets'], excludeCategory2: ['Accessories'], minSold: 10 },
    { name: 'audio', category1: ['Audio'], minSold: 10 },
    { name: 'pet-electric', category1: ['Pets'], category2: ['Pet Accessories'], titlePattern: 'อัตโนมัติ|smart', minSold: 4 },
    { name: 'pet-food', category1: ['Pets'], category2: ['Pet Food'], minSold: 10, minKg: 7 },
  ],
};

const rec = (o: Record<string, string>) => makeFeedRecord(o);
const item = (o: Record<string, string>): ParsedItem => {
  const r = parseFeedRow(makeFeedRecord(o));
  if (!r.ok) throw new Error(r.reason);
  return r.item;
};

test('matchRule keeps listed categories and drops excluded category2', () => {
  expect(matchRule(rec({ global_category1: 'Audio' }), scope)?.name).toBe('audio');
  expect(matchRule(rec({ global_category1: 'Mobile & Gadgets', global_category2: 'Mobile Phones' }), scope)?.name).toBe('mobile');
  expect(matchRule(rec({ global_category1: 'Mobile & Gadgets', global_category2: 'Accessories' }), scope)).toBeNull();
  expect(matchRule(rec({ global_category1: 'Home & Living' }), scope)).toBeNull();
});

test('matchRule title pattern is required when set', () => {
  const base = { global_category1: 'Pets', global_category2: 'Pet Accessories' };
  expect(matchRule(rec({ ...base, title: 'ห้องน้ำแมวอัตโนมัติ' }), scope)?.name).toBe('pet-electric');
  expect(matchRule(rec({ ...base, title: 'ชามข้าวแมวเซรามิก' }), scope)).toBeNull();
});

test('matchRule excludeTitlePattern drops lookalikes', () => {
  const s: CategoryScope = { rules: [{ name: 'p', category1: ['Pets'], titlePattern: 'อัตโนมัติ', excludeTitlePattern: 'ทรายแมว', minSold: 4 }] };
  expect(matchRule(rec({ global_category1: 'Pets', title: 'ทรายแมวเต้าหู้ ใช้กับห้องน้ำแมวอัตโนมัติ' }), s)).toBeNull();
  expect(matchRule(rec({ global_category1: 'Pets', title: 'ห้องน้ำแมวอัตโนมัติ' }), s)?.name).toBe('p');
});

test('committed pet-electric rule rejects cat litter sand', () => {
  const s = loadScope();
  const base = { global_category1: 'Pets', global_category2: 'Litter & Toilet', global_category3: 'Cat Litter & Boxes' };
  expect(matchRule(rec({ ...base, title: '(6ลิตร) Miao Wu ทรายแมวเต้าหู้พรีเมียม ใช้กับกระบะทรายอัตโนมัติได้' }), s)).toBeNull();
  expect(matchRule(rec({ ...base, title: 'ห้องน้ำแมวอัตโนมัติ PETKIT PURA MAX' }), s)?.name).toBe('pet-electric');
});

test('applyScope enforces the rule minimum sold', () => {
  const r = scope.rules[2]!;
  expect(applyScope(item({ item_sold: '4' }), r)).not.toBeNull();
  expect(applyScope(item({ item_sold: '3' }), r)).toBeNull();
});

test('weightKg reads kg in Thai and English and takes the largest', () => {
  expect(weightKg('อาหารแมว ขนาด 10 กก.')).toBe(10);
  expect(weightKg('A Pro สุนัขโต 7.5kg')).toBe(7.5);
  expect(weightKg('อาหารเป็ด 10/20/30กิโล')).toBe(30);
  expect(weightKg('ซีเอฟ11(30กก)')).toBe(30);
  expect(weightKg('เป็ดเล็ก931 (10โล)')).toBe(10);
  expect(weightKg('ขนมแมว 500g')).toBeNull();
});

test('applyScope keeps only variants at or above minKg', () => {
  const r = scope.rules[3]!;
  const it = item({ item_sold: '20', title: 'อาหารแมว', model_ids: '1|2|3', model_names: '1.5 กก.|7 กก.|15kg', model_prices: '200|700|1400' });
  expect(applyScope(it, r)?.variants.map(v => v.modelId)).toEqual([2, 3]);
});

test('applyScope uses the title weight when variant names have none', () => {
  const r = scope.rules[3]!;
  const big = item({ item_sold: '20', title: "Hill's อาหารแมว 10 กก.", model_ids: '1|2', model_names: 'ไก่|ปลา', model_prices: '1500|1500' });
  expect(applyScope(big, r)?.variants).toHaveLength(2);
  const small = item({ item_sold: '20', title: 'อาหารแมว 1.2 กก.', model_ids: '1', model_names: 'ไก่', model_prices: '200' });
  expect(applyScope(small, r)).toBeNull();
  const unknown = item({ item_sold: '20', title: 'อาหารแมว', model_ids: '1', model_names: 'ไก่', model_prices: '200' });
  expect(applyScope(unknown, r)).toBeNull();
});

test('committed scope has the approved rules and minimums', () => {
  const s = loadScope();
  const by = Object.fromEntries(s.rules.map(r => [r.name, r]));
  expect(Object.keys(by)).toEqual(['mobile', 'electronics', 'home-garden-tools', 'water-tanks', 'pet-electric', 'pet-food']);
  expect(by['pet-electric']!.minSold).toBe(4);
  expect(by['pet-food']!).toMatchObject({ minSold: 10, minKg: 7 });
  for (const n of ['mobile', 'electronics', 'home-garden-tools', 'water-tanks']) expect(by[n]!.minSold).toBe(10);
  expect(by.mobile!.excludeCategory2).toEqual(['Accessories']);
});
