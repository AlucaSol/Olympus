-- ===========================================================================
-- TRIARCHS OF OLYMPUS — username rules, server-side verification
--
-- Proves what the browser tests cannot: that migration 015's rules hold in the
-- database, where they are actually enforced. tests/username.mjs checks the
-- SAME rules in the browser mirror, and the two are meant to agree — if one of
-- these files passes and the other fails on the same input, the mirror has
-- drifted and the browser copy is the one that is wrong.
--
-- HOW TO RUN
--   Paste the whole file into the Supabase SQL Editor and press Run, or:
--       psql "$DATABASE_URL" -f tests/sql/username.sql
--
-- WHAT A PASS LOOKS LIKE. A table of 19 rows, one per check, ending with the
-- signup-gate check. A FAILURE is an error naming the assertion that broke,
-- and no table at all.
--
--   Do not accept "Success. No rows returned" as a pass. The SQL Editor does
--   not display RAISE NOTICE, so an earlier version of this file reported
--   exactly that on success — which is also what a file that tested nothing
--   would report. The checks are recorded in a temp table and selected at the
--   end for that reason. The first row also confirms plpgsql.check_asserts is
--   on, without which every ASSERT here would be a silent no-op.
--
-- SAFE TO RUN ON A LIVE PROJECT. Everything happens inside one transaction
-- that ends in ROLLBACK. The test accounts, the config changes and every
-- rename made below disappear. A failed assertion aborts, which also rolls
-- back. No real account is read, written or renamed.
-- ===========================================================================

begin;

set local client_min_messages = notice;

-- The Supabase SQL Editor shows RESULT ROWS but not RAISE NOTICE output, so a
-- run that reports only "Success. No rows returned" tells you nothing about
-- which checks actually happened. Every OK below is therefore recorded here
-- and selected out at the end, where the editor will show it as a table.
create temp table _steps (n serial primary key, step text);

do $$
declare
    v_user_a  uuid := '00000000-0000-4000-8000-0000000000a1';
    v_user_b  uuid := '00000000-0000-4000-8000-0000000000b1';
    v_result  jsonb;
    v_name    text;
    v_live    boolean := false;
