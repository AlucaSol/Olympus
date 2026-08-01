-- ===========================================================================
-- TRIARCHS OF OLYMPUS — Row Level Security review
--
-- Answers one question for every table this work touches: what can an ordinary
-- browser client actually do with it?
--
-- Run in the Supabase SQL Editor. READ ONLY — it changes nothing.
--
-- WHAT YOU SHOULD SEE
--   * player_accounts       anon: nothing.  authenticated: SELECT own row only.
--   * shop_items            anon: nothing.  authenticated: SELECT active rows.
--   * player_purchases      anon: nothing.  authenticated: SELECT own rows.
--   * favour_transactions   anon: nothing.  authenticated: nothing.
--   * favour_bundles        both: SELECT the public columns of active rows;
--                                 stripe_price_id NOT among them.
--   * favour_purchases      anon: nothing.  authenticated: SELECT own rows,
--                                 minus the customer id and checkout URL.
--   * stripe_events         both: nothing.
--   * signup_*              both: nothing.
--   * shop_purchase_requests both: nothing.
--
-- Anything else is a finding.
-- ===========================================================================

\echo '=== 1. Table privileges granted to the browser roles ==='

select
    c.relname                                   as table_name,
    g.grantee,
    string_agg(distinct g.privilege_type, ', ' order by g.privilege_type) as privileges
from information_schema.role_table_grants g
join pg_class c on c.relname = g.table_name
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where g.table_schema = 'public'
  and g.grantee in ('anon', 'authenticated')
  and c.relname in (
    'player_accounts', 'favour_transactions', 'shop_items', 'player_purchases',
    'favour_bundles', 'favour_purchases', 'stripe_events',
    'signup_config', 'signup_invites', 'signup_ip_quota',
    'signup_attempt_log', 'signup_claims', 'shop_purchase_requests'
  )
group by c.relname, g.grantee
order by c.relname, g.grantee;


\echo ''
\echo '=== 2. Column-level grants (this is what hides stripe_price_id) ==='

select
    table_name,
    grantee,
    string_agg(column_name, ', ' order by column_name) as readable_columns
from information_schema.column_privileges
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and privilege_type = 'SELECT'
  and table_name in ('favour_bundles', 'favour_purchases')
group by table_name, grantee
order by table_name, grantee;

\echo ''
\echo '--> favour_bundles must NOT list stripe_price_id.'
\echo '--> favour_purchases must NOT list stripe_customer_id or stripe_checkout_url.'


\echo ''
\echo '=== 3. RLS is enabled on every table involved ==='

select
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'player_accounts', 'favour_transactions', 'shop_items', 'player_purchases',
    'favour_bundles', 'favour_purchases', 'stripe_events',
    'signup_config', 'signup_invites', 'signup_ip_quota',
    'signup_attempt_log', 'signup_claims', 'shop_purchase_requests'
  )
order by c.relname;

\echo ''
\echo '--> rls_enabled must be true for every row above.'


\echo ''
\echo '=== 4. Every policy, and what it permits ==='

select
    tablename,
    policyname,
    cmd            as command,
    roles,
    qual           as using_expression,
    with_check     as with_check_expression
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

\echo ''
\echo '--> There must be NO policy with cmd = INSERT, UPDATE, DELETE or ALL'
\echo '    for anon/authenticated on player_accounts, player_purchases,'
\echo '    favour_bundles, favour_purchases or favour_transactions.'
\echo '    A player may read; only server-side functions may write.'


\echo ''
\echo '=== 5. Any write policy for the browser roles (should be empty) ==='

select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  and (roles::text[] && array['anon', 'authenticated'])
order by tablename;

\echo ''
\echo '--> Zero rows expected.'


\echo ''
\echo '=== 6. Security-definer functions: search_path must be pinned ==='

select
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments,
    p.prosecdef as security_definer,
    coalesce(
        (select s from unnest(p.proconfig) s where s like 'search_path=%'),
        '*** NOT SET ***'
    ) as search_path_setting
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
order by p.proname;

\echo ''
\echo '--> Every row must show search_path="" . An unpinned search_path on a'
\echo '    SECURITY DEFINER function is a privilege-escalation route.'


\echo ''
\echo '=== 7. Who may EXECUTE the privileged functions ==='

select
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments,
    coalesce(
        (select string_agg(distinct a.grantee_name, ', ' order by a.grantee_name)
         from (
             select pg_get_userbyid((aclexplode(p.proacl)).grantee) as grantee_name
         ) a
         where a.grantee_name in ('anon', 'authenticated', 'public')),
        '(none — service_role only)'
    ) as browser_reachable_by
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'begin_signup', 'complete_signup', 'abort_signup', 'expire_signup_claims',
    'purge_signup_records', 'set_signup_mode', 'set_maximum_accounts',
    'create_signup_invite', 'signup_status', 'signup_availability',
    'log_signup_attempt',
    'begin_favour_checkout', 'attach_checkout_session', 'fulfil_favour_purchase',
    'record_stripe_event', 'close_favour_purchase', 'record_favour_refund',
    'favour_purchases_needing_review',
    'grant_favour', 'purchase_shop_item', 'purge_shop_purchase_requests',
    'handle_new_auth_user', 'sync_lifetime_favour'
  )
order by p.proname, arguments;

\echo ''
\echo '--> ONLY purchase_shop_item (both signatures) may list `authenticated`.'
\echo '    Everything else must read "(none — service_role only)".'
\echo '    In particular grant_favour, begin_signup, fulfil_favour_purchase,'
\echo '    set_signup_mode and set_maximum_accounts must NOT be reachable.'


\echo ''
\echo '=== 8. The constraints that make the money safe ==='

select
    conrelid::regclass::text as table_name,
    conname                  as constraint_name,
    pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid::regclass::text in (
    'player_accounts', 'player_purchases', 'favour_transactions',
    'favour_bundles', 'favour_purchases', 'shop_purchase_requests',
    'signup_invites'
  )
  and contype in ('c', 'u', 'p')
order by table_name, constraint_name;

\echo ''
\echo '--> Expect at least:'
\echo '    player_accounts        favour >= 0'
\echo '    player_purchases       unique (user_id, item_id)'
\echo '    favour_transactions    unique (external_reference)'
\echo '    favour_purchases       unique (stripe_checkout_session_id)'
\echo '    favour_purchases       unique (user_id, client_request_id)'
\echo '    shop_purchase_requests unique (user_id, request_id)'
\echo '    signup_invites         used_count <= max_uses'
