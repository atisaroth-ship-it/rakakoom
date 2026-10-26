-- Feed values are not guaranteed to fit narrow types; one overflow would fail the whole day.
alter table shops alter column shop_rating type numeric;
alter table shops alter column penalty_score type numeric;
alter table items alter column item_rating type numeric;
alter table items alter column item_sold type bigint;
alter table items alter column stock type bigint;
alter table items alter column discount_percentage type numeric;

-- price_changes rows become spans: seen at price_satang on every collected day from effective_date to last_seen.
alter table price_changes add column last_seen date;
update price_changes set last_seen = effective_date;
alter table price_changes alter column last_seen set not null;
