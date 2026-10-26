import { FEED_COLUMNS, type FeedRecord } from '../../src/feed/columns.js';

const DEFAULTS: FeedRecord = {
  itemid: '53001999315',
  shopid: '101487342',
  title: '(ถูกสุด) INGCO กรรไกรตัดหญ้า (ใบมีดตรง) ขนาด 23 นิ้ว',
  model_ids: '445195501093',
  model_names: 'INGCO กรรไกรตัดหญ้า 23 นิ้ว',
  model_prices: '360.0',
  price: '360',
  sale_price: '360',
  discount_percentage: '0',
  global_brand: 'Ingco(อิงโก้)',
  is_official_shop: 'Non-Official shop',
  is_preferred_shop: 'Preferred shop',
  holiday_mode_on: 'Off',
  cb_option: 'Non-Cross border',
  shop_rating: '4.93',
  seller_penalty_score: '0',
  shop_name: 'กัปตัน เอกสตีล',
  seller_name: 'akesteel',
  product_link: 'https://shopee.co.th/product/101487342/53001999315',
};

export function makeFeedRecord(overrides: Partial<FeedRecord> = {}): FeedRecord {
  const r: FeedRecord = {};
  for (const c of FEED_COLUMNS) r[c] = '';
  return Object.assign(r, DEFAULTS, overrides) as FeedRecord;
}
