-- Trial account system for Triarchs of Olympus.
-- Password auth itself lives in Supabase's built-in auth.users table; this
-- migration only adds the public game-profile row and a server-only Favour
-- ledger. The browser client is granted SELECT on its own row and nothing
-- else — Favour is written exclusively by trusted server-side processes.

create extension if not exists citext;

create table if not exists public.player_accounts (
    user_id uuid primary key
        references auth.users(id)
        on delete cascade,

    username citext not null unique,

    favour bigint not null default 0
        check (favour >= 0),

    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),

    constraint player_accounts_username_format
        check (username::text ~ '^[A-Za-z0-9_]{3,24}$')
);

alter table public.player_accounts enable row level security;

revoke all
on table public.player_accounts
from anon, authenticated;

grant select
on table public.player_accounts
to authenticated;

create policy "Players can read their own account"
on public.player_accounts
for select
to authenticated
using (
    auth.uid() is not null
    and auth.uid() = user_id
);

create or replace function public.set_player_account_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists set_player_account_updated_at
on public.player_accounts;

create trigger set_player_account_updated_at
before update on public.player_accounts
for each row
execute function public.set_player_account_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    selected_username text;
begin
    selected_username := coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
        split_part(coalesce(new.email, ''), '@', 1)
    );

    if selected_username !~ '^[A-Za-z0-9_]{3,24}$' then
        raise exception 'New account has an invalid username';
    end if;

    insert into public.player_accounts (
        user_id,
        username,
        favour
    )
    values (
        new.id,
        selected_username,
        0
    );

    return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_player_account
on auth.users;

create trigger on_auth_user_created_create_player_account
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

revoke execute
on function public.handle_new_auth_user()
from public, anon, authenticated;

revoke execute
on function public.set_player_account_updated_at()
from public, anon, authenticated;

create table if not exists public.favour_transactions (
    transaction_id bigint generated always as identity primary key,

    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    amount bigint not null
        check (amount <> 0),

    reason text not null,

    external_reference text unique,

    created_at timestamptz not null default timezone('utc', now())
);

alter table public.favour_transactions enable row level security;

revoke all
on table public.favour_transactions
from anon, authenticated;

comment on table public.favour_transactions is
'Server-managed audit ledger for future Favour purchases and adjustments. No browser-client access.';

comment on column public.player_accounts.favour is
'Server-authoritative premium currency balance. Client is read-only.';

-- Intentionally no INSERT/UPDATE/DELETE policies for authenticated on
-- player_accounts, and no policies at all on favour_transactions: the game
-- client must never be able to change its own or another player's Favour.
