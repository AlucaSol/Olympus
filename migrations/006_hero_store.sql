-- Champions sold in the Favour store for Triarchs of Olympus.
--
-- Most champions are free to every player; Brontes and Lykaon are the first
-- to be held back as store stock instead. Nothing new is needed to enforce
-- that: a store champion is an ordinary shop_items row in the existing
-- 'heroes' category (already declared by 002_shop.sql), so it inherits that
-- migration's whole security model unchanged — the client stays read-only on
-- shop_items and on its own player_purchases, purchase_shop_item remains the
-- only way Favour may decrease, and (user_id, item_id) already makes a double
-- purchase impossible.
--
-- item_id here is the SAME string as HeroDef.id in src/data/heroes.ts (see
-- HERO_SHOP_PRICES there). That pairing is the only binding between the game
-- and the catalogue: the lobby asks this database what a player owns and
-- refuses to let them field a champion it has not confirmed, so ownership is
-- decided here and nowhere else. Withdrawing a champion from sale later is
-- `update public.shop_items set is_active = false` — players who already
-- bought it keep it, and it simply stops being offered.

insert into public.shop_items (item_id, category, name, description, icon_path, cost, sort_order)
values
    ('brontes', 'heroes', 'Brontes',
     'Smith of Thunder. One of the immortal Cyclopes who hammered out Zeus'' first thunderbolt — a Siege Engineer who reshapes the ground with forges and walls.',
     'assets/characters/brontes-icon.png', 200, 10),

    ('lykaon', 'heroes', 'Lykaon',
     'The Moon-Cursed. King Lykaon mocked Zeus and was made the first werewolf for it — a Predator who runs down isolated heroes under Artemis'' patient moonlight.',
     'assets/characters/lykaon-icon.png', 200, 20)
on conflict (item_id) do update
set category    = excluded.category,
    name        = excluded.name,
    description = excluded.description,
    icon_path   = excluded.icon_path,
    cost        = excluded.cost,
    sort_order  = excluded.sort_order,
    is_active   = true;
