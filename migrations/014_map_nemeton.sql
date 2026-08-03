-- Nemeton, the Sunken Grove — the third battlefield, sold in the Favour store.
--
-- Same shape as 009_map_store.sql in every respect: an ordinary shop_items row
-- in the 'maps' category that 002_shop.sql already defined, bought through the
-- same purchase_shop_item() and owned through the same player_purchases
-- ledger. No new tables, policies or functions.
--
-- item_id is `map_nemeton`, matching the map registry in src/game/map.ts (see
-- MAPS and its shopItemId). Only the HOST needs to own it — the choice travels
-- to every peer with the match start, so joiners play whatever their host
-- picked without buying anything. See 009_map_store.sql for the full note on
-- who owns what and where that check happens.
--
-- icon_path stays at the default placeholder: the store front and the lobby
-- picker both draw a live thumbnail straight from the map's own data (see
-- src/render/mapThumb.ts), so there is no file to point at and the picture can
-- never drift from the battlefield it depicts.

insert into public.shop_items (item_id, category, name, description, cost, sort_order)
values
    ('map_nemeton', 'maps', 'Nemeton, the Sunken Grove',
     'The battlefield turned inside out. Conquer broad forest avenues, and fight for the one great ring of standing stones at the heart of the wood. The wildwood is pushed out into tangled groves between the avenues, with canopies dark enough to vanish under.',
     350, 20)
on conflict (item_id) do update
set category    = excluded.category,
    name        = excluded.name,
    description = excluded.description,
    cost        = excluded.cost,
    sort_order  = excluded.sort_order,
    is_active   = true;
