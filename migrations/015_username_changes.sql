-- Username changes for Triarchs of Olympus.
--
-- 001 already gave every account a `username` — citext, unique, and shown in
-- game. What it never had was a way to CHANGE one, a character budget anyone
-- would call reasonable, or any opinion about what the word actually says.
-- This migration adds those three things and nothing else.
--
-- WHAT 001 ALREADY GOT RIGHT, and is deliberately left alone:
--
--   * `citext not null unique` means uniqueness is ALREADY case-insensitive.
--     With "jonny" taken, "Jonny" and "jONny" are refused by the unique index
--     itself — not by application code that could be bypassed. citext also
--     STORES the capitalisation it was given, so a name typed "JonnyBravo"
--     displays that way in game while still colliding with "jonnybravo".
--     Both halves of the requirement fall out of the column type.
--
--   * the browser is read-only on player_accounts. There is no UPDATE policy
--     for `authenticated` and this migration does not add one. A rename goes
--     through change_username() below, which is service-role only, which means
--     it can only be reached by the change-username Edge Function, which
--     verifies a Turnstile token before it calls anything. A player cannot
--     rename themselves by talking to PostgREST directly.
--
-- WHAT CHANGES HERE:
--
--   1. dashes join letters, digits and underscores in the allowed set;
--   2. a name is 5 to 20 characters (see the grandfathering note on the
--      constraint below — existing shorter and longer names are NOT broken);
--   3. one rename per 24 hours, enforced here rather than only in the browser;
--   4. a profanity and reserved-word screen that sees through l33tspeak,
--      padding and repeated letters;
--   5. a kill switch, so renaming can be switched off in one UPDATE if it ever
--      turns into a nuisance, leaving the email-prefix default in place.
--
-- ON THE EMAIL-PREFIX DEFAULT. 001's new-user trigger fell back to
-- split_part(email, '@', 1) and then REJECTED it if it did not match the
-- format — so an address like `jon.bennett@example.com` raised an exception
-- and the signup failed outright. Dots, plus-addressing and hyphens are all
-- ordinary in email, so that fallback was a signup outage waiting for the
-- first person who did not come through the website form. It is replaced
-- below with one that sanitises instead of refusing, and the default is kept
-- exactly as the brief asks so renaming can be disabled without leaving new
-- accounts nameless.


-- ---------------------------------------------------------------------------
-- Configuration (singleton) — mirrors signup_config from 010
-- ---------------------------------------------------------------------------

create table if not exists public.username_config (
    id boolean primary key default true
        check (id),

    -- The kill switch. False leaves every existing name in place and keeps the
    -- email-prefix default working; only renaming stops.
    changes_enabled boolean not null default true,

    cooldown_hours integer not null default 24
        check (cooldown_hours >= 0),

    min_length integer not null default 5
        check (min_length >= 1),

    -- 20 matches what the game client already truncates a peer-supplied name
    -- to (sanitizeAccount in src/main.ts and src/dedicatedHost.ts), so nothing
    -- a player is allowed to choose can be silently shortened in a lobby.
    max_length integer not null default 20
        check (max_length >= min_length),

    updated_at timestamptz not null default timezone('utc', now())
);

insert into public.username_config (id)
values (true)
on conflict (id) do nothing;

alter table public.username_config enable row level security;

revoke all on table public.username_config from anon, authenticated;

comment on table public.username_config is
'Server-only username rules and rename kill switch. No browser access. Set changes_enabled = false to stop renames without disturbing existing names or the email-prefix default.';


-- ---------------------------------------------------------------------------
-- Per-account rename bookkeeping
-- ---------------------------------------------------------------------------

alter table public.player_accounts
    add column if not exists username_changed_at timestamptz;

alter table public.player_accounts
    add column if not exists username_change_count integer not null default 0;

comment on column public.player_accounts.username_changed_at is
'When this account last renamed itself. Null means never. Drives the server-side cooldown; the browser keeps its own copy in localStorage purely to avoid a pointless round trip.';


-- ---------------------------------------------------------------------------
-- Character set
-- ---------------------------------------------------------------------------

-- Dashes are added to the allowed set. The LENGTH here stays at 001's 3-24 on
-- purpose: tightening a table CHECK to 5-20 would instantly invalidate any
-- account already holding a 3, 4, 21 or 24-character name, and a constraint
-- that existing rows violate makes those rows unupdatable — a player with a
-- 22-character name could never change anything again, including their name.
-- The real 5-20 range is therefore applied to every NEW name by
-- username_rejection() below, and this constraint stays wide enough to keep
-- the old ones legal until their owners rename into range.
alter table public.player_accounts
    drop constraint if exists player_accounts_username_format;

