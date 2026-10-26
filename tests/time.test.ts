import { bangkokDate } from '../src/time.js';

test('bangkokDate rolls over at 17:00 UTC', () => {
  expect(bangkokDate(new Date('2026-10-26T16:59:00Z'))).toBe('2026-10-26');
  expect(bangkokDate(new Date('2026-10-26T17:00:00Z'))).toBe('2026-10-27');
});
