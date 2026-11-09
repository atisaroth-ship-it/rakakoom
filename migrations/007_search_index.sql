-- Search by name ignores spaces and hyphens in the title ("petfriendly" finds "Pet Friendly"), and a trigram
-- index makes it fast. The extension may be unavailable on some hosts (and in the test database); then search
-- still works without the index, only slower, so a failure here must not stop the migrations.
do $$ begin create extension if not exists pg_trgm; execute 'create index latest_prices_search on latest_prices using gin ((replace(replace(lower(title || '' '' || brand), '' '', ''''), ''-'', '''')) gin_trgm_ops)'; exception when others then raise notice 'search index skipped: %', sqlerrm; end $$;