begin
    -- ---- before anything: are assertions even switched on? ----
    -- With plpgsql.check_asserts off, every ASSERT in this file is a no-op and
    -- the whole run passes without testing a thing — indistinguishable from a
    -- real pass. Prove the mechanism works before trusting it, using a RAISE
    -- rather than an ASSERT to report the bad case, since an assert could not
    -- report its own absence.
    --
    -- The handler names assert_failure explicitly, and must: WHEN OTHERS does
    -- not trap assert_failure or query_canceled. Catching this with WHEN OTHERS
    -- lets the probe's own deliberate failure escape and abort the file.
    begin
        assert false, 'probe';
    exception when assert_failure then
        v_live := true;
    end;
    if not v_live then
        raise exception
            'plpgsql.check_asserts is OFF — every ASSERT in this file is a no-op '
            'and this run proves nothing. Enable it with: '
            'set plpgsql.check_asserts = on;';
    end if;
    insert into _steps (step) values ('OK  assertions are enabled (this run is meaningful)');

    -- Two accounts to rename and collide against.
    --
    -- email_confirmed_at is set on every auth.users insert in this file, and it
    -- is not decoration: 013's claim enforcement lives inside
    -- handle_new_auth_user() and refuses any account carrying neither a valid
    -- begin_signup claim nor a confirmed email. Confirmed-at-creation is the
    -- dashboard / Admin API path, which is always allowed. Drop it and every
    -- insert below fails with `signup_not_authorised`.
    insert into auth.users (id, email, email_confirmed_at, instance_id, aud, role, created_at, updated_at)
    values (v_user_a, 'username-test-a@example.invalid', now(),
            '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
           (v_user_b, 'username-test-b@example.invalid', now(),
            '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now())
    on conflict (id) do nothing;

    -- The trigger will have created these from the email prefix. Force them to
    -- known values so the assertions below do not depend on that.
    update public.player_accounts set username = 'TesterAlpha', username_changed_at = null
     where user_id = v_user_a;
    update public.player_accounts set username = 'TesterBeta', username_changed_at = null
     where user_id = v_user_b;

    -- =======================================================================
    -- 1. folding
    -- =======================================================================

    assert public.fold_username('f_u_c_k') = 'fuck',
        'separators should be dropped by folding';
    assert public.fold_username('n1gg3r') = 'nigger',
        'digit homoglyphs should resolve to letters';
    assert public.fold_username('JoNNy') = public.fold_username('jonny'),
        'folding should be case-insensitive';
    assert public.fold_username('gook') = 'gook',
        'folding must NOT collapse repeated letters';
    insert into _steps (step) values ('OK  folding resolves separators, homoglyphs and case');

    -- =======================================================================
    -- 2. shape
    -- =======================================================================

    assert public.username_rejection('abcd') = 'too_short',
        '4 characters should be too short';
    assert public.username_rejection('abcde') is null,
        '5 characters should be accepted';
    assert public.username_rejection(repeat('a', 20)) is null,
        '20 characters should be accepted';
    assert public.username_rejection(repeat('a', 21)) = 'too_long',
        '21 characters should be too long';
    assert public.username_rejection('has space') = 'invalid_characters',
        'spaces should be refused';
    assert public.username_rejection('dots.here') = 'invalid_characters',
        'full stops should be refused';
    assert public.username_rejection('_____') = 'invalid_characters',
        'a name with no letters or digits should be refused';
    assert public.username_rejection('Jonny_Bravo-99') is null,
        'letters, digits, underscores and dashes should all be accepted';
    insert into _steps (step) values ('OK  length and character set match the agreed 5-20 rule');

    -- =======================================================================
    -- 3. the screen, and the evasions
    -- =======================================================================

    assert public.username_rejection('fuckface') = 'not_allowed',
        'plain profanity should be refused';
    assert public.username_rejection('f_u_c_k_e_r') = 'not_allowed',
        'separators should not defeat the screen';
    assert public.username_rejection('fuuuuck') = 'not_allowed',
        'padded letters should not defeat the screen';
    assert public.username_rejection('Sh1thead') = 'not_allowed',
        'leetspeak should not defeat the screen';
    assert public.username_rejection('xxHitlerxx') = 'not_allowed',
        'padding either side should not defeat the screen';
    assert public.username_rejection('admin') = 'not_allowed',
        'reserved names should be refused';
    insert into _steps (step) values ('OK  the screen sees through separators, padding and leetspeak');

    -- The half that matters just as much: names it must NOT eat.
    assert public.username_rejection('Cassandra') is null, 'Cassandra must be allowed';
    assert public.username_rejection('Cockatrice') is null, 'Cockatrice must be allowed';
    assert public.username_rejection('Analyst') is null, 'Analyst must be allowed';
    assert public.username_rejection('Adminius') is null, 'Adminius must be allowed';
    assert public.username_rejection('Scunthorpe') is null, 'Scunthorpe must be allowed';
    assert public.username_rejection('Cockburn') is null, 'Cockburn must be allowed';
    assert public.username_rejection('Torpedo') is null, 'Torpedo must be allowed';
    assert public.username_rejection('Penelope') is null, 'Penelope must be allowed';
    insert into _steps (step) values ('OK  innocent names survive the screen');

    -- The allow-list exempts a whole name, never a fragment of one.
    assert public.username_rejection('Scunthorpefuck') = 'not_allowed',
        'the allow-list must not act as a prefix pass';
    assert public.username_rejection('xxScunthorpexx') = 'not_allowed',
        'the allow-list must not act as a substring pass';
    insert into _steps (step) values ('OK  the allow-list cannot be used as a shield');

    -- =======================================================================
    -- 4. renaming
    -- =======================================================================

    v_result := public.change_username(v_user_a, 'Heraklion');
    assert (v_result->>'ok')::boolean, format('a valid rename was refused: %s', v_result);
    select username::text into v_name from public.player_accounts where user_id = v_user_a;
    assert v_name = 'Heraklion', format('the name was not stored: %s', v_name);
    insert into _steps (step) values ('OK  a valid rename is applied');

    -- The cooldown starts immediately, and is enforced HERE, not only in the
    -- browser. This is the check that clearing site data cannot get past.
    v_result := public.change_username(v_user_a, 'Knossos');
    assert v_result->>'error' = 'cooldown',
        format('a second rename inside 24h should have been refused: %s', v_result);
    assert v_result ? 'cooldown_until',
        'a cooldown refusal should say when the account is free again';
    insert into _steps (step) values ('OK  the 24-hour cooldown is enforced server-side');

    -- Serve out the cooldown and carry on.
    update public.player_accounts
       set username_changed_at = timezone('utc', now()) - interval '25 hours'
     where user_id = v_user_a;

    -- =======================================================================
    -- 5. uniqueness, including the case-insensitive half
    -- =======================================================================

    v_result := public.change_username(v_user_b, 'Heraklion');
    assert v_result->>'error' = 'taken',
        format('an exact duplicate should be refused: %s', v_result);

    -- The requirement from the brief: same letters, different capitals, is the
    -- same name. citext's unique index is what decides this.
    v_result := public.change_username(v_user_b, 'HERAKLION');
    assert v_result->>'error' = 'taken',
        format('an all-caps duplicate should be refused: %s', v_result);
    v_result := public.change_username(v_user_b, 'hErAkLiOn');
    assert v_result->>'error' = 'taken',
        format('a mixed-case duplicate should be refused: %s', v_result);
    insert into _steps (step) values ('OK  uniqueness is case-insensitive');

    -- Capitals ARE preserved for display, which is the other half of it.
    select username::text into v_name from public.player_accounts where user_id = v_user_a;
    assert v_name = 'Heraklion', format('capitalisation was not preserved: %s', v_name);
    insert into _steps (step) values ('OK  capitalisation is stored and displayed as typed');

    -- Recasing your OWN name is a real change and must not read as taken.
    v_result := public.change_username(v_user_a, 'HeraklioN');
    assert (v_result->>'ok')::boolean,
        format('recasing your own name should be allowed: %s', v_result);
    update public.player_accounts
       set username_changed_at = timezone('utc', now()) - interval '25 hours'
     where user_id = v_user_a;

    -- An identical submission is not a change and must not spend the cooldown.
    v_result := public.change_username(v_user_a, 'HeraklioN');
    assert v_result->>'error' = 'unchanged',
        format('an identical name should be reported as unchanged: %s', v_result);
    select username_changed_at into v_name from public.player_accounts where user_id = v_user_a;
    insert into _steps (step) values ('OK  an unchanged name costs nothing');

    -- =======================================================================
    -- 6. refusals do not spend the cooldown
    -- =======================================================================

    v_result := public.change_username(v_user_a, 'fuckface');
    assert v_result->>'error' = 'not_allowed', 'a blocked name should be refused';
    v_result := public.change_username(v_user_a, 'Kallisto');
    assert (v_result->>'ok')::boolean,
        format('a refusal must not have started the cooldown: %s', v_result);
    insert into _steps (step) values ('OK  a refused rename leaves the cooldown untouched');

    -- =======================================================================
    -- 7. the kill switch
    -- =======================================================================

    update public.player_accounts
       set username_changed_at = null where user_id = v_user_b;
    update public.username_config set changes_enabled = false where id;

    v_result := public.change_username(v_user_b, 'Lysandros');
    assert v_result->>'error' = 'changes_disabled',
        format('the kill switch should stop renames: %s', v_result);

    -- The switch stops RENAMES and nothing else: existing names stay, and the
    -- email-prefix default keeps working. That is the point of it.
    select username::text into v_name from public.player_accounts where user_id = v_user_b;
    assert v_name = 'TesterBeta', 'the kill switch must not disturb existing names';
    insert into _steps (step) values ('OK  the kill switch stops renames and nothing else');

    update public.username_config set changes_enabled = true where id;

    -- =======================================================================
    -- 8. the email-prefix default
    -- =======================================================================

    -- The case that was BROKEN before 015: a dot in the local part. 001 would
    -- have raised and failed the signup outright.
    insert into auth.users (id, email, email_confirmed_at, instance_id, aud, role, created_at, updated_at)
    values ('00000000-0000-4000-8000-0000000000c1',
            'jon.bennett@example.invalid', now(),
            '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
    select username::text into v_name from public.player_accounts
     where user_id = '00000000-0000-4000-8000-0000000000c1';
    assert v_name = 'jonbennett',
        format('a dotted email prefix should be sanitised, got %s', v_name);
    insert into _steps (step) values ('OK  a dotted email address no longer breaks signup');

    -- Over-long prefixes are trimmed to the cap rather than refused.
    insert into auth.users (id, email, email_confirmed_at, instance_id, aud, role, created_at, updated_at)
    values ('00000000-0000-4000-8000-0000000000c2',
            'averyveryverylongemailaddress@example.invalid', now(),
            '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
    select username::text into v_name from public.player_accounts
     where user_id = '00000000-0000-4000-8000-0000000000c2';
    assert length(v_name) <= 20, format('a long prefix was not trimmed: %s', v_name);
    insert into _steps (step) values ('OK  a long email prefix is trimmed to the cap');

    -- A prefix too short to be a legal name falls back rather than failing.
    insert into auth.users (id, email, email_confirmed_at, instance_id, aud, role, created_at, updated_at)
    values ('00000000-0000-4000-8000-0000000000c3',
            'jb@example.invalid', now(),
            '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
    select username::text into v_name from public.player_accounts
     where user_id = '00000000-0000-4000-8000-0000000000c3';
    assert public.username_rejection(v_name) is null,
        format('the fallback produced an illegal name: %s', v_name);
    insert into _steps (step) values ('OK  a too-short email prefix falls back to a legal name');

    -- Two accounts whose prefixes collide must both get a name.
    insert into auth.users (id, email, email_confirmed_at, instance_id, aud, role, created_at, updated_at)
    values ('00000000-0000-4000-8000-0000000000c4',
            'jon.bennett@other.invalid', now(),
            '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
    select username::text into v_name from public.player_accounts
     where user_id = '00000000-0000-4000-8000-0000000000c4';
    assert v_name <> 'jonbennett' and length(v_name) > 0,
        format('a colliding prefix was not disambiguated: %s', v_name);
    insert into _steps (step) values ('OK  colliding email prefixes are disambiguated');

    -- =======================================================================
    -- 9. the browser cannot do any of this itself
    -- =======================================================================

    -- These mirror tests/sql/rls.sql: player_accounts has SELECT for the owner
    -- and nothing else, so a rename cannot be done against PostgREST. The
    -- absence of an UPDATE policy is the control; assert it is still absent.
    assert not exists (
        select 1 from pg_policies
         where schemaname = 'public' and tablename = 'player_accounts'
           and cmd in ('UPDATE', 'ALL')
    ), 'player_accounts has gained an UPDATE policy — the browser can now rename directly';
    insert into _steps (step) values ('OK  the browser still has no direct write path to a username');

    -- =======================================================================
    -- 10. the signup gate survived this migration
    -- =======================================================================

    -- THE REGRESSION THIS CATCHES. 013 put the claim enforcement inside
    -- handle_new_auth_user(), and 015 needed to change the username half of
    -- that same function. `create or replace` replaces rather than merges, so
    -- the first cut of 015 deleted the gate — no error at apply time, and no
    -- symptom until somebody registered without going through the website.
    -- 016 restored it. This asserts it is still there, because the next person
    -- to touch this function will hit the same trap.
    declare
        v_was    boolean;
        v_leaked boolean := false;
    begin
        select require_signup_claim into v_was from public.signup_config where id;
        update public.signup_config set require_signup_claim = true where id;

        -- The verdict is carried out on a flag rather than asserted inside the
        -- block: an ASSERT in the try half would raise assert_failure, which
        -- WHEN OTHERS does not trap, so it would escape past the handler and
        -- restore of require_signup_claim below. Correct outcome, wrong route,
        -- and it would leave the config changed if this ever ran outside a
        -- transaction that rolls back.
        begin
            -- No claim, and NOT confirmed at creation: the one combination the
            -- gate exists to refuse.
            insert into auth.users (id, email, instance_id, aud, role,
                                    created_at, updated_at)
            values ('00000000-0000-4000-8000-0000000000d1',
                    'ungated@example.invalid',
                    '00000000-0000-0000-0000-000000000000',
                    'authenticated', 'authenticated', now(), now());
            v_leaked := true;
        exception when others then
            assert sqlerrm like '%signup_not_authorised%',
                format('expected signup_not_authorised, got: %s', sqlerrm);
        end;

        assert not v_leaked,
            'THE SIGNUP GATE IS GONE — an unclaimed account was created. '
            'handle_new_auth_user() has lost 013''s enforcement; see migration 016.';

        update public.signup_config set require_signup_claim = v_was where id;
        insert into _steps (step) values ('OK  015/016 did not disturb the signup claim enforcement');
    end;

end;
$$;

-- ===========================================================================
-- The report. This is the only output the SQL Editor will show, and it is the
-- point: "Success. No rows returned" is indistinguishable from a run that
-- tested nothing, whereas a table of nineteen OK lines is not. If a check had
-- failed, the DO block above would have aborted and you would be reading an
-- error instead of this.
-- ===========================================================================
select step as "username checks — all passed" from _steps order by n;

-- ===========================================================================
-- Nothing above is kept: the accounts, the renames, the config changes and
-- this temp table all disappear here.
-- ===========================================================================
rollback;
