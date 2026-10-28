-- Links people asked about that had no data (spec 11): what to collect next. No LINE user id is stored.
create table link_requests (
  id bigserial primary key,
  item_id bigint not null,
  shop_id bigint not null,
  requested_at timestamptz not null default now()
);
create index link_requests_item on link_requests (item_id);
