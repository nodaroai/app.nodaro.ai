-- ============================================================================
-- Behavioral proof: migration 382 — the per-user deployment allowance ledger
-- and the three RPC redefinitions that enforce it.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000981 upward), so it can never
-- collide with a sibling proof (WS1a's payer-row proof took 971-973, the
-- orgs-usage proof 931-938).
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/deployment-allowance.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/t.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
--
-- ============================================================================
-- WHAT THIS PROOF PINS, AND WHY EACH CASE EXISTS
-- ============================================================================
-- The allowance is a QUOTA against the payer's pool, never money: Nodaro's real
-- ceiling is still the payer's `profiles` credits, which `reserve_credits` has
-- always enforced atomically. So every case below is really one of two
-- questions — "does the quota move by exactly the right amount?" and "did the
-- payer's real money move exactly as it does today?".
--
--   1-2  exhaustion is exact, and a refusal debits the payer NOTHING (the
--        RAISE aborts the whole function, allowance block and personal body
--        alike — that is the point of putting the block INSIDE the RPC).
--   3-5  refund releases, commit settles, and a metered overrun beyond the
--        user's headroom is ABSORBED by 351's clamp instead of violating
--        `CHECK (reserved + spent <= granted)`. Case 5 is the one that would
--        otherwise strand the payer's debit in `reserved` forever.
--   6-7  the TWO SWITCHES (D3) and the flip hazard (D4). Rollout step 3 turns
--        on attribution while enforcement is still off; case 6 proves that
--        window touches no allowance table at all, and case 7 proves a job
--        reserved in that window still settles against nothing after the
--        step-8 flip — because commit branches on the flag STAMPED AT RESERVE
--        TIME, not on `on_behalf_of IS NOT NULL`.
--   8-9  the payer's own runs are exempt (D13), and a mainline 10-argument
--        call is unchanged: `on_behalf_of` NULL and — the part a JSONB column
--        can actually be checked for — NO `payer` key at all, not a null one.
--   9b   a zero-credit call is rejected BEFORE it can lazily provision a row.
--   10   `grant_deployment_allowance` refuses a non-payer actor, refuses the
--        kinds that would break the Σ-grants invariant, and REFUSES rather
--        than clamps a correction that would invalidate a running job.
--   11   `ALLOWANCE_UNCONFIGURED` in both of its shapes.
--   12   structure: one function per name (351's stale-6-arg lesson), RLS,
--        the table-level revoke before the column grant (the 347 lesson), and
--        the Σ-grants reconciliation over every row this file created.
--
-- ============================================================================
-- CONCURRENCY: WHAT THIS FILE CANNOT PROVE, AND WHERE THE CLAIM RESTS
-- ============================================================================
-- Every behavioral proof in `supabase/tests/` runs as ONE psql session inside
-- ONE transaction (checked before this file was written: no `dblink`, no
-- `pg_background`, no `\connect` anywhere in the directory). A genuine
-- two-session race therefore cannot be expressed here, and a case that LOOKED
-- like one would silently be two sequential statements on the same connection
-- — which proves nothing about a lock.
--
-- So case 2 is the SEQUENTIAL proof (the headroom is consumed to the credit and
-- the first call past it raises), and the concurrency claim rests on the lock:
-- assertions 12j-12m assert, TEXTUALLY, that reserve/commit/refund each take
-- `FOR UPDATE` on the allowance row before reading it, and that reserve takes
-- it BEFORE the `profiles` lock (the allowance -> profiles order, D8; two
-- callers taking the same two locks in opposite orders is a deadlock that only
-- appears under load).
--
-- The repo's only multi-connection harness is
-- `backend/scripts/orgs-billing-concurrency.mjs` (50 simultaneous reserves
-- against a workspace budget, run by the `migration-behavior` CI job after the
-- proofs). An allowance sibling of that script is the right shape for a real
-- race proof and is named here as the follow-up; it is not this file.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, actual text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual, '<null>'), coalesce(expected, '<null>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- The refusal helper. `stmt` runs inside a subtransaction, so when it raises,
-- everything it did rolls back — which is exactly the property cases 1, 2 and
-- 9b assert about the payer's money.
CREATE FUNCTION pg_temp.assert_raises(label text, stmt text, prefix text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF position(prefix in SQLERRM) = 1 THEN
      RAISE NOTICE 'ok  %', label;
      RETURN;
    END IF;
    RAISE EXCEPTION 'ASSERT FAIL [%]: raised "%" but expected the prefix "%"', label, SQLERRM, prefix;
  END;
  RAISE EXCEPTION 'ASSERT FAIL [%]: expected a refusal with the prefix "%" and none was raised', label, prefix;
END $$;

-- Readers, so an assertion line says what it means.
CREATE FUNCTION pg_temp.a_col(p_user uuid, p_col text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SELECT %I::text FROM deployment_user_allowances WHERE user_id = $1', p_col)
    INTO v USING p_user;
  RETURN coalesce(v, '<no row>');
END $$;

CREATE FUNCTION pg_temp.payer_credits() RETURNS integer
LANGUAGE sql AS $$
  SELECT subscription_credits FROM profiles WHERE id = '00000000-0000-4000-8000-000000000981';
$$;

CREATE TEMP TABLE snap (k text PRIMARY KEY, v integer);
CREATE FUNCTION pg_temp.snap(p_k text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO snap (k, v) VALUES (p_k, pg_temp.payer_credits())
  ON CONFLICT (k) DO UPDATE SET v = excluded.v;
$$;
CREATE FUNCTION pg_temp.payer_delta(p_k text) RETURNS integer
LANGUAGE sql AS $$
  SELECT (SELECT v FROM snap WHERE k = p_k) - pg_temp.payer_credits();
$$;

-- ---------------------------------------------------------------------------
-- Fixtures. 981 is the PAYER (it holds the real Nodaro credits and is the
-- `p_user_id` of every deployment-lane reserve). 982-989 are requesters.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000981', 'da-payer@da.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000982', 'da-u1@da.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000983', 'da-u2@da.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000984', 'da-u3@da.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000985', 'da-u4@da.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000986', 'da-u5@da.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000987', 'da-u6@da.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000988', 'da-u7@da.test',     '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000989', 'da-u8@da.test',     '{}', 'authenticated', 'authenticated');

UPDATE profiles SET subscription_credits = 1000000, topup_credits = 0, daily_spent_credits = 0
WHERE id = '00000000-0000-4000-8000-000000000981';

-- The settings row the boot upsert writes (381). `default_allowance_credits`
-- is in RAW Nodaro credits, never display units.
INSERT INTO deployment_payer_settings (id, payer_user_id, default_allowance_credits)
VALUES (true, '00000000-0000-4000-8000-000000000981', 100);

-- ---------------------------------------------------------------------------
-- 1. A first enforced reserve provisions lazily and debits `reserved`; a second
--    past the headroom raises, and the payer is debited EXACTLY ONCE.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('1a no allowance row exists before the first enforced reserve',
  pg_temp.a_col('00000000-0000-4000-8000-000000000982', 'granted_credits'), '<no row>');

SELECT pg_temp.snap('c1');
SELECT reserve_credits(
  p_user_id := '00000000-0000-4000-8000-000000000981',
  p_credits := 60,
  p_job_id := NULL,
  p_on_behalf_of := '00000000-0000-4000-8000-000000000982',
  p_enforce_allowance := TRUE);

SELECT pg_temp.assert_eq('1b the row was provisioned at the settings default (100)',
  pg_temp.a_col('00000000-0000-4000-8000-000000000982', 'granted_credits'), '100');
SELECT pg_temp.assert_eq('1c reserved moved by exactly the reserve',
  pg_temp.a_col('00000000-0000-4000-8000-000000000982', 'reserved_credits'), '60');
SELECT pg_temp.assert_eq('1d spent is untouched by a reserve',
  pg_temp.a_col('00000000-0000-4000-8000-000000000982', 'spent_credits'), '0');
SELECT pg_temp.assert_eq('1e exactly one grant row, kind default, credits 100',
  (SELECT count(*)::text FROM deployment_allowance_grants
    WHERE user_id = '00000000-0000-4000-8000-000000000982' AND kind = 'default' AND credits = 100), '1');
SELECT pg_temp.assert_eq('1f the default grant is attributed to the payer',
  (SELECT granted_by::text FROM deployment_allowance_grants
    WHERE user_id = '00000000-0000-4000-8000-000000000982' AND kind = 'default'),
  '00000000-0000-4000-8000-000000000981');
SELECT pg_temp.assert_eq('1g the payer paid the real credits (60)',
  pg_temp.payer_delta('c1')::text, '60');
SELECT pg_temp.assert_eq('1h the usage log is the payer''s, attributed to the requester',
  (SELECT on_behalf_of::text FROM usage_logs
    WHERE user_id = '00000000-0000-4000-8000-000000000981' AND credits_used = 60 AND status = 'reserved'),
  '00000000-0000-4000-8000-000000000982');
SELECT pg_temp.assert_eq('1i the reserve stamped allowance_enforced = true',
  (SELECT (metadata->'payer'->>'allowance_enforced') FROM usage_logs
    WHERE user_id = '00000000-0000-4000-8000-000000000981' AND credits_used = 60 AND status = 'reserved'),
  'true');

SELECT pg_temp.snap('c1b');
SELECT pg_temp.assert_raises('1j a second reserve past the headroom is refused',
  $q$SELECT reserve_credits(
       p_user_id := '00000000-0000-4000-8000-000000000981', p_credits := 60, p_job_id := NULL,
       p_on_behalf_of := '00000000-0000-4000-8000-000000000982', p_enforce_allowance := TRUE)$q$,
  'USER_ALLOWANCE_EXCEEDED:');
SELECT pg_temp.assert_eq('1k the refusal debited the payer NOTHING',
  pg_temp.payer_delta('c1b')::text, '0');
SELECT pg_temp.assert_eq('1l the refusal left reserved where it was',
  pg_temp.a_col('00000000-0000-4000-8000-000000000982', 'reserved_credits'), '60');
SELECT pg_temp.assert_eq('1m the refusal wrote no usage log',
  (SELECT count(*)::text FROM usage_logs
    WHERE on_behalf_of = '00000000-0000-4000-8000-000000000982'), '1');

-- ---------------------------------------------------------------------------
-- 2. Exhaustion is exact to the credit (sequential — see the header note).
-- ---------------------------------------------------------------------------
SELECT reserve_credits(
  p_user_id := '00000000-0000-4000-8000-000000000981', p_credits := 40, p_job_id := NULL,
  p_on_behalf_of := '00000000-0000-4000-8000-000000000982', p_enforce_allowance := TRUE);
SELECT pg_temp.assert_eq('2a the headroom is consumed to the credit (60 + 40 = 100)',
  pg_temp.a_col('00000000-0000-4000-8000-000000000982', 'reserved_credits'), '100');
SELECT pg_temp.snap('c2');
SELECT pg_temp.assert_raises('2b one credit past exhaustion is refused',
  $q$SELECT reserve_credits(
       p_user_id := '00000000-0000-4000-8000-000000000981', p_credits := 1, p_job_id := NULL,
       p_on_behalf_of := '00000000-0000-4000-8000-000000000982', p_enforce_allowance := TRUE)$q$,
  'USER_ALLOWANCE_EXCEEDED:');
SELECT pg_temp.assert_eq('2c and that refusal debited the payer nothing either',
  pg_temp.payer_delta('c2')::text, '0');
SELECT pg_temp.assert_eq('2d the schema CHECK held throughout (reserved + spent <= granted)',
  (SELECT (reserved_credits + spent_credits <= granted_credits)::text
     FROM deployment_user_allowances WHERE user_id = '00000000-0000-4000-8000-000000000982'), 'true');

-- ---------------------------------------------------------------------------
-- 3. Refund releases the reservation, spends nothing, and restores the payer.
-- ---------------------------------------------------------------------------
SELECT pg_temp.snap('c3');
DO $$
DECLARE v_log UUID;
BEGIN
  v_log := reserve_credits(
    p_user_id := '00000000-0000-4000-8000-000000000981', p_credits := 30, p_job_id := NULL,
    p_on_behalf_of := '00000000-0000-4000-8000-000000000983', p_enforce_allowance := TRUE);
  PERFORM pg_temp.assert_eq('3a reserved before the refund',
    pg_temp.a_col('00000000-0000-4000-8000-000000000983', 'reserved_credits'), '30');
  PERFORM refund_credits(v_log);
  PERFORM pg_temp.assert_eq('3b the refund released the reservation',
    pg_temp.a_col('00000000-0000-4000-8000-000000000983', 'reserved_credits'), '0');
  PERFORM pg_temp.assert_eq('3c the refund spent nothing',
    pg_temp.a_col('00000000-0000-4000-8000-000000000983', 'spent_credits'), '0');
  PERFORM pg_temp.assert_eq('3d the grant total is untouched by a refund',
    pg_temp.a_col('00000000-0000-4000-8000-000000000983', 'granted_credits'), '100');
  PERFORM pg_temp.assert_eq('3e the usage log is refunded',
    (SELECT status FROM usage_logs WHERE id = v_log), 'refunded');
END $$;
SELECT pg_temp.assert_eq('3f the payer''s real credits came back in full',
  pg_temp.payer_delta('c3')::text, '0');

-- ---------------------------------------------------------------------------
-- 4. Commit moves reserved -> spent by the ACTUAL and releases the surplus.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_log UUID;
BEGIN
  v_log := reserve_credits(
    p_user_id := '00000000-0000-4000-8000-000000000981', p_credits := 50, p_job_id := NULL,
    p_on_behalf_of := '00000000-0000-4000-8000-000000000984', p_enforce_allowance := TRUE);
  PERFORM commit_credits(v_log, 20);
  PERFORM pg_temp.assert_eq('4a commit released the whole reservation',
    pg_temp.a_col('00000000-0000-4000-8000-000000000984', 'reserved_credits'), '0');
  PERFORM pg_temp.assert_eq('4b commit spent the actual, not the reserve',
    pg_temp.a_col('00000000-0000-4000-8000-000000000984', 'spent_credits'), '20');
  PERFORM pg_temp.assert_eq('4c granted is untouched by a commit',
    pg_temp.a_col('00000000-0000-4000-8000-000000000984', 'granted_credits'), '100');
END $$;

-- ---------------------------------------------------------------------------
-- 5. A metered overrun beyond the headroom is ABSORBED (D2's clamp), writes an
--    `overrun` audit row, does not abort, and never violates the CHECK.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_log UUID;
BEGIN
  v_log := reserve_credits(
    p_user_id := '00000000-0000-4000-8000-000000000981', p_credits := 100, p_job_id := NULL,
    p_on_behalf_of := '00000000-0000-4000-8000-000000000985', p_enforce_allowance := TRUE);
  PERFORM commit_credits(v_log, 150);   -- metered actual 150 >> headroom 100
  PERFORM pg_temp.assert_eq('5a spend clamped to the headroom (100), not 150',
    pg_temp.a_col('00000000-0000-4000-8000-000000000985', 'spent_credits'), '100');
  PERFORM pg_temp.assert_eq('5b the reservation was released',
    pg_temp.a_col('00000000-0000-4000-8000-000000000985', 'reserved_credits'), '0');
  PERFORM pg_temp.assert_eq('5c granted did NOT move (an overrun is not a grant)',
    pg_temp.a_col('00000000-0000-4000-8000-000000000985', 'granted_credits'), '100');
  PERFORM pg_temp.assert_eq('5d the shortfall became one negative overrun audit row',
    (SELECT credits::text FROM deployment_allowance_grants
      WHERE user_id = '00000000-0000-4000-8000-000000000985' AND kind = 'overrun'), '-50');
  PERFORM pg_temp.assert_eq('5e the log still records the TRUE actual (150)',
    (SELECT credits_charged::text FROM usage_logs WHERE id = v_log), '150');
  PERFORM pg_temp.assert_eq('5f the schema CHECK held through the overrun',
    (SELECT (reserved_credits + spent_credits <= granted_credits)::text
       FROM deployment_user_allowances WHERE user_id = '00000000-0000-4000-8000-000000000985'), 'true');
END $$;

-- ---------------------------------------------------------------------------
-- 6. THE STEP-3 WINDOW. Attribution on, enforcement off: the allowance tables
--    are not touched at all, and nothing is refused.
-- ---------------------------------------------------------------------------
SELECT reserve_credits(
  p_user_id := '00000000-0000-4000-8000-000000000981', p_credits := 25, p_job_id := NULL,
  p_on_behalf_of := '00000000-0000-4000-8000-000000000986');   -- p_enforce_allowance defaults FALSE
SELECT pg_temp.assert_eq('6a attribution was written',
  (SELECT count(*)::text FROM usage_logs
    WHERE on_behalf_of = '00000000-0000-4000-8000-000000000986'), '1');
SELECT pg_temp.assert_eq('6b NO allowance row was created',
  pg_temp.a_col('00000000-0000-4000-8000-000000000986', 'granted_credits'), '<no row>');
SELECT pg_temp.assert_eq('6c NO grant row was created',
  (SELECT count(*)::text FROM deployment_allowance_grants
    WHERE user_id = '00000000-0000-4000-8000-000000000986'), '0');
SELECT pg_temp.assert_eq('6d the row is stamped allowance_enforced = false',
  (SELECT metadata->'payer'->>'allowance_enforced' FROM usage_logs
    WHERE on_behalf_of = '00000000-0000-4000-8000-000000000986'), 'false');
SELECT pg_temp.assert_eq('6e the payer object still names the payer account',
  (SELECT metadata->'payer'->>'account' FROM usage_logs
    WHERE on_behalf_of = '00000000-0000-4000-8000-000000000986'),
  '00000000-0000-4000-8000-000000000981');

-- ---------------------------------------------------------------------------
-- 7. THE FLIP HAZARD (D4). A job reserved BEFORE the flip must settle against
--    nothing after it — even though an allowance row now exists for that user.
--    This is the case that fails if commit branches on `on_behalf_of IS NOT
--    NULL` instead of on the flag stamped at reserve time.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_pre UUID; v_pre2 UUID;
BEGIN
  -- Two logs from the pre-flip window (enforcement off, no allowance row).
  v_pre := (SELECT id FROM usage_logs WHERE on_behalf_of = '00000000-0000-4000-8000-000000000986');
  v_pre2 := reserve_credits(
    p_user_id := '00000000-0000-4000-8000-000000000981', p_credits := 15, p_job_id := NULL,
    p_on_behalf_of := '00000000-0000-4000-8000-000000000986');
  -- ...then the flip: an enforced reserve provisions the row.
  PERFORM reserve_credits(
    p_user_id := '00000000-0000-4000-8000-000000000981', p_credits := 10, p_job_id := NULL,
    p_on_behalf_of := '00000000-0000-4000-8000-000000000986', p_enforce_allowance := TRUE);
  PERFORM pg_temp.assert_eq('7a after the flip the row exists and holds the enforced reserve',
    pg_temp.a_col('00000000-0000-4000-8000-000000000986', 'reserved_credits'), '10');
  -- Now settle the PRE-flip jobs. Neither may move the ledger.
  PERFORM commit_credits(v_pre, 25);
  PERFORM pg_temp.assert_eq('7b committing a pre-flip job does not spend the allowance',
    pg_temp.a_col('00000000-0000-4000-8000-000000000986', 'spent_credits'), '0');
  PERFORM pg_temp.assert_eq('7c committing a pre-flip job does not release the allowance',
    pg_temp.a_col('00000000-0000-4000-8000-000000000986', 'reserved_credits'), '10');
  PERFORM refund_credits(v_pre2);
  PERFORM pg_temp.assert_eq('7d refunding a pre-flip job does not release the allowance',
    pg_temp.a_col('00000000-0000-4000-8000-000000000986', 'reserved_credits'), '10');
  PERFORM pg_temp.assert_eq('7e and the pre-flip refund still restored the payer''s own pools',
    (SELECT status FROM usage_logs WHERE id = v_pre2), 'refunded');
END $$;

-- ---------------------------------------------------------------------------
-- 8. The payer is exempt (D13): its own runs get attribution, never a quota.
-- ---------------------------------------------------------------------------
SELECT reserve_credits(
  p_user_id := '00000000-0000-4000-8000-000000000981', p_credits := 33, p_job_id := NULL,
  p_on_behalf_of := '00000000-0000-4000-8000-000000000981', p_enforce_allowance := TRUE);
SELECT pg_temp.assert_eq('8a the payer got no allowance row',
  pg_temp.a_col('00000000-0000-4000-8000-000000000981', 'granted_credits'), '<no row>');
SELECT pg_temp.assert_eq('8b the payer''s own run is stamped allowance_enforced = false',
  (SELECT metadata->'payer'->>'allowance_enforced' FROM usage_logs
    WHERE on_behalf_of = '00000000-0000-4000-8000-000000000981'), 'false');
SELECT pg_temp.assert_eq('8c the payer''s own run is still attributed to itself',
  (SELECT count(*)::text FROM usage_logs
    WHERE on_behalf_of = '00000000-0000-4000-8000-000000000981'), '1');

-- ---------------------------------------------------------------------------
-- 9. MAINLINE IDENTITY. The 10-argument call — the only shape a deployment
--    with no `billing.payerAccount` ever makes — is unchanged. `metadata`
--    carries NO `payer` key: the key ABSENT, not present-and-null, which is
--    the only form of byte-identity a JSONB column can be checked for.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_log UUID;
BEGIN
  v_log := reserve_credits('00000000-0000-4000-8000-000000000981', 7, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE, NULL);
  PERFORM pg_temp.assert_eq('9a a mainline call writes on_behalf_of NULL',
    coalesce((SELECT on_behalf_of::text FROM usage_logs WHERE id = v_log), '<null>'), '<null>');
  PERFORM pg_temp.assert_eq('9b a mainline row has NO payer key at all',
    (SELECT (metadata ? 'payer')::text FROM usage_logs WHERE id = v_log), 'false');
  PERFORM pg_temp.assert_eq('9c the mainline metadata keys are exactly 311''s seven',
    (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys((SELECT metadata FROM usage_logs WHERE id = v_log)) k),
    'allowance_delta,display_cost,from_sub,from_topup,is_app_run,model,web_free_mode');
  PERFORM commit_credits(v_log, 7);
  PERFORM pg_temp.assert_eq('9d a mainline commit touches no allowance row',
    (SELECT count(*)::text FROM deployment_user_allowances), '5');
END $$;

-- 9e. A zero-credit call with enforcement ON is rejected BEFORE it can
--     lazily provision a row (the duplicated `p_credits <= 0` guard).
SELECT pg_temp.assert_raises('9e a zero-credit enforced call is refused',
  $q$SELECT reserve_credits(
       p_user_id := '00000000-0000-4000-8000-000000000981', p_credits := 0, p_job_id := NULL,
       p_on_behalf_of := '00000000-0000-4000-8000-000000000988', p_enforce_allowance := TRUE)$q$,
  'Credits must be positive');
SELECT pg_temp.assert_eq('9f the rejected zero-credit call created no allowance row',
  pg_temp.a_col('00000000-0000-4000-8000-000000000988', 'granted_credits'), '<no row>');

-- ---------------------------------------------------------------------------
-- 10. grant_deployment_allowance — the only writer of granted_credits.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises('10a a non-payer actor is refused',
  $q$SELECT grant_deployment_allowance('00000000-0000-4000-8000-000000000987', 50,
       '00000000-0000-4000-8000-000000000982', 'topup', NULL)$q$,
  'ALLOWANCE_ACTOR_NOT_PAYER:');
SELECT pg_temp.assert_raises('10b kind overrun is refused (it would break the grants sum)',
  $q$SELECT grant_deployment_allowance('00000000-0000-4000-8000-000000000987', 50,
       '00000000-0000-4000-8000-000000000981', 'overrun', NULL)$q$,
  'ALLOWANCE_KIND_INVALID:');
SELECT pg_temp.assert_raises('10c kind default is refused (it belongs to lazy provisioning)',
  $q$SELECT grant_deployment_allowance('00000000-0000-4000-8000-000000000987', 50,
       '00000000-0000-4000-8000-000000000981', 'default', NULL)$q$,
  'ALLOWANCE_KIND_INVALID:');
SELECT pg_temp.assert_raises('10d a zero grant is refused',
  $q$SELECT grant_deployment_allowance('00000000-0000-4000-8000-000000000987', 0,
       '00000000-0000-4000-8000-000000000981', 'topup', NULL)$q$,
  'ALLOWANCE_ZERO_GRANT:');

-- A top-up to a user who has NEVER generated must SEED THE DEFAULT FIRST.
-- Without that seed such a user ends up with less than an untouched user, and
-- the lazy provision in reserve_credits would then never write their default.
SELECT grant_deployment_allowance('00000000-0000-4000-8000-000000000987', 50,
  '00000000-0000-4000-8000-000000000981', 'topup', 'first top-up');
SELECT pg_temp.assert_eq('10e a top-up before the first run seeds the default too (100 + 50)',
  pg_temp.a_col('00000000-0000-4000-8000-000000000987', 'granted_credits'), '150');
SELECT pg_temp.assert_eq('10f and it wrote both grant rows',
  (SELECT string_agg(kind || ':' || credits, ',' ORDER BY kind) FROM deployment_allowance_grants
    WHERE user_id = '00000000-0000-4000-8000-000000000987'), 'default:100,topup:50');
SELECT pg_temp.assert_eq('10g the top-up carries the note',
  (SELECT note FROM deployment_allowance_grants
    WHERE user_id = '00000000-0000-4000-8000-000000000987' AND kind = 'topup'), 'first top-up');

-- A negative correction REFUSES rather than clamps below reserved + spent.
-- 984 sits at granted 100, spent 20, reserved 0 (case 4).
SELECT pg_temp.assert_raises('10h a correction below reserved + spent is refused, not clamped',
  $q$SELECT grant_deployment_allowance('00000000-0000-4000-8000-000000000984', -90,
       '00000000-0000-4000-8000-000000000981', 'correction', 'claw back')$q$,
  'ALLOWANCE_BELOW_COMMITTED:');
SELECT pg_temp.assert_eq('10i the refused correction changed nothing',
  pg_temp.a_col('00000000-0000-4000-8000-000000000984', 'granted_credits'), '100');
SELECT grant_deployment_allowance('00000000-0000-4000-8000-000000000984', -80,
  '00000000-0000-4000-8000-000000000981', 'correction', 'claw back to the committed floor');
SELECT pg_temp.assert_eq('10j a correction down to exactly reserved + spent is allowed',
  pg_temp.a_col('00000000-0000-4000-8000-000000000984', 'granted_credits'), '20');

-- ---------------------------------------------------------------------------
-- 11. ALLOWANCE_UNCONFIGURED, in both of its shapes. A settings row whose
--     payer is NULL is as unconfigured as no row at all — and it is the shape
--     that would otherwise fail deep inside the grant insert on a NOT NULL
--     column instead of at this stable prefix.
-- ---------------------------------------------------------------------------
UPDATE deployment_payer_settings SET payer_user_id = NULL WHERE id = true;
SELECT pg_temp.assert_raises('11a a NULL payer_user_id refuses an enforced reserve',
  $q$SELECT reserve_credits(
       p_user_id := '00000000-0000-4000-8000-000000000981', p_credits := 5, p_job_id := NULL,
       p_on_behalf_of := '00000000-0000-4000-8000-000000000989', p_enforce_allowance := TRUE)$q$,
  'ALLOWANCE_UNCONFIGURED:');
SELECT pg_temp.assert_raises('11b a NULL payer_user_id refuses a grant',
  $q$SELECT grant_deployment_allowance('00000000-0000-4000-8000-000000000989', 10,
       '00000000-0000-4000-8000-000000000981', 'topup', NULL)$q$,
  'ALLOWANCE_UNCONFIGURED:');
DELETE FROM deployment_payer_settings WHERE id = true;
SELECT pg_temp.assert_raises('11c no settings row at all refuses an enforced reserve',
  $q$SELECT reserve_credits(
       p_user_id := '00000000-0000-4000-8000-000000000981', p_credits := 5, p_job_id := NULL,
       p_on_behalf_of := '00000000-0000-4000-8000-000000000989', p_enforce_allowance := TRUE)$q$,
  'ALLOWANCE_UNCONFIGURED:');
SELECT pg_temp.assert_eq('11d neither refusal provisioned a row',
  pg_temp.a_col('00000000-0000-4000-8000-000000000989', 'granted_credits'), '<no row>');
-- ...and with no settings row the UNENFORCED lane still works, because
-- attribution never reads the settings table (the two switches, D3).
SELECT reserve_credits(
  p_user_id := '00000000-0000-4000-8000-000000000981', p_credits := 5, p_job_id := NULL,
  p_on_behalf_of := '00000000-0000-4000-8000-000000000989');
SELECT pg_temp.assert_eq('11e attribution still works with no settings row at all',
  (SELECT count(*)::text FROM usage_logs
    WHERE on_behalf_of = '00000000-0000-4000-8000-000000000989'), '1');
INSERT INTO deployment_payer_settings (id, payer_user_id, default_allowance_credits)
VALUES (true, '00000000-0000-4000-8000-000000000981', 100);

-- ---------------------------------------------------------------------------
-- 12. Structure: one function per name, RLS, privileges, and the lock order.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('12a exactly ONE reserve_credits exists (351''s stale-overload lesson)',
  (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reserve_credits'), '1');
SELECT pg_temp.assert_eq('12b reserve_credits now takes 12 arguments',
  (SELECT pronargs::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reserve_credits'), '12');
SELECT pg_temp.assert_eq('12c exactly one commit_credits and one refund_credits',
  (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('commit_credits', 'refund_credits')), '2');
SELECT pg_temp.assert_eq('12d exactly one grant_deployment_allowance',
  (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'grant_deployment_allowance'), '1');

-- Every one of the four pins its search_path (SECURITY DEFINER discipline).
SELECT pg_temp.assert_eq('12e all four money functions pin search_path = public, pg_temp',
  (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('reserve_credits','commit_credits','refund_credits','grant_deployment_allowance')
      AND p.prosecdef
      AND 'search_path=public, pg_temp' = ANY(p.proconfig)), '4');

-- Execute privileges: service_role only, on every one of them.
SELECT pg_temp.assert_eq('12f no browser role may execute grant_deployment_allowance',
  (has_function_privilege('authenticated', 'public.grant_deployment_allowance(uuid,integer,uuid,text,text)', 'EXECUTE')
   OR has_function_privilege('anon', 'public.grant_deployment_allowance(uuid,integer,uuid,text,text)', 'EXECUTE'))::text,
  'false');
SELECT pg_temp.assert_eq('12g service_role may execute grant_deployment_allowance',
  has_function_privilege('service_role', 'public.grant_deployment_allowance(uuid,integer,uuid,text,text)', 'EXECUTE')::text,
  'true');
SELECT pg_temp.assert_eq('12h no browser role may execute the 12-argument reserve_credits',
  (has_function_privilege('authenticated', 'public.reserve_credits(uuid,integer,uuid,text,numeric,numeric,boolean,integer,boolean,uuid,uuid,boolean)', 'EXECUTE')
   OR has_function_privilege('anon', 'public.reserve_credits(uuid,integer,uuid,text,numeric,numeric,boolean,integer,boolean,uuid,uuid,boolean)', 'EXECUTE'))::text,
  'false');
SELECT pg_temp.assert_eq('12i service_role may execute the 12-argument reserve_credits',
  has_function_privilege('service_role', 'public.reserve_credits(uuid,integer,uuid,text,numeric,numeric,boolean,integer,boolean,uuid,uuid,boolean)', 'EXECUTE')::text,
  'true');

-- THE LOCK. The concurrency claim rests here, not on a case above.
SELECT pg_temp.assert_eq('12j reserve locks the allowance row with FOR UPDATE',
  (SELECT (position('FROM deployment_user_allowances WHERE user_id = p_on_behalf_of FOR UPDATE'
           in pg_get_functiondef(p.oid)) > 0)::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reserve_credits'), 'true');
SELECT pg_temp.assert_eq('12k reserve takes the allowance lock BEFORE the profiles lock (D8 order)',
  (SELECT (position('FROM deployment_user_allowances WHERE user_id = p_on_behalf_of FOR UPDATE'
             in pg_get_functiondef(p.oid))
           < position('FROM profiles WHERE id = p_user_id FOR UPDATE'
             in pg_get_functiondef(p.oid)))::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reserve_credits'), 'true');
SELECT pg_temp.assert_eq('12l commit locks the allowance row with FOR UPDATE',
  (SELECT (position('FROM deployment_user_allowances WHERE user_id = v_on_behalf_of FOR UPDATE'
           in pg_get_functiondef(p.oid)) > 0)::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'commit_credits'), 'true');
SELECT pg_temp.assert_eq('12m refund locks the allowance row with FOR UPDATE',
  (SELECT (position('FROM deployment_user_allowances WHERE user_id = v_on_behalf_of FOR UPDATE'
           in pg_get_functiondef(p.oid)) > 0)::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'refund_credits'), 'true');

-- RLS and grants. Table-level revoke FIRST, then the column grant (347's
-- lesson: a column revoke under a live table grant does nothing).
SELECT pg_temp.assert_eq('12n deployment_user_allowances has RLS enabled',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.deployment_user_allowances'::regclass), 'true');
SELECT pg_temp.assert_eq('12o it has exactly one policy, and it is SELECT',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname='public'
     AND tablename='deployment_user_allowances' AND cmd='SELECT'), '1');
SELECT pg_temp.assert_eq('12p it has NO write policy of any kind',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname='public'
     AND tablename='deployment_user_allowances' AND cmd <> 'SELECT'), '0');
SELECT pg_temp.assert_eq('12q authenticated has no TABLE-wide SELECT on the allowances',
  has_table_privilege('authenticated', 'public.deployment_user_allowances', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('12r but it may read the four granted columns',
  (has_column_privilege('authenticated', 'public.deployment_user_allowances', 'user_id', 'SELECT')
   AND has_column_privilege('authenticated', 'public.deployment_user_allowances', 'granted_credits', 'SELECT')
   AND has_column_privilege('authenticated', 'public.deployment_user_allowances', 'reserved_credits', 'SELECT')
   AND has_column_privilege('authenticated', 'public.deployment_user_allowances', 'spent_credits', 'SELECT'))::text,
  'true');
SELECT pg_temp.assert_eq('12s a column nobody granted stays private (reset_at)',
  has_column_privilege('authenticated', 'public.deployment_user_allowances', 'reset_at', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('12t anon may read no column of the allowances',
  has_column_privilege('anon', 'public.deployment_user_allowances', 'granted_credits', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('12u the grants table has RLS on and NO policy at all (it names the payer)',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.deployment_allowance_grants'::regclass)
  || '/' || (SELECT count(*)::text FROM pg_policies WHERE schemaname='public' AND tablename='deployment_allowance_grants'),
  'true/0');
SELECT pg_temp.assert_eq('12v no browser role may read the grants table',
  (has_table_privilege('authenticated', 'public.deployment_allowance_grants', 'SELECT')
   OR has_table_privilege('anon', 'public.deployment_allowance_grants', 'SELECT'))::text, 'false');
SELECT pg_temp.assert_eq('12w the invariant is in the schema, not only in the code',
  (SELECT count(*)::text FROM pg_constraint
    WHERE conrelid = 'public.deployment_user_allowances'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%reserved_credits + spent_credits%'), '1');

-- The service role's path. `deployment-allowance-service.ts` (the ONE module
-- that reads these tables from TypeScript) goes through PostgREST as the
-- service role, so a default-privilege change that took these away would break
-- every balance read on the instance — and it would be discovered here.
SELECT pg_temp.assert_eq('12aa service_role may read both allowance tables',
  (has_table_privilege('service_role', 'public.deployment_user_allowances', 'SELECT')
   AND has_table_privilege('service_role', 'public.deployment_allowance_grants', 'SELECT'))::text, 'true');
SELECT pg_temp.assert_eq('12ab service_role may write both (the RPCs and the payer routes)',
  (has_table_privilege('service_role', 'public.deployment_user_allowances', 'UPDATE')
   AND has_table_privilege('service_role', 'public.deployment_allowance_grants', 'INSERT'))::text, 'true');

-- A user reads their OWN row and nobody else's.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000982","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000982';
SELECT pg_temp.assert_eq('12x a user sees exactly one allowance row — their own',
  (SELECT count(*)::text FROM deployment_user_allowances), '1');
SELECT pg_temp.assert_eq('12y and it is theirs',
  (SELECT user_id::text FROM deployment_user_allowances), '00000000-0000-4000-8000-000000000982');
DO $$ BEGIN
  PERFORM count(*) FROM deployment_allowance_grants;
  RAISE EXCEPTION 'ASSERT FAIL: a user SELECT on deployment_allowance_grants succeeded';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  12z a user cannot read the grants table at all';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 13. The reconciliation, over every row this file created. It is the one
--     assertion that catches a miswired grant path anywhere above:
--     granted_credits = SUM(credits) over the non-audit kinds, always.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('13a granted = sum of default/topup/correction grants, for every row',
  (SELECT count(*)::text FROM deployment_user_allowances a
    WHERE a.granted_credits <> COALESCE((SELECT sum(g.credits) FROM deployment_allowance_grants g
      WHERE g.user_id = a.user_id AND g.kind IN ('default','topup','correction')), 0)), '0');
SELECT pg_temp.assert_eq('13b overrun rows exist and are excluded from that sum',
  (SELECT count(*)::text FROM deployment_allowance_grants WHERE kind = 'overrun'), '1');
SELECT pg_temp.assert_eq('13c the CHECK holds on every row this file created',
  (SELECT count(*)::text FROM deployment_user_allowances
    WHERE reserved_credits + spent_credits > granted_credits), '0');
SELECT pg_temp.assert_eq('13d 362''s column comment now says attribution is transactional',
  (SELECT (lower(col_description('public.usage_logs'::regclass,
     (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.usage_logs'::regclass
        AND attname = 'on_behalf_of'))) LIKE '%historical rows only%')::text), 'true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
