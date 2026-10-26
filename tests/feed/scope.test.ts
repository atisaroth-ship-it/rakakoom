import { inScope, loadScope, type CategoryScope } from '../../src/feed/scope.js';
import { makeFeedRecord } from '../helpers/feedRecord.js';

const scope: CategoryScope = { include: ['Mobile & Gadgets', 'Audio'], excludeCategory2: { 'Mobile & Gadgets': ['Accessories'] } };

test('inScope keeps listed categories', () => {
  expect(inScope(makeFeedRecord({ global_category1: 'Audio' }), scope)).toBe(true);
  expect(inScope(makeFeedRecord({ global_category1: 'Mobile & Gadgets', global_category2: 'Mobile Phones' }), scope)).toBe(true);
  expect(inScope(makeFeedRecord({ global_category1: 'Home & Living' }), scope)).toBe(false);
});

test('inScope drops excluded category2', () => {
  expect(inScope(makeFeedRecord({ global_category1: 'Mobile & Gadgets', global_category2: 'Accessories' }), scope)).toBe(false);
});

test('loadScope reads the committed category list', () => {
  const s = loadScope();
  expect(s.include).toEqual(['Mobile & Gadgets', 'Home Appliances', 'Computers & Accessories', 'Cameras & Drones', 'Audio', 'Gaming & Consoles']);
  expect(s.excludeCategory2).toEqual({ 'Mobile & Gadgets': ['Accessories'] });
});
