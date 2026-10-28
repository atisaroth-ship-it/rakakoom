-- Latest price of every branded product seen in the feed recently (any category, any sales), no history.
-- Lets the bot answer far more pasted links; rows older than the retention window are deleted daily.
create table latest_prices (
  item_id bigint primary key,
  shop_id bigint not null,
  title text not null,
  brand text not null,
  category1 text not null,
  image_key text not null,
  item_sold bigint not null,
  min_price_satang bigint not null,
  max_price_satang bigint not null,
  variant_count int not null,
  shop_name text not null,
  shop_rating numeric,
  penalty_score numeric,
  is_official boolean not null,
  is_preferred boolean not null,
  holiday_mode boolean not null,
  last_seen date not null
);
create index latest_prices_last_seen on latest_prices (last_seen);
