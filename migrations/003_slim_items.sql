-- The feed sends a different ~1M products each day, so items keep accumulating (spec 6.1).
-- Drop what is unused or rebuildable: product link = https://shopee.co.th/product/{shop_id}/{item_id},
-- affiliate link = https://s.shopee.co.th/an_redir?origin_link=<encoded product link>&affiliate_id=...
alter table items drop column attributes;
alter table items drop column product_link;
alter table items drop column affiliate_link;
