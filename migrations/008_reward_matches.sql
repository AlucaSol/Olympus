-- Match-outcome Favour rewards for Triarchs of Olympus.
--
-- A signed-in player earns Favour for winning (30) or placing second (10) in
-- a genuine 3-empire match, capped at 250 Favour of REWARD income per player
-- per UTC day (separate from Favour bought or admin-granted — this cap only
-- throttles what winning/placing can pay out). Everything that decides
-- whether and how much to pay is resolved here, server-side, from server time
-- and server state:
--
--   * The host's browser is never trusted with the payout decision, only with
--     reporting facts its own authoritative match simulation already knows
--     (who won, who placed second, who is still actually playing) — the same
--     trust level this schema already gives a host for Boons and hero
--     selection (see 003_boons.sql, 006_hero_store.sql): a peer-to-peer host
--     cannot cryptographically prove another peer's identity, so this remains
--     a casual-game-appropriate defence against a modified client giving
--     itself Favour, not a competitive-integrity guarantee.
--   * The one claim that WOULD be self-serving to fake — inflating a single
--     account's own reward by claiming it fills several seats at once — is
--     closed at the schema level: `reward_match_players` has a unique
--     (match_id, user_id), so the same account is ever paid at most once per
--     match no matter how many seats a tampered client claims it occupies.
--   * The 10-minute minimum is measured against `created_at`, stamped by this
--     database when the match ticket is issued — never anything the client
--     supplies.
--   * The daily cap and the one-time-per-match payout together bound the
--     total value of even a determined attempt at abuse to a small, fixed
--     amount per account per day — proportionate to a casual game's stakes.
--
-- Two entry points, both plain RPCs like everything else in this project
-- (there are no Edge Functions here):
--
--   create_reward_match(p_empire_counts, p_players)
--     Called once, when the host presses Start Match. Issues a ticket
--     (reward_matches row) stamped with this database's own `now()`, and
--     resolves each claimed username to its account — see the header on
--     player resolution below for why this is done by username, not user_id.
--     Refuses to issue one at all unless every one of the 3 empires has at
--     least one seat and at least one seat resolved to a real account.
--
--   finalize_reward_match(p_match_id, p_winner_empire, p_runner_up_empire, p_present_slots)
--     Called once, when the host's own simulation sees the match end. Re-
--     verifies the 10 minutes server-side, pays the still-present winners and
--     runners-up (clamped to the daily cap), and marks the ticket spent so a
--     retried or duplicated call can never pay twice.
--
-- Player resolution is by USERNAME, not user_id: PlayerAccount (see
-- game/entities.ts) only ever carries a username between peers — teaching the
-- whole peer-to-peer stack a raw user_id just for this feature isn't worth
-- it, and this database already resolves accounts by username for the same
-- reason in grant_favour (005_grant_favour.sql).

create table public.reward_matches (
    match_id bigint generated always as identity primary key,

    -- The only timestamp that matters: this database's own clock at the
    -- moment the ticket was issued. The client never supplies a time.
    created_at timestamptz not null default timezone('utc', now()),

    status text not null default 'pending'
        check (status in ('pending', 'finalized')),

    winner_empire smallint
        check (winner_empire between 0 and 2),
    runner_up_empire smallint
        check (runner_up_empire between 0 and 2),
    finalized_at timestamptz
);

alter table public.reward_matches enable row level security;

-- The client never reads this table directly — only through the two RPCs
-- below and through its own rows in reward_match_players. RLS stays enabled
-- with no policies at all, exactly like favour_transactions: belt-and-braces
-- alongside the revoke below, not a substitute for it.
revoke all
on table public.reward_matches
from anon, authenticated;

