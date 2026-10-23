-- 558: lock the three one-off credit bookkeeping tables to the server.
--
-- 289 (credit_redenomination_state, credit_redenomination_snapshot) and 295
-- (free_grant_backfill_295) created bookkeeping tables for one-time balance
-- operations: the x10 credit scale's applied-marker and pre-scale balances,
-- and the 1,500 free-grant backfill's before/added amounts. They were created
-- without row level security, and Supabase grants every role on a new public
-- table, so anyone holding the public (anon) key could read profile ids with
-- their old balances and insert or change rows (Supabase advisor:
-- rls_disabled_in_public).
--
-- Only migrations and the reverse script read them, and those run as
-- postgres / service_role, which bypass RLS. So: RLS on with no policy, every
-- grant to anon and authenticated taken away — the same shape as 554's
-- server-only table. No row is touched; GRANT + DISABLE ROW LEVEL SECURITY
-- would undo it.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'public.credit_redenomination_state',
    'public.credit_redenomination_snapshot',
    'public.free_grant_backfill_295'
  ] LOOP
    -- The reverse script may have dropped a table; there is then nothing to lock.
    IF to_regclass(t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE %s TO service_role', t);
  END LOOP;
END
$$;