alter table public.player_accounts
    add constraint player_accounts_username_format
    check (username::text ~ '^[A-Za-z0-9_-]{3,24}$');


-- ---------------------------------------------------------------------------
-- Blocklist
-- ---------------------------------------------------------------------------

-- A table rather than a constant so terms can be added at 3am from the SQL
-- editor without a migration and a redeploy.
create table if not exists public.username_blocklist (
    term text primary key
        check (term = lower(term) and length(term) >= 2),

    -- 'substring' catches the term anywhere inside the name (the right default
    -- for profanity, which people pad and prefix). 'exact' matches only the
    -- whole name, for short words that would otherwise eat innocent names —
    -- blocking the substring "ass" would take "Cassandra" and "Assassin" with
    -- it, which on a Greek-myth game is a real cost.
    --
    -- 'allow' is the escape hatch, and it is checked BEFORE either of the
    -- others: a folded name equal to an 'allow' term is accepted outright.
    -- This is the answer to the Scunthorpe problem, and it earns its keep on
    -- an Australian game — "Cockburn" is a suburb of Perth. It matches whole
    -- names only, so it can exempt a town without exempting an insult built
    -- around one.
    kind text not null default 'substring'
        check (kind in ('substring', 'exact', 'allow')),

    note text,

    created_at timestamptz not null default timezone('utc', now())
);

alter table public.username_blocklist enable row level security;

revoke all on table public.username_blocklist from anon, authenticated;

comment on table public.username_blocklist is
'Server-only username screen. Terms are stored plainly spelled in folded form (see fold_username) and matched against the folded candidate, so leetspeak and padding do not slip past. Browser has no access — the site ships its own copy of the obvious cases purely to save a round trip, and this table is the authority.';


-- ---------------------------------------------------------------------------
-- Folding — what the screen actually compares against
-- ---------------------------------------------------------------------------

