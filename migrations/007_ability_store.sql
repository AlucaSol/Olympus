-- Level-20 ability unlocks sold in the Favour store for Triarchs of Olympus.
--
-- Every champion's fifth ability unlocks at level 20 in a match; owning it is
-- a separate question from reaching that level. Brontes and Lykaon (see
-- 006_hero_store.sql) ship with theirs already unlocked as part of buying the
-- champion itself, so they get no row here. The other ten champions sell
-- theirs separately, 50 Favour each, as ordinary shop_items rows in the
-- existing 'abilities' category — no new tables, policies or functions, for
-- the same reason 003_boons.sql and 006_hero_store.sql don't need any either.
--
-- item_id here is `<heroId>_ultimate`, matching HeroDef.id in
-- src/data/heroes.ts (see ultimateItemId() there). The lobby/match asks this
-- database what a player owns and refuses to let a levelled-up champion cast
-- an ability it has not confirmed, so ownership is decided here and nowhere
-- else. icon_path is left at the default placeholder: these five abilities
-- are drawn procedurally client-side (see render/art.ts's ICON_ART), and the
-- store front recognises `<heroId>_ultimate` rows and substitutes the real
-- ability icon and the owning champion's colour itself (see
-- data/heroes.ts's heroForUltimateItem()) rather than reading a file here.

insert into public.shop_items (item_id, category, name, description, cost, sort_order)
values
    ('alkaios_ultimate', 'abilities', 'Alkaios — Rite of the Fallen',
     'Executioner strike: heavy damage, doubled below 35% HP. Cooldown resets on kill.', 50, 10),

    ('kyra_ultimate', 'abilities', 'Kyra — Heartseeker',
     'After a breath, fire an arrow across the battlefield. Damage grows with distance travelled (up to +100%).', 50, 20),

    ('skiron_ultimate', 'abilities', 'Skiron — Tempest Heart',
     'Become the storm: a whirlwind around you deals damage 4 times over 2.5 seconds and hurls enemies back.', 50, 30),

    ('thalassa_ultimate', 'abilities', 'Thalassa — Deluge of the Drowned',
     'Summon a towering wave that sweeps a long line, dealing massive damage, knocking enemies aside and stunning them for 1.2 seconds.', 50, 40),

    ('lysander_ultimate', 'abilities', 'Lysander — Grand Muster',
     'A vast rally: up to 10 friendly mobs in a wide radius follow you for 18 seconds with +25% damage.', 50, 50),

    ('doria_ultimate', 'abilities', 'Doria — Aegis of Ages',
     'Grant nearby friendly mobs a 200 HP shield and become invulnerable yourself for 2.5 seconds.', 50, 60),

    ('iole_ultimate', 'abilities', 'Iole — Gaia''s Embrace',
     'A great bloom: massively heal yourself and friendly mobs, granting all +25% speed and damage for 6 seconds.', 50, 70),

    ('pyrrhos_ultimate', 'abilities', 'Pyrrhos — Wrath of Kronos',
     'Call down a Titan meteor. After 1.4 seconds it lands for devastating damage and a 1 second stun.', 50, 80),

    ('eurydice_ultimate', 'abilities', 'Eurydice — The Final Prophecy',
     'Reveal a vast region for 8 seconds: all fog, thickets and hidden enemies within are laid bare to your whole empire, and stealth is stripped away.', 50, 90),

    ('harmonia_ultimate', 'abilities', 'Harmonia — Harmony''s Decree',
     'For 10 seconds every enemy empire''s mob forgets its quarrels and marches only on towers and bases, flooding every lane with pressure.', 50, 100)
on conflict (item_id) do update
set category    = excluded.category,
    name        = excluded.name,
    description = excluded.description,
    cost        = excluded.cost,
    sort_order  = excluded.sort_order,
    is_active   = true;
