export type FeedRecord = Record<string, string>;

/** หัวคอลัมน์ของ "Product Feed All Global Category" ตามลำดับในไฟล์จริง (ตรวจ 26 ต.ค. 2026) */
export const FEED_COLUMNS: readonly string[] = [
  'image_link_4', 'cb_option', 'global_category1', 'stock', 'item_sold', 'is_preferred_shop', 'title', 'shopid',
  'model_prices', 'global_category2', 'sale_price', 'like', 'shopee_verified_flag', 'global_catid2',
  'is_item_welcome_package', 'is_official_shop', 'global_catid3', 'description', 'seller_penalty_score',
  'global_catid1', 'image_link_3', 'additional_image_link', 'image_link_9', 'image_link_7', 'global_category3',
  'global_item_attributes', 'condition', 'discount_percentage', 'model_names', 'image_link_6', 'holiday_mode_on',
  'itemid', 'model_ids', 'has_lowest_price_guarantee', 'shop_sku_count', 'image_link_10', 'shop_rating',
  'item_rating', 'seller_name', 'price', 'image_link_8', 'image_link', 'shop_name', 'global_brand',
  'image_link_5', 'product_link', 'product_short link',
];
