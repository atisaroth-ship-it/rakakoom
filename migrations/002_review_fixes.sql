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

-- A suspect day may be re-collected by a later slot; only a clean success closes the day.
drop index feed_runs_one_success_per_day;
create unique index feed_runs_one_success_per_day on feed_runs (feed_date) where status = 'success';
alter table feed_runs add column heartbeat_at timestamptz not null default now();
alter table feed_runs add column file_rows jsonb not null default '[]';
alter table feed_runs add column last_modified jsonb not null default '[]';