-- A blocklist compared against raw input catches nobody. `f_u_c_k`, `N1GG3R`
-- and `f.u.c.k` are all the same word to a reader and three different strings
-- to a database, so a candidate is reduced to a skeleton first:
--
--   lowercase -> symbol and digit homoglyphs to letters -> drop everything
--   that is not a letter
--
-- Padding with repeated letters ("fuuuck") is handled separately, at match
-- time, by collapsing runs on BOTH sides — see username_rejection. It is not
-- done here because collapsing is lossy in a way that matters for short
-- terms: "gook" and "coon" collapse to "gok" and "con", and a blocklist
-- holding "con" would refuse the perfectly ordinary name "Con".
create or replace function public.fold_username(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
    select regexp_replace(
        translate(
            lower(coalesce(p_value, '')),
            '@$!01345789|+',
            'asioieastbglt'
        ),
        '[^a-z]', '', 'g'
    );
$$;

comment on function public.fold_username(text) is
'Reduces a username to a comparison skeleton: lowercased, homoglyphs resolved, everything that is not a letter dropped. Blocklist terms are stored in this same folded form — plainly spelled, NOT run-collapsed.';


-- ---------------------------------------------------------------------------
-- Validation — one place, used by both the rename path and the signup trigger
-- ---------------------------------------------------------------------------

-- Returns NULL when the name is acceptable, or a short machine-readable reason
-- when it is not. Returning a code rather than raising keeps every caller free
-- to decide whether a bad name is an error or a cue to fall back to something
-- generated.
create or replace function public.username_rejection(p_username text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
    cfg     public.username_config%rowtype;
    folded  text;
    hit     text;
begin
    select * into cfg from public.username_config where id;
    if not found then
        -- No config row should be impossible, but validating against nothing
        -- would be worse than validating against the shipped defaults.
        cfg.min_length := 5;
        cfg.max_length := 20;
    end if;

    if p_username is null or length(p_username) = 0 then
        return 'empty';
    end if;

    if length(p_username) < cfg.min_length then
        return 'too_short';
    end if;

    if length(p_username) > cfg.max_length then
        return 'too_long';
    end if;

    if p_username !~ '^[A-Za-z0-9_-]+$' then
        return 'invalid_characters';
    end if;

    -- A name made only of punctuation reads as blank on a scoreboard.
    if p_username !~ '[A-Za-z0-9]' then
        return 'invalid_characters';
    end if;

    folded := public.fold_username(p_username);

    -- Something like "___" or "1234" folds away to nothing. Allow it only if
    -- the raw name has real alphanumeric content, which the check above has
    -- already established, so a pure-digit name is fine and a pure-symbol one
    -- has already been refused.

    if folded <> '' then
        -- Exemptions win. Checked first and by whole-name equality only.
        if exists (
            select 1 from public.username_blocklist b
             where b.kind = 'allow' and b.term = folded
        ) then
            return null;
        end if;

        -- 'exact' compares the plain skeleton only, so short terms stay
        -- precise. 'substring' additionally compares with runs of repeated
        -- letters collapsed on both sides, which is what defeats padding:
        -- "fuuuck" and "fuck" both collapse to "fuck".
        select b.term into hit
          from public.username_blocklist b
         where (b.kind = 'exact' and folded = b.term)
            or (b.kind = 'substring' and (
                    position(b.term in folded) > 0
                 or position(
                        regexp_replace(b.term, '(.)\1+', '\1', 'g')
                        in regexp_replace(folded, '(.)\1+', '\1', 'g')
                    ) > 0
               ))
         limit 1;

        if hit is not null then
            return 'not_allowed';
        end if;
    end if;

    return null;
end;
$$;

comment on function public.username_rejection(text) is
'NULL if the username is acceptable, else a reason code: empty, too_short, too_long, invalid_characters, not_allowed. The single source of truth for what a name may be — the website and the Edge Function mirror it only to avoid round trips.';


-- ---------------------------------------------------------------------------
-- The rename itself
-- ---------------------------------------------------------------------------

-- Service-role only. The change-username Edge Function verifies a Cloudflare
-- Turnstile token and confirms the caller's identity from their access token
-- before it gets here; p_user_id is that verified id, never a value the
-- browser chose for itself.
--
-- Returns jsonb rather than raising, because every outcome below is an
-- ordinary answer the player needs to read, not an exception:
--
--   { ok: true,  username, cooldown_until }
--   { ok: false, error, message, cooldown_until? }
create or replace function public.change_username(
    p_user_id uuid,
    p_username text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    cfg        public.username_config%rowtype;
    candidate  text;
    reason     text;
    current_name text;
    changed_at timestamptz;
    ready_at   timestamptz;
begin
    if p_user_id is null then
        return jsonb_build_object('ok', false, 'error', 'invalid_request');
    end if;

    select * into cfg from public.username_config where id;
    if not found or not cfg.changes_enabled then
        return jsonb_build_object(
            'ok', false,
            'error', 'changes_disabled',
            'message', 'Username changes are switched off at the moment.'
        );
    end if;

    candidate := trim(coalesce(p_username, ''));

    -- Serialise this account's renames. Without it two submissions landing
    -- together could both pass the cooldown read and both write, spending one
    -- cooldown on two changes.
    perform pg_advisory_xact_lock(hashtext('change_username'), hashtext(p_user_id::text));

    select pa.username::text, pa.username_changed_at
      into current_name, changed_at
      from public.player_accounts pa
     where pa.user_id = p_user_id;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'no_account');
    end if;

    if changed_at is not null and cfg.cooldown_hours > 0 then
        ready_at := changed_at + make_interval(hours => cfg.cooldown_hours);
        if ready_at > timezone('utc', now()) then
            return jsonb_build_object(
                'ok', false,
                'error', 'cooldown',
                'cooldown_until', ready_at,
                'message', 'You have already changed your username recently.'
            );
        end if;
    end if;

    -- Same name, different capitalisation, is a legitimate change (and cannot
    -- collide with anyone, since it only collides with itself). Identical is
    -- not a change at all and must not spend the cooldown.
    if current_name = candidate then
        return jsonb_build_object(
            'ok', false,
            'error', 'unchanged',
            'message', 'That is already your username.'
        );
    end if;

    reason := public.username_rejection(candidate);
    if reason is not null then
        return jsonb_build_object('ok', false, 'error', reason);
    end if;

    -- The citext unique index is what actually decides, including the
    -- case-insensitive collision the brief asks for. Catching its violation is
    -- the only check that cannot race a simultaneous claim of the same name.
    begin
        update public.player_accounts
           set username = candidate,
               username_changed_at = timezone('utc', now()),
               username_change_count = username_change_count + 1
         where user_id = p_user_id;
    exception
        when unique_violation then
            return jsonb_build_object(
                'ok', false,
                'error', 'taken',
                'message', 'That username is already taken.'
            );
        when check_violation then
            return jsonb_build_object('ok', false, 'error', 'invalid_characters');
    end;

    return jsonb_build_object(
        'ok', true,
        'username', candidate,
        'cooldown_until',
            timezone('utc', now()) + make_interval(hours => cfg.cooldown_hours)
    );
end;
$$;

revoke execute on function public.change_username(uuid, text) from public, anon, authenticated;
revoke execute on function public.username_rejection(text) from public, anon, authenticated;
revoke execute on function public.fold_username(text) from public, anon, authenticated;

comment on function public.change_username(uuid, text) is
'Renames an account. Service-role only: reached exclusively through the change-username Edge Function, which verifies Turnstile and the caller identity first. Enforces the kill switch, the cooldown, the character rules, the blocklist and case-insensitive uniqueness.';


-- ---------------------------------------------------------------------------
-- The email-prefix default, made safe
-- ---------------------------------------------------------------------------

-- Same intent as 001's — an explicit username from the signup form wins,
-- otherwise the part of the email before the @ — but the fallback now
-- SANITISES rather than raising, so an ordinary address with a dot in it
-- cannot fail a signup. Kept deliberately, per the brief, so renaming can be
-- switched off and new accounts still arrive with a sensible name.
--
-- ###########################################################################
-- ##  THIS FUNCTION HAS TWO OWNERS. 013 put the signup-claim enforcement   ##
-- ##  in here rather than in a trigger of its own, so a `create or         ##
-- ##  replace` that carries only the profile half SILENTLY DELETES the     ##
-- ##  signup gate — the kill switch, the account ceiling and the per-IP    ##
-- ##  limits all stop being enforced, because nothing forces a registrant  ##
-- ##  through begin_signup() any more.                                     ##
-- ##                                                                        ##
-- ##  The first cut of 015 did exactly that. PART 1 below is 013's half,   ##
-- ##  restored; 016 is the hotfix for databases that applied the broken    ##
-- ##  version. Never edit one half without carrying the other, and run     ##
-- ##  `node tests/lint.mjs`, which now fails if a definition loses the     ##
-- ##  claim check.                                                          ##
-- ###########################################################################
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    -- 013's half
    v_claim_id uuid;
    v_required boolean;
    v_claim_ok boolean := false;
    -- this migration's half
    cfg        public.username_config%rowtype;
    requested  text;
    candidate  text;
    base       text;
    suffix     integer := 0;
begin
    -- =======================================================================
    -- PART 1 — signup claim enforcement. Verbatim from 013; see that file for
    -- the reasoning. Runs FIRST: an account that is not allowed to exist
    -- should be refused before any effort goes into naming it.
    -- =======================================================================

    select c.require_signup_claim
      into v_required
      from public.signup_config c
     where c.id;

    v_required := coalesce(v_required, false);

    begin
        v_claim_id := nullif(trim(new.raw_user_meta_data ->> 'signup_claim'), '')::uuid;
    exception when others then
        v_claim_id := null;   -- not a uuid; treated as absent
    end;

    if v_claim_id is not null then
        update public.signup_claims sc
           set status     = 'completed',
               user_id    = new.id,
               settled_at = timezone('utc', now())
         where sc.claim_id = v_claim_id
           and sc.status = 'pending'
           and sc.created_at > timezone('utc', now()) - interval '15 minutes';

        if found then
            v_claim_ok := true;
        end if;
    end if;

    if not v_claim_ok then
        -- Confirmed-at-creation means the dashboard or Admin API, never the
        -- public endpoint. A property of the row, so it cannot be forged.
        if new.email_confirmed_at is not null then
            v_claim_ok := true;
        end if;
    end if;

    if not v_claim_ok then
        if v_required then
            raise exception 'signup_not_authorised'
                using hint = 'Registration must go through the website signup service.';
        else
            perform public.log_signup_attempt(
                extensions.digest('unclaimed', 'sha256'),
                'unclaimed_signup'
            );
        end if;
    end if;

    -- =======================================================================
    -- PART 2 — the username.
    -- =======================================================================

    select * into cfg from public.username_config where id;
    if not found then
        cfg.min_length := 5;
        cfg.max_length := 20;
    end if;

    requested := nullif(trim(new.raw_user_meta_data ->> 'username'), '');

    -- An explicit choice is honoured as-is or not at all: silently renaming
    -- what somebody typed would hand them an account they did not ask for.
    if requested is not null then
        if public.username_rejection(requested) is not null then
            raise exception 'New account has an invalid username';
        end if;
        candidate := requested;
    else
        -- Derive from the email. Strip what the format forbids, trim to the
        -- cap, and pad if what survives is too short to be legal.
        base := regexp_replace(
            split_part(coalesce(new.email, ''), '@', 1),
            '[^A-Za-z0-9_-]', '', 'g'
        );
        base := left(base, cfg.max_length);
        base := regexp_replace(base, '^[_-]+', '');

        if length(base) < cfg.min_length then
            base := 'Warrior';
        end if;

        -- A blocked or reserved word in an email prefix must not block the
        -- signup either — fall back rather than refuse.
        if public.username_rejection(base) is not null then
            base := 'Warrior';
        end if;

        candidate := base;

        -- Email prefixes collide constantly (every "info@", every "admin@").
        -- Walk to the first free variant, keeping inside the cap.
        while exists (
            select 1 from public.player_accounts pa
             where pa.username::text = candidate
        ) and suffix < 500 loop
            suffix := suffix + 1;
            candidate := left(base, cfg.max_length - length(suffix::text)) || suffix::text;
        end loop;
    end if;

    insert into public.player_accounts (user_id, username, favour)
    values (new.id, candidate, 0);   -- registering earns nothing

    return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

comment on function public.handle_new_auth_user() is
'Creates the player profile for a new auth user. Enforces the begin_signup() claim when signup_config.require_signup_claim is true (from 013) AND derives the username, falling back to a sanitised email prefix. BOTH responsibilities live here — every create-or-replace of this function must carry every earlier one forward.';


-- ---------------------------------------------------------------------------
-- Seed blocklist
-- ---------------------------------------------------------------------------

-- Terms are stored FOLDED (see fold_username) but spelled plainly: lowercase
-- letters only, no digits, no punctuation, and NOT run-collapsed — write
-- "nigger", not "niger". Matching handles the collapsing. The safe way to add
-- one is `insert ... values (public.fold_username('whatever'), ...)`, which
-- cannot produce a term that silently never matches.
--
-- 'exact' is used wherever the word is short enough, or English enough, to
-- appear inside an innocent name. On a game full of Greek names that matters
-- more than usual: "Cassandra", "Cockatrice", "Cumaean" and "Conall" would all
-- be casualties of an over-eager substring list.
--
-- Several 'exact' terms below are shorter than min_length (5) and so cannot be
-- matched by any name that is currently choosable. They are kept deliberately:
-- min_length is a config value, not a constant, and lowering it must not
-- quietly reopen "cum", "kkk" and "mod" as available names.
insert into public.username_blocklist (term, kind, note) values
    -- Slurs. Substring, because these are what padding is used to sneak past.
    ('nigger',   'substring', 'slur'),
    ('nigga',    'substring', 'slur'),
    ('faggot',   'substring', 'slur'),
    ('trannie',  'substring', 'slur'),
    ('tranny',   'substring', 'slur'),
    ('retard',   'substring', 'slur'),
    ('spastic',  'substring', 'slur'),
    ('chink',    'substring', 'slur'),
    ('kike',     'substring', 'slur'),
    ('wetback',  'substring', 'slur'),
    ('gook',     'exact',     'slur; exact only, short and vowel-doubled'),
    ('coon',     'exact',     'slur; exact only, cf. "Conall" once collapsed'),
    ('paki',     'exact',     'slur; exact only, appears inside ordinary words'),

    -- Sexual and scatological.
    ('fuck',     'substring', 'profanity'),
    ('shit',     'substring', 'profanity'),
    ('cunt',     'substring', 'profanity'),
    ('bitch',    'substring', 'profanity'),
    ('whore',    'substring', 'profanity'),
    ('slut',     'substring', 'profanity'),
    ('rapist',   'substring', 'profanity'),
    ('pedophile','substring', 'profanity'),
    ('paedophile','substring','profanity'),
    ('incest',   'substring', 'profanity'),
    ('bestiality','substring','profanity'),
    ('penis',    'substring', 'profanity'),
    ('vagina',   'substring', 'profanity'),
    ('boner',    'substring', 'profanity'),
    ('wanker',   'substring', 'profanity'),
    ('bastard',  'substring', 'profanity'),
    ('rape',     'exact',     'profanity; exact only, cf. "Draper", "grape"'),
    ('pedo',     'exact',     'profanity; exact only, cf. "torpedo"'),
    ('dick',     'exact',     'profanity; exact only, cf. "Dickens"'),
    ('cock',     'exact',     'profanity; exact only, cf. "Cockatrice"'),
    ('cum',      'exact',     'profanity; exact only, cf. "Cumaean"'),
    ('anal',     'exact',     'profanity; exact only, cf. "analyst"'),
    ('anus',     'exact',     'profanity'),
    ('tits',     'exact',     'profanity'),

    -- Hate.
    ('hitler',   'substring', 'hate'),
    ('nazi',     'substring', 'hate'),
    ('holocaust','substring', 'hate'),
    ('heilhitler','substring','hate'),
    ('gaschamber','substring','hate'),
    ('kkk',      'exact',     'hate; exact only, three letters'),
    ('lynch',    'exact',     'hate; exact only, is a surname'),

    -- Impersonation. Exact, so "Adminius" and "Modestus" survive but nobody
    -- can sit in a lobby called "Admin".
    ('admin',        'exact', 'impersonation'),
    ('administrator','exact', 'impersonation'),
    ('moderator',    'exact', 'impersonation'),
    ('mod',          'exact', 'impersonation'),
    ('staff',        'exact', 'impersonation'),
    ('support',      'exact', 'impersonation'),
    ('helpdesk',     'exact', 'impersonation'),
    ('system',       'exact', 'impersonation'),
    ('official',     'exact', 'impersonation'),
    ('triarchs',     'exact', 'impersonation'),
    ('triarch',      'exact', 'impersonation'),
    ('olympus',      'exact', 'impersonation'),
    ('alucasol',     'exact', 'impersonation; the developer'),
    ('developer',    'exact', 'impersonation'),
    ('server',       'exact', 'impersonation'),
    ('root',         'exact', 'impersonation'),
    ('owner',        'exact', 'impersonation'),

    -- Placeholder names that would read as a bug in a lobby.
    ('null',       'exact', 'placeholder'),
    ('undefined',  'exact', 'placeholder'),
    ('anonymous',  'exact', 'placeholder'),
    ('guest',      'exact', 'placeholder'),
    ('player',     'exact', 'placeholder'),
    ('you',        'exact', 'placeholder; the game uses this for an empty seat'),

    -- Exemptions. Ordinary words and place names that contain a blocked
    -- substring. Whole-name matches only — see the `kind` comment above.
    ('scunthorpe',  'allow', 'town; the canonical false positive'),
    ('penistone',   'allow', 'town'),
    ('lightwater',  'allow', 'town'),
    ('clitheroe',   'allow', 'town'),
    ('cockburn',    'allow', 'suburb of Perth'),
    ('cockfosters', 'allow', 'place'),
    ('cockermouth', 'allow', 'town'),
    ('babcock',     'allow', 'surname'),
    ('hancock',     'allow', 'surname'),
    ('peacock',     'allow', 'surname'),
    ('cumbria',     'allow', 'county'),
    ('cumberland',  'allow', 'place'),
    ('cummings',    'allow', 'surname'),
    ('cumming',     'allow', 'surname'),
    ('cumaean',     'allow', 'the Cumaean Sibyl — on theme, of all things'),
    ('succumb',     'allow', 'ordinary word'),
    ('assange',     'allow', 'surname'),
    ('shiitake',    'allow', 'ordinary word'),
    ('matsushita',  'allow', 'surname'),
    ('dickinson',   'allow', 'surname'),
    ('dickson',     'allow', 'surname'),
    ('arsenal',     'allow', 'ordinary word'),
    ('titan',       'allow', 'ordinary word; very much on theme'),
    ('titania',     'allow', 'name'),
    ('titanic',     'allow', 'ordinary word'),
    ('constitution','allow', 'ordinary word')
on conflict (term) do nothing;


-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Accounts that predate this migration have never renamed, so their cooldown
-- must start clear rather than at the epoch. username_changed_at is already
-- NULL for every existing row (the column was just added), which reads as
-- "never renamed" — nothing to do. Recorded here so the absence is visibly
-- deliberate rather than an oversight.
