create table feed_runs (
  id serial primary key,
  feed_date date not null,
  status text not null check (status in ('running', 'success', 'suspect', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_read bigint not null default 0,
  rows_kept bigint not null default 0,
  skipped jsonb not null default '{}',
  error text
);
-- one counted run per day
create unique index feed_runs_one_success_per_day on feed_runs (feed_date) where status in ('success', 'suspect');

create table shops (
  shop_id bigint primary key,
  shop_name text not null,
  seller_name text not null,
  shop_rating numeric(3, 2),
  penalty_score int,
  is_official boolean not null,
  is_preferred boolean not null,
  holiday_mode boolean not null,
  updated_on date not null
);

create table items (
  item_id bigint primary key,
  shop_id bigint not null,
  title text not null,
  brand text not null,
  category1 text not null,
  category2 text not null,
  category3 text not null,
  category_id1 bigint,
  category_id2 bigint,
  category_id3 bigint,
  attributes jsonb,
  product_link text not null,
  affiliate_link text not null,
  image_link text not null,
  item_rating numeric(3, 2),
  item_sold int not null,
  stock int not null,
  cross_border boolean not null,
  condition text not null,
  price_satang bigint not null,
  sale_price_satang bigint not null,
  discount_percentage int not null,
  first_seen date not null,
  last_seen date not null
);
create index items_brand on items (lower(brand));

create table variants (
  model_id bigint primary key,
  item_id bigint not null,
  name text not null,
  price_satang bigint not null,
  first_seen date not null,
  last_seen date not null
);
create index variants_item on variants (item_id);

-- price history: one row per day the price changed; never deleted
create table price_changes (
  model_id bigint not null,
  effective_date date not null,
  price_satang bigint not null,
  primary key (model_id, effective_date)
);

create unlogged table staging_items (
  seq bigserial primary key,
  run_id int not null,
  item_id bigint not null,
  data jsonb not null
);
create index staging_items_run on staging_items (run_id);

create unlogged table staging_variants (
  seq bigserial primary key,
  run_id int not null,
  item_id bigint not null,
  model_id bigint not null,
  name text not null,
  price_satang bigint not null
);
create index staging_variants_run on staging_variants (run_id);