create table public.reward_match_players (
    match_id bigint not null
        references public.reward_matches(match_id)
        on delete cascade,

    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    slot smallint not null
        check (slot between 0 and 5),
    empire smallint not null
        check (empire between 0 and 2),

    -- Filled in by finalize_reward_match; null until then.
    present boolean,
    -- The tier this seat's empire earned before the daily cap (0, 10 or 30) —
    -- kept alongside `awarded` so a capped-to-zero payout can still be told
    -- apart from "you lost" or "you left before the match finished".
    tier bigint,
    awarded bigint,

    -- The real guarantee behind "the same account is never paid twice for
    -- one match", regardless of how many seats a tampered client claims it
    -- occupies (see this file's header).
    primary key (match_id, user_id)
);

create index reward_match_players_user_idx
on public.reward_match_players (user_id);

alter table public.reward_match_players enable row level security;

revoke all
on table public.reward_match_players
from anon, authenticated;

grant select
on table public.reward_match_players
to authenticated;

create policy "Players can read their own reward-match rows"
on public.reward_match_players
for select
to authenticated
using (
    auth.uid() is not null
    and auth.uid() = user_id
);

-- Issues a reward-match ticket, or refuses to.
--
-- p_empire_counts: exactly 3 integers, active (non-Closed) seats per empire,
--   in empire order. Any zero means an empty empire — the whole match is
--   ineligible, not just that empire's (nonexistent) players.
-- p_players: jsonb array of {slot, empire, username}, one entry per seat that
--   was signed in when Start Match was pressed. A username that doesn't
--   resolve to a real account is silently skipped, exactly like an unknown
--   Boon id already is elsewhere in this schema.
--
-- Returns { ok: true, match_id } or { ok: false, error }. A false result is
-- an entirely normal outcome (an ineligible match), not a fault — the caller
-- simply plays the match without a reward ticket attached.
create or replace function public.create_reward_match(
    p_empire_counts int[],
    p_players jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_match_id bigint;
    v_player jsonb;
    v_user_id uuid;
    v_registered int := 0;
begin
    if p_empire_counts is null or array_length(p_empire_counts, 1) <> 3
       or p_empire_counts[1] < 1 or p_empire_counts[2] < 1 or p_empire_counts[3] < 1 then
        return jsonb_build_object('ok', false, 'error', 'not_all_teams_populated');
    end if;

    if p_players is null or jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) = 0 then
        return jsonb_build_object('ok', false, 'error', 'no_logged_in_players');
    end if;

    insert into public.reward_matches default values
    returning match_id into v_match_id;

    for v_player in select * from jsonb_array_elements(p_players)
    loop
        select a.user_id
          into v_user_id
          from public.player_accounts a
         where lower(a.username::text) = lower(v_player->>'username');

        if v_user_id is not null then
            insert into public.reward_match_players (match_id, user_id, slot, empire)
            values (v_match_id, v_user_id, (v_player->>'slot')::smallint, (v_player->>'empire')::smallint)
            on conflict (match_id, user_id) do nothing;
            v_registered := v_registered + 1;
        end if;
    end loop;

    if v_registered = 0 then
        -- Every claimed username was fake or stale — there is no account this
        -- ticket could ever pay, so there is nothing to keep it open for.
        delete from public.reward_matches where match_id = v_match_id;
        return jsonb_build_object('ok', false, 'error', 'no_logged_in_players');
    end if;

    return jsonb_build_object('ok', true, 'match_id', v_match_id);
end;
$$;

-- The caller may be a signed-out (guest) host — the host itself need not have
-- an account for other, signed-in seats to be reward-eligible.
revoke execute
on function public.create_reward_match(int[], jsonb)
from public;

grant execute
on function public.create_reward_match(int[], jsonb)
to anon, authenticated;

-- Settles one ticket: verifies the 10 minutes against this database's own
-- clock, pays whoever is still present on the winning (30) and runner-up (10)
-- empires — clamped so nobody crosses 250 Favour of reward income today —
-- and marks the ticket spent so it can never pay out twice.
--
-- p_present_slots: slots (0-5) the host's own simulation still shows as
-- human at the moment the match ended — see PlayerState.human in
-- game/entities.ts. A seat missing from this list gets tier 0 regardless of
-- which empire it belonged to: it left before the match finished.
--
-- Returns:
--   { ok: true, awards: [{ slot, tier, awarded }, ...] }
--   { ok: false, error: 'not_found' | 'already_finalized' | 'too_soon' }
create or replace function public.finalize_reward_match(
    p_match_id bigint,
    p_winner_empire smallint,
    p_runner_up_empire smallint,
    p_present_slots int[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_created_at timestamptz;
    v_status text;
    v_row record;
    v_today_total bigint;
    v_tier bigint;
    v_present boolean;
    v_awarded bigint;
    v_awards jsonb := '[]'::jsonb;
begin
    select created_at, status
      into v_created_at, v_status
      from public.reward_matches
     where match_id = p_match_id
       for update;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    if v_status <> 'pending' then
        return jsonb_build_object('ok', false, 'error', 'already_finalized');
    end if;

    if now() - v_created_at < interval '10 minutes' then
        return jsonb_build_object('ok', false, 'error', 'too_soon');
    end if;

    for v_row in
        select * from public.reward_match_players
         where match_id = p_match_id
           for update
    loop
        v_present := coalesce(p_present_slots, array[]::int[]) @> array[v_row.slot::int];

        v_tier := case
            when not v_present then 0
            when v_row.empire = p_winner_empire then 30
            when v_row.empire = p_runner_up_empire then 10
            else 0
        end;

        if v_tier > 0 then
            -- Lock the balance before reading today's total, so a concurrent
            -- purchase or grant for the same account cannot land between the
            -- read and the update below.
            perform 1 from public.player_accounts where user_id = v_row.user_id for update;

            select coalesce(sum(amount), 0)
              into v_today_total
              from public.favour_transactions
             where user_id = v_row.user_id
               and reason = 'match_reward'
               and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');

            v_awarded := greatest(0, least(v_tier, 250 - v_today_total));
        else
            v_awarded := 0;
        end if;

        if v_awarded > 0 then
            update public.player_accounts
               set favour = favour + v_awarded
             where user_id = v_row.user_id;

            insert into public.favour_transactions (user_id, amount, reason, external_reference)
            values (
                v_row.user_id, v_awarded, 'match_reward',
                'reward_match:' || p_match_id || ':' || v_row.user_id
            )
            on conflict (external_reference) do nothing;
        end if;

        update public.reward_match_players
           set present = v_present, tier = v_tier, awarded = v_awarded
         where match_id = p_match_id and user_id = v_row.user_id;

        v_awards := v_awards || jsonb_build_object('slot', v_row.slot, 'tier', v_tier, 'awarded', v_awarded);
    end loop;

    update public.reward_matches
       set status = 'finalized', winner_empire = p_winner_empire,
           runner_up_empire = p_runner_up_empire, finalized_at = now()
     where match_id = p_match_id;

    return jsonb_build_object('ok', true, 'awards', v_awards);
end;
$$;

revoke execute
on function public.finalize_reward_match(bigint, smallint, smallint, int[])
from public;

grant execute
on function public.finalize_reward_match(bigint, smallint, smallint, int[])
to anon, authenticated;

-- How much of the calling player's OWN Favour today came from match rewards
-- — the same 250 daily ceiling finalize_reward_match enforces, exposed so
-- the client can show progress toward it without ever seeing the ledger
-- itself (favour_transactions stays fully server-only). Returns 0 for a
-- signed-out caller rather than erroring, so it is always safe to call.
create or replace function public.get_my_daily_reward_favour()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_total bigint;
begin
    if v_user_id is null then
        return 0;
    end if;

    select coalesce(sum(amount), 0)
      into v_total
      from public.favour_transactions
     where user_id = v_user_id
       and reason = 'match_reward'
       and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');

    return v_total;
end;
$$;

revoke execute
on function public.get_my_daily_reward_favour()
from public, anon;

grant execute
on function public.get_my_daily_reward_favour()
to authenticated;

comment on table public.reward_matches is
'Server-issued tickets for match-outcome Favour rewards. created_at is this database''s own clock, never client-supplied.';

comment on table public.reward_match_players is
'Which signed-in accounts sat in a reward match, and what finalize_reward_match decided to pay each. Unique per (match_id, user_id): the same account cannot be paid twice for one match.';

comment on function public.create_reward_match(int[], jsonb) is
'Issues a reward-match ticket if all 3 empires are populated and at least one seat resolves to a real account. Callable by guests (the host need not be signed in).';

comment on function public.finalize_reward_match(bigint, smallint, smallint, int[]) is
'Pays out a reward-match ticket once, after re-verifying 10 minutes have passed server-side. The only path by which match-reward Favour is granted.';
