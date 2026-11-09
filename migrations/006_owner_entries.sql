-- Entered by the owner in LINE (admin only): prices she really paid or saw (flash sale + codes),
-- and platform codes of the day. Neither comes from the feed.
create table recorded_prices (
  id bigserial primary key,
  item_id bigint not null,
  shop_id bigint not null,
  price_satang bigint not null,
  note text not null,
  recorded_on date not null
);
create index recorded_prices_item on recorded_prices (item_id);

create table daily_codes (
  id bigserial primary key,
  percent numeric not null,
  min_satang bigint not null,
  cap_satang bigint not null,
  mall_only boolean not null,
  valid_from date not null,
  valid_until date not null
);
