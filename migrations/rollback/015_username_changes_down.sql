-- Rollback for 015_username_changes.sql.
--
-- Undoes the ABILITY to rename and everything that supported it, and puts the
-- new-user trigger back the way 001 had it.
--
-- WHAT THIS DELIBERATELY DOES NOT UNDO: any username a player actually chose
-- while 015 was live. Those are their names now — they are printed on
-- scoreboards and known to the people they play with — and reverting a schema
-- is no reason to take one away. The columns that recorded WHEN a rename
-- happened are dropped, so re-applying 015 leaves everyone with a clear
-- cooldown, which is the forgiving direction.
--
-- ONE THING TO CHECK FIRST. 015 widened the character set to include dashes.
-- Rolling back narrows it again, and the constraint below will fail to be
-- created if any account has taken a name with a dash in it. That failure is
-- the safe outcome — it refuses rather than quietly leaving the table in a
-- state its own constraint forbids. Find them with:
--
--     select user_id, username from public.player_accounts
--      where username::text ~ '-';
--
-- and rename them (or keep 015) before running this.

begin;

-- The rename path itself.
drop function if exists public.change_username(uuid, text);

-- Restore 001's new-user trigger verbatim, including its stricter fallback.
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

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

-- Validation and its inputs. Dropped after change_username and the trigger,
-- both of which call username_rejection.
drop function if exists public.username_rejection(text);
drop function if exists public.fold_username(text);
drop table if exists public.username_blocklist;
drop table if exists public.username_config;

-- Rename bookkeeping.
alter table public.player_accounts
    drop column if exists username_change_count;

alter table public.player_accounts
    drop column if exists username_changed_at;

-- Character set, back to 001's. Fails loudly if a dashed name exists — see
-- the note at the top.
alter table public.player_accounts
    drop constraint if exists player_accounts_username_format;

alter table public.player_accounts
    add constraint player_accounts_username_format
    check (username::text ~ '^[A-Za-z0-9_]{3,24}$');

commit;
