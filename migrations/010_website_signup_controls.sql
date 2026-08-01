-- Website signup controls for Triarchs of Olympus.
--
-- 001 established that the browser client is READ-ONLY on its own account row
-- and can never write Favour. This migration extends the same principle to
-- account *creation*: the website may ask for an account, but only trusted
-- server-side code decides whether one is granted.
--
-- Nothing in this file is reachable from the browser. Every table has RLS on
-- with no policies and all privileges revoked from anon/authenticated, and
-- every function has EXECUTE revoked from those roles. Only a service-role
-- caller (the signup Edge Function, the SQL Editor) can reach any of it. The
-- website therefore cannot switch signup modes, raise the ceiling, read invite
-- hashes, or see the IP quota — it can only call the Edge Function and be told
-- yes or no.
--
-- THE GATES, in the order begin_signup() applies them:
--
--   1. signup_mode      'public' | 'disabled' | 'invite_only'   (kill switch)
--   2. maximum_accounts absolute ceiling on auth.users, pending included
--   3. IP quota         2 per rolling 24h, 5 per rolling 30 days
--   4. invitation       only when mode = 'invite_only'
--
-- CONCURRENCY. Signup is a rare event with a hard global ceiling, so
-- begin_signup takes a transaction-scoped advisory lock and serialises the
-- whole decision. Two simultaneous registrations therefore cannot both read
-- "999 accounts exist" and both proceed, and cannot both consume the last use
-- of one invitation. The invite counter is additionally guarded by its own
-- conditional UPDATE, so it stays correct even if the lock were ever removed.
--
-- TWO-PHASE CLAIM. Supabase Auth, not this database, actually creates the
-- user, and that call can still fail (duplicate email, CAPTCHA rejection).
-- begin_signup therefore *reserves* a slot and returns a claim; the caller
-- then completes it or aborts it. An abort releases the invitation use and the
-- IP quota row, so a failed attempt costs the visitor nothing. Claims left
-- pending by a crashed caller are swept by expire_signup_claims().
--
-- PRIVACY. A raw IP address is never stored, and neither is an unsalted hash
-- of one (the IPv4 space is small enough to enumerate in seconds). The Edge
-- Function computes an HMAC-SHA256 of the address using a secret held only in
-- the function's environment and passes the digest here. This database never
-- sees the address or the key, and the digests are deleted after 30 days —
-- exactly the window the longest limit needs.

create extension if not exists pgcrypto with schema extensions;


-- ---------------------------------------------------------------------------
-- Configuration (singleton)
-- ---------------------------------------------------------------------------

create table if not exists public.signup_config (
    -- Single-row table: the primary key can only ever hold `true`.
    id boolean primary key default true
        check (id),

    signup_mode text not null default 'public'
        check (signup_mode in ('public', 'disabled', 'invite_only')),

    maximum_accounts integer not null default 1000
        check (maximum_accounts >= 0),

    updated_at timestamptz not null default timezone('utc', now())
);

insert into public.signup_config (id, signup_mode, maximum_accounts)
values (true, 'public', 1000)
on conflict (id) do nothing;

alter table public.signup_config enable row level security;

revoke all on table public.signup_config from anon, authenticated;

comment on table public.signup_config is
'Server-only signup kill switch and account ceiling. No browser access: the website cannot read or change registration mode.';


-- ---------------------------------------------------------------------------
-- Invitations (prepared, not enabled — signup_mode stays 'public')
-- ---------------------------------------------------------------------------

create table if not exists public.signup_invites (
    invite_id uuid primary key default gen_random_uuid(),

    -- Only the SHA-256 of the code is stored. Codes are generated with 160
    -- bits of entropy by create_signup_invite(), so there is no dictionary to
    -- run against the digest and no salt is required.
    code_hash text not null unique,

    label text not null default '',

    max_uses integer not null default 1
        check (max_uses >= 1),

    used_count integer not null default 0
        check (used_count >= 0),

    is_enabled boolean not null default true,

    expires_at timestamptz,

    created_at timestamptz not null default timezone('utc', now()),

    constraint signup_invites_not_overused
        check (used_count <= max_uses)
);

alter table public.signup_invites enable row level security;

revoke all on table public.signup_invites from anon, authenticated;

comment on table public.signup_invites is
'Hashed single-use (by default) invitation codes. Consumed atomically by begin_signup. Server-only.';


-- ---------------------------------------------------------------------------
-- IP quota — keyed HMAC digests only, never an address
-- ---------------------------------------------------------------------------

