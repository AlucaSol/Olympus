-- Boons for Triarchs of Olympus.
--
-- Boons are an account progression system: they are bought once with Favour and
-- owned forever, and the client asks this database — never itself — whether a
-- player has one. Nothing new is needed to enforce that: a Boon is an ordinary
-- catalogue row in its own category, so it inherits the whole security model of
-- 002_shop.sql unchanged. The client stays READ-ONLY on shop_items and on its
-- own player_purchases, purchase_shop_item remains the only way Favour can
-- decrease, and (user_id, item_id) already makes a double purchase impossible.
--
-- item_id here is the SAME string as BoonDef.id in src/data/boons.ts. That is
-- the entire binding between the two: the game looks up ownership by that id
-- and refuses to equip anything the database has not confirmed.

-- The catalogue category is an enum, so it has to learn the new value first.
-- Idempotent, and deliberately not inside a transaction with the inserts below:
-- Postgres cannot use a newly added enum value in the same transaction that
-- added it. Run this file as-is (psql / the Supabase SQL editor both do).
alter type public.shop_category add value if not exists 'boons';

commit;

insert into public.shop_items (item_id, category, name, description, icon_path, cost, sort_order)
values
    ('boon_dionysus_revelry', 'boons', 'Dionysus'' Revelry',
     'Hurl a divine wine casket. The stain maddens every enemy it touches for 8 seconds: weaker blows, narrowed sight, staggering steps, and abilities loosed at nothing. Costs 260 Tribute.',
     'assets/boons/dionysus-revelry.svg', 100, 10),

    ('boon_demeter_harvest', 'boons', 'Demeter''s Harvest',
     'Raise a Sacred Grove around yourself for 10 seconds. Allies inside heal and cool their abilities faster, enemies are slowed, and labyrinth monsters strike softly. Costs 290 Tribute.',
     'assets/boons/demeter-harvest.svg', 100, 20),

    ('boon_hephaestus_forge', 'boons', 'Hephaestus'' Forge',
     'Reforge one of your standing towers for 20 seconds: repaired, briefly overbuilt past its maximum, faster firing, and every bolt detonating. Costs 320 Tribute.',
     'assets/boons/hephaestus-forge.svg', 100, 30),

    ('boon_hades_recall', 'boons', 'Hades'' Recall',
     'Passive. The blow that would kill you instead binds you in an underworld circle — invulnerable, rooted and still swinging — before drawing you back to your healing well at 1 health. Spends 380 Tribute only when it saves you.',
     'assets/boons/hades-recall.svg', 100, 40),

    ('boon_hermes_passage', 'boons', 'Hermes'' Passage',
     'Travel unhindered for 5 seconds: faster, farther-sighted, and straight through Labyrinth walls. You cannot attack while it lasts. Costs 230 Tribute.',
     'assets/boons/hermes-passage.svg', 100, 50),

    ('boon_persephone_bloom', 'boons', 'Persephone''s Bloom',
     'Plant a seed that waits 30 seconds. The first enemy champion to stray near makes it blossom, rooting them for 1.5 seconds and slowing them by half for 3 more. Costs 260 Tribute.',
     'assets/boons/persephone-bloom.svg', 100, 60)
on conflict (item_id) do update
set category    = excluded.category,
    name        = excluded.name,
    description = excluded.description,
    icon_path   = excluded.icon_path,
    cost        = excluded.cost,
    sort_order  = excluded.sort_order,
    is_active   = true;
