-- Feed values are not guaranteed to fit narrow types; one overflow would fail the whole day.
alter table shops alter column shop_rating type numeric;
alter table shops alter column penalty_score type numeric;
alter table items alter column item_rating type numeric;
alter table items alter column item_sold type bigint;
alter table items alter column stock type bigint;
alter table items alter column discount_percentage type numeric;