create table if not exists public.signup_ip_quota (
    quota_id bigint generated always as identity primary key,

    -- HMAC-SHA256(client ip, server-only secret), computed in the Edge
    -- Function. 32 bytes. Not reversible and not enumerable without the key.
    ip_hmac bytea not null
        check (octet_length(ip_hmac) = 32),

    claim_id uuid,

    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists signup_ip_quota_lookup_idx
on public.signup_ip_quota (ip_hmac, created_at desc);

create index if not exists signup_ip_quota_purge_idx
on public.signup_ip_quota (created_at);

alter table public.signup_ip_quota enable row level security;

revoke all on table public.signup_ip_quota from anon, authenticated;

comment on table public.signup_ip_quota is
'One row per reserved/successful registration, keyed by HMAC of the origin IP. Enforces 2/24h and 5/30d. Purged after 30 days.';


-- ---------------------------------------------------------------------------
-- Rejected-attempt log — short retention, hard per-IP cap on growth
-- ---------------------------------------------------------------------------

create table if not exists public.signup_attempt_log (
    attempt_id bigint generated always as identity primary key,

    ip_hmac bytea
        check (ip_hmac is null or octet_length(ip_hmac) = 32),

    outcome text not null,

    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists signup_attempt_log_recent_idx
on public.signup_attempt_log (ip_hmac, created_at desc);

create index if not exists signup_attempt_log_purge_idx
on public.signup_attempt_log (created_at);

alter table public.signup_attempt_log enable row level security;

revoke all on table public.signup_attempt_log from anon, authenticated;

comment on table public.signup_attempt_log is
'Rejected signup attempts, for spotting abuse. Capped at 20 rows per IP per hour and purged after 7 days, so a bot cannot grow it without bound.';


-- ---------------------------------------------------------------------------
-- Claims — the two-phase reservation
-- ---------------------------------------------------------------------------

create table if not exists public.signup_claims (
    claim_id uuid primary key default gen_random_uuid(),

    ip_hmac bytea not null
        check (octet_length(ip_hmac) = 32),

    invite_id uuid
        references public.signup_invites(invite_id)
        on delete set null,

    status text not null default 'pending'
        check (status in ('pending', 'completed', 'aborted')),

    user_id uuid,

    created_at timestamptz not null default timezone('utc', now()),
    settled_at timestamptz
);

create index if not exists signup_claims_pending_idx
on public.signup_claims (created_at)
where status = 'pending';

alter table public.signup_claims enable row level security;

revoke all on table public.signup_claims from anon, authenticated;

comment on table public.signup_claims is
'Reserved signup slots awaiting the Auth call to succeed or fail. Stale pending claims are released by expire_signup_claims().';


-- ---------------------------------------------------------------------------
-- begin_signup — the gate
-- ---------------------------------------------------------------------------
--
-- Returns, on success:
--   { "ok": true, "claim_id": "<uuid>" }
-- and otherwise:
--   { "ok": false, "error": "signup_disabled" | "invite_required"
--                         | "invalid_invite"  | "account_limit_reached"
--                         | "ip_rate_limited_daily"
--                         | "ip_rate_limited_monthly"
--                         | "invalid_request",
--     "retry_after_seconds": <integer, rate limits only> }
--
-- Error strings are deliberately coarse. The Edge Function maps them to
-- friendly text and never repeats internal detail to the browser.

-- `p_ip_hex` is the lowercase hex of the 32-byte HMAC, passed as text rather
-- than bytea so there is no argument about how PostgREST should encode it on
-- the way in. It is decoded once, here, and stored as bytea.
create or replace function public.begin_signup(
    p_ip_hex      text,
    p_invite_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    p_ip_hmac     bytea;
    v_mode        text;
    v_ceiling     integer;
    v_accounts    integer;
    v_pending     integer;
    v_daily       integer;
    v_monthly     integer;
    v_invite_id   uuid;
    v_claim_id    uuid;
    v_hash        text;
    v_oldest      timestamptz;
    v_retry       integer;
begin
    if p_ip_hex is null or p_ip_hex !~ '^[0-9a-f]{64}$' then
        return jsonb_build_object('ok', false, 'error', 'invalid_request');
    end if;

    p_ip_hmac := decode(p_ip_hex, 'hex');

    -- Serialise the entire decision. Signups are rare and capped at a few
    -- thousand for the lifetime of the project, so the contention cost is
    -- nil and the reasoning becomes trivial: no two claims interleave.
    perform pg_advisory_xact_lock(hashtext('triarchs.signup'));

    select c.signup_mode, c.maximum_accounts
      into v_mode, v_ceiling
      from public.signup_config c
     where c.id;

    if not found then
        -- Fail closed. A missing configuration row must not mean "no limits".
        return jsonb_build_object('ok', false, 'error', 'signup_disabled');
    end if;

    -- ---- gate 1: kill switch -------------------------------------------
    if v_mode = 'disabled' then
        perform public.log_signup_attempt(p_ip_hmac, 'signup_disabled');
        return jsonb_build_object('ok', false, 'error', 'signup_disabled');
    end if;

    -- ---- gate 2: absolute ceiling --------------------------------------
    -- Confirmed and unconfirmed alike, plus slots already reserved by an
    -- in-flight claim, so the ceiling cannot be overshot by concurrency.
    select count(*) into v_accounts from auth.users;

    select count(*) into v_pending
      from public.signup_claims sc
     where sc.status = 'pending';

    if v_accounts + v_pending >= v_ceiling then
        perform public.log_signup_attempt(p_ip_hmac, 'account_limit_reached');
        return jsonb_build_object('ok', false, 'error', 'account_limit_reached');
    end if;

    -- ---- gate 3: per-IP rolling limits ---------------------------------
    select count(*) into v_daily
      from public.signup_ip_quota q
     where q.ip_hmac = p_ip_hmac
       and q.created_at > timezone('utc', now()) - interval '24 hours';

    if v_daily >= 2 then
        select min(q.created_at) into v_oldest
          from public.signup_ip_quota q
         where q.ip_hmac = p_ip_hmac
           and q.created_at > timezone('utc', now()) - interval '24 hours';

        v_retry := greatest(
            1,
            ceil(extract(epoch from
                (v_oldest + interval '24 hours') - timezone('utc', now())
            ))::integer
        );

        perform public.log_signup_attempt(p_ip_hmac, 'ip_rate_limited_daily');
        return jsonb_build_object(
            'ok', false,
            'error', 'ip_rate_limited_daily',
            'retry_after_seconds', v_retry
        );
    end if;

    select count(*) into v_monthly
      from public.signup_ip_quota q
     where q.ip_hmac = p_ip_hmac
       and q.created_at > timezone('utc', now()) - interval '30 days';

    if v_monthly >= 5 then
        select min(q.created_at) into v_oldest
          from public.signup_ip_quota q
         where q.ip_hmac = p_ip_hmac
           and q.created_at > timezone('utc', now()) - interval '30 days';

        v_retry := greatest(
            1,
            ceil(extract(epoch from
                (v_oldest + interval '30 days') - timezone('utc', now())
            ))::integer
        );

        perform public.log_signup_attempt(p_ip_hmac, 'ip_rate_limited_monthly');
        return jsonb_build_object(
            'ok', false,
            'error', 'ip_rate_limited_monthly',
            'retry_after_seconds', v_retry
        );
    end if;

    -- ---- gate 4: invitation --------------------------------------------
    if v_mode = 'invite_only' then
        if p_invite_code is null or trim(p_invite_code) = '' then
            perform public.log_signup_attempt(p_ip_hmac, 'invite_required');
            return jsonb_build_object('ok', false, 'error', 'invite_required');
        end if;

        v_hash := encode(
            extensions.digest(upper(trim(p_invite_code)), 'sha256'),
            'hex'
        );

        -- One conditional UPDATE consumes the use. Under READ COMMITTED a
        -- second transaction blocks on the row, then re-evaluates the WHERE
        -- against the committed row, so `used_count < max_uses` cannot pass
        -- twice for the same final use.
        update public.signup_invites i
           set used_count = i.used_count + 1
         where i.code_hash = v_hash
           and i.is_enabled
           and (i.expires_at is null or i.expires_at > timezone('utc', now()))
           and i.used_count < i.max_uses
        returning i.invite_id into v_invite_id;

        if v_invite_id is null then
            perform public.log_signup_attempt(p_ip_hmac, 'invalid_invite');
            return jsonb_build_object('ok', false, 'error', 'invalid_invite');
        end if;
    end if;

    -- ---- reserve --------------------------------------------------------
    insert into public.signup_claims (ip_hmac, invite_id)
    values (p_ip_hmac, v_invite_id)
    returning claim_id into v_claim_id;

    insert into public.signup_ip_quota (ip_hmac, claim_id)
    values (p_ip_hmac, v_claim_id);

    return jsonb_build_object('ok', true, 'claim_id', v_claim_id);
end;
$$;


-- Bounded rejection logging. Keeps at most 20 rows per IP per hour so an
-- automated attack cannot inflate the table, and is a no-op past that.
create or replace function public.log_signup_attempt(
    p_ip_hmac bytea,
    p_outcome text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_recent integer;
begin
    select count(*) into v_recent
      from public.signup_attempt_log l
     where l.ip_hmac = p_ip_hmac
       and l.created_at > timezone('utc', now()) - interval '1 hour';

    if v_recent < 20 then
        insert into public.signup_attempt_log (ip_hmac, outcome)
        values (p_ip_hmac, left(coalesce(p_outcome, 'unknown'), 64));
    end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- complete_signup / abort_signup — settling a claim
-- ---------------------------------------------------------------------------

create or replace function public.complete_signup(
    p_claim_id uuid,
    p_user_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_status text;
begin
    update public.signup_claims c
       set status     = 'completed',
           user_id    = p_user_id,
           settled_at = timezone('utc', now())
     where c.claim_id = p_claim_id
       and c.status = 'pending'
    returning c.status into v_status;

    if v_status is null then
        return jsonb_build_object('ok', false, 'error', 'claim_not_pending');
    end if;

    -- The quota row stays. It is the durable record of a successful
    -- registration from this IP, and is purged on the 30-day schedule.
    return jsonb_build_object('ok', true);
end;
$$;


create or replace function public.abort_signup(p_claim_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_invite_id uuid;
    v_status    text;
begin
    update public.signup_claims c
       set status     = 'aborted',
           settled_at = timezone('utc', now())
     where c.claim_id = p_claim_id
       and c.status = 'pending'
    returning c.invite_id, c.status into v_invite_id, v_status;

    if v_status is null then
        return jsonb_build_object('ok', false, 'error', 'claim_not_pending');
    end if;

    -- The attempt cost the visitor nothing: give back the quota slot and the
    -- invitation use.
    delete from public.signup_ip_quota q
     where q.claim_id = p_claim_id;

    if v_invite_id is not null then
        update public.signup_invites i
           set used_count = greatest(i.used_count - 1, 0)
         where i.invite_id = v_invite_id;
    end if;

    return jsonb_build_object('ok', true);
end;
$$;


-- Sweeps claims whose caller died between reserving and settling. Idempotent.
create or replace function public.expire_signup_claims(
    p_older_than interval default interval '15 minutes'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_claim_id uuid;
    v_count    integer := 0;
begin
    for v_claim_id in
        select c.claim_id
          from public.signup_claims c
         where c.status = 'pending'
           and c.created_at < timezone('utc', now()) - p_older_than
    loop
        perform public.abort_signup(v_claim_id);
        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;


-- Retention. IP digests live exactly as long as the 30-day limit needs them;
-- rejection logs go after a week.
create or replace function public.purge_signup_records()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_quota    integer;
    v_attempts integer;
    v_claims   integer;
begin
    delete from public.signup_ip_quota q
     where q.created_at < timezone('utc', now()) - interval '30 days';
    get diagnostics v_quota = row_count;

    delete from public.signup_attempt_log l
     where l.created_at < timezone('utc', now()) - interval '7 days';
    get diagnostics v_attempts = row_count;

    delete from public.signup_claims c
     where c.status <> 'pending'
       and c.created_at < timezone('utc', now()) - interval '30 days';
    get diagnostics v_claims = row_count;

    return jsonb_build_object(
        'ok', true,
        'ip_quota_deleted', v_quota,
        'attempt_log_deleted', v_attempts,
        'claims_deleted', v_claims
    );
end;
$$;


-- ---------------------------------------------------------------------------
-- Operator helpers (SQL Editor / service-role only)
-- ---------------------------------------------------------------------------

create or replace function public.set_signup_mode(p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_mode text := lower(trim(coalesce(p_mode, '')));
begin
    if v_mode not in ('public', 'disabled', 'invite_only') then
        return jsonb_build_object(
            'ok', false,
            'error', 'invalid_mode',
            'allowed', jsonb_build_array('public', 'disabled', 'invite_only')
        );
    end if;

    update public.signup_config
       set signup_mode = v_mode,
           updated_at  = timezone('utc', now())
     where id;

    return jsonb_build_object('ok', true, 'signup_mode', v_mode);
end;
$$;


create or replace function public.set_maximum_accounts(p_maximum integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_existing integer;
begin
    if p_maximum is null or p_maximum < 0 then
        return jsonb_build_object('ok', false, 'error', 'invalid_maximum');
    end if;

    select count(*) into v_existing from auth.users;

    update public.signup_config
       set maximum_accounts = p_maximum,
           updated_at       = timezone('utc', now())
     where id;

    return jsonb_build_object(
        'ok', true,
        'maximum_accounts', p_maximum,
        'existing_accounts', v_existing
    );
end;
$$;


-- Generates the code, stores only its hash, and returns the plaintext ONCE.
-- There is no way to recover it afterwards — that is the point.
create or replace function public.create_signup_invite(
    p_label      text default '',
    p_max_uses   integer default 1,
    p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_code  text;
    v_hash  text;
    v_id    uuid;
    v_bytes bytea;
begin
    if p_max_uses is null or p_max_uses < 1 then
        return jsonb_build_object('ok', false, 'error', 'invalid_max_uses');
    end if;

    v_bytes := extensions.gen_random_bytes(20);

    -- 100 bits, base32-ish alphabet without look-alike characters, grouped for
    -- reading aloud. Uppercase because begin_signup upper()s before hashing.
    -- gen_random_bytes, not random(): this is a credential, and 256/32 divides
    -- exactly so the byte-modulo mapping stays uniform.
    v_code := (
        select string_agg(
            substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                   1 + (get_byte(v_bytes, g) % 32), 1),
            ''
            order by g
        )
        from generate_series(0, 19) as g
    );
    v_code := substr(v_code, 1, 5) || '-' ||
              substr(v_code, 6, 5) || '-' ||
              substr(v_code, 11, 5) || '-' ||
              substr(v_code, 16, 5);

    v_hash := encode(extensions.digest(v_code, 'sha256'), 'hex');

    insert into public.signup_invites (code_hash, label, max_uses, expires_at)
    values (v_hash, coalesce(left(p_label, 120), ''), p_max_uses, p_expires_at)
    returning invite_id into v_id;

    return jsonb_build_object(
        'ok', true,
        'invite_id', v_id,
        'code', v_code,
        'max_uses', p_max_uses,
        'expires_at', p_expires_at,
        'note', 'Copy this code now. Only its hash is stored; it cannot be shown again.'
    );
end;
$$;


-- A read-only operator view of the gates, safe to run in the SQL Editor.
create or replace function public.signup_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_mode     text;
    v_ceiling  integer;
    v_accounts integer;
    v_pending  integer;
    v_unconf   integer;
begin
    select c.signup_mode, c.maximum_accounts
      into v_mode, v_ceiling
      from public.signup_config c
     where c.id;

    select count(*) into v_accounts from auth.users;
    select count(*) into v_unconf from auth.users u where u.email_confirmed_at is null;
    select count(*) into v_pending from public.signup_claims sc where sc.status = 'pending';

    return jsonb_build_object(
        'signup_mode', v_mode,
        'maximum_accounts', v_ceiling,
        'existing_accounts', v_accounts,
        'unconfirmed_accounts', v_unconf,
        'pending_claims', v_pending,
        'slots_remaining', greatest(v_ceiling - v_accounts - v_pending, 0)
    );
end;
$$;


-- ---------------------------------------------------------------------------
-- Privileges: service-role callers only, exactly as with grant_favour in 005.
-- ---------------------------------------------------------------------------

revoke execute on function public.begin_signup(text, text)          from public, anon, authenticated;
revoke execute on function public.log_signup_attempt(bytea, text)    from public, anon, authenticated;
revoke execute on function public.complete_signup(uuid, uuid)        from public, anon, authenticated;
revoke execute on function public.abort_signup(uuid)                 from public, anon, authenticated;
revoke execute on function public.expire_signup_claims(interval)     from public, anon, authenticated;
revoke execute on function public.purge_signup_records()             from public, anon, authenticated;
revoke execute on function public.set_signup_mode(text)              from public, anon, authenticated;
revoke execute on function public.set_maximum_accounts(integer)      from public, anon, authenticated;
revoke execute on function public.create_signup_invite(text, integer, timestamptz)
                                                                     from public, anon, authenticated;
revoke execute on function public.signup_status()                    from public, anon, authenticated;

comment on function public.begin_signup(text, text) is
'Applies every signup gate under an advisory lock and reserves a slot. Service-role only; the website reaches it exclusively through the signup Edge Function.';

comment on function public.create_signup_invite(text, integer, timestamptz) is
'Creates an invitation and returns its plaintext code once. Only the SHA-256 hash is stored.';