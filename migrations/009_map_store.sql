-- Battlefields sold in the Favour store for Triarchs of Olympus.
--
-- The game ships with The Labyrinth, which is free and always available to
-- everyone, signed in or not. Additional battlefields are bought once with
-- Favour and are then permanently available to that account. Like Boons
-- (003_boons.sql), store champions (006_hero_store.sql) and ability unlocks
-- (007_ability_store.sql), a map needs no new tables, policies or functions:
-- it is an ordinary shop_items row in the 'maps' category that 002_shop.sql
-- already defined, bought through the same purchase_shop_item() and owned
-- through the same player_purchases ledger.
--
-- item_id here is `map_<id>`, matching the map registry in src/game/map.ts
-- (see MAPS and its shopItemId). A map with no shopItemId is free stock and
-- has no row here at all.
--
-- WHO NEEDS TO OWN IT
--
-- Only the HOST. The host picks the battlefield in the lobby and relays that
-- choice to every peer with the match start (see serializeCfg in main.ts), and
-- all three empires must stand on the same ground or nothing lines up. So a
-- joiner plays whatever their host owns, without buying anything — the same
-- shape as one player owning a map in any lobby-based game. What the store
-- sells is therefore the right to HOST on a battlefield, and the lobby's map
-- picker is the only place ownership is ever consulted.
--
-- That check happens on the picking client, against this database's own record
-- of what it owns, which is the same trust level this schema already gives a
-- peer-to-peer host for Boons and champion selection: a modified client could
-- host on a map it never bought. The stakes are proportionate — nobody else is
-- deprived of anything, and no Favour is created — so this stays a casual
-- game's honesty check rather than a competitive-integrity guarantee, exactly
-- as documented in 003_boons.sql and 006_hero_store.sql.
--
-- icon_path is left at the default placeholder on purpose: the store front and
-- the lobby picker both draw a live thumbnail of the real battlefield straight
-- from its own map data (see src/render/mapThumb.ts), so there is no file to
-- point at and the picture can never drift from the map it depicts.

insert into public.shop_items (item_id, category, name, description, cost, sort_order)
values
    ('map_thalassia', 'maps', 'Thalassia, the Sunlit Harbour',
     'A bright Aegean island town, ringed by open sea. Three walled harbour districts look inward over a crowded suburb of plastered houses — long avenues, alley cut-throughs, and courtyards you can fight your way through. Colonnaded halls shelter the monster yards, and the great temple at the agora stands over the Titan''s ground itself. Own it to host matches on it.',
     350, 10)
on conflict (item_id) do update
set category    = excluded.category,
    name        = excluded.name,
    description = excluded.description,
    cost        = excluded.cost,
    sort_order  = excluded.sort_order,
    is_active   = true;
