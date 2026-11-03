-- engine_environments' platform claim (migration 592) is two columns of its
-- own. The heartbeat's write (what PostgREST runs for the API's
-- `.update({ platform_supports, platform_claimed_at }).eq("env", …)`) never
-- changes the engine record, byte for byte; the boot write (PostgREST's
-- upsert: INSERT … ON CONFLICT (env) DO UPDATE SET the four columns it names)
-- never changes the claim; a beat with no row inserts nothing; a claim is
-- whole (both columns or neither) and an object; and the columns stay
-- server-only, as the rest of the row (548).
-- Run against the migrated disposable database, never the shared cloud project.
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_engine text;
  v_claim text;
BEGIN
  -- The boot write (buildApp).
  INSERT INTO public.engine_environments (env, plugin_build_id, supports, updated_at)
  VALUES ('behavior-claim', '@nodaroai/cloud-plugins@2.0.0', '{"castSwap":{"roleKinds":["person"],"trendRun":true,"faceMeshMinFaceHeightPct":true}}', '2026-11-03T12:00:00Z')
  ON CONFLICT (env) DO UPDATE SET env = EXCLUDED.env, plugin_build_id = EXCLUDED.plugin_build_id, supports = EXCLUDED.supports, updated_at = EXCLUDED.updated_at;
  IF (SELECT platform_supports IS NOT NULL OR platform_claimed_at IS NOT NULL FROM public.engine_environments WHERE env = 'behavior-claim') THEN
    RAISE EXCEPTION 'ASSERT FAIL: a boot write made a claim';
  END IF;
  SELECT row(plugin_build_id, supports, updated_at)::text INTO v_engine FROM public.engine_environments WHERE env = 'behavior-claim';

  -- Three beats.
  UPDATE public.engine_environments SET platform_supports = '{"faceMeshMinFaceHeightPct":true}', platform_claimed_at = '2026-11-03T12:00:30Z' WHERE env = 'behavior-claim';
  UPDATE public.engine_environments SET platform_supports = '{"faceMeshMinFaceHeightPct":true}', platform_claimed_at = '2026-11-03T12:05:30Z' WHERE env = 'behavior-claim';
  UPDATE public.engine_environments SET platform_supports = '{"faceMeshMinFaceHeightPct":true}', platform_claimed_at = '2026-11-03T12:10:30Z' WHERE env = 'behavior-claim';
  IF (SELECT row(plugin_build_id, supports, updated_at)::text FROM public.engine_environments WHERE env = 'behavior-claim') IS DISTINCT FROM v_engine THEN
    RAISE EXCEPTION 'ASSERT FAIL: a beat changed the engine record (was %)', v_engine;
  END IF;
  IF (SELECT platform_claimed_at FROM public.engine_environments WHERE env = 'behavior-claim') IS DISTINCT FROM '2026-11-03T12:10:30Z'::timestamptz THEN
    RAISE EXCEPTION 'ASSERT FAIL: the last beat is not the claim''s time';
  END IF;

  -- A boot write of another build (a rollback's older one): the engine record is its own; the claim is untouched.
  SELECT row(platform_supports, platform_claimed_at)::text INTO v_claim FROM public.engine_environments WHERE env = 'behavior-claim';
  INSERT INTO public.engine_environments (env, plugin_build_id, supports, updated_at)
  VALUES ('behavior-claim', '@nodaroai/cloud-plugins@1.0.0', '{"castSwap":{"roleKinds":["person"]}}', '2026-11-03T12:11:00Z')
  ON CONFLICT (env) DO UPDATE SET env = EXCLUDED.env, plugin_build_id = EXCLUDED.plugin_build_id, supports = EXCLUDED.supports, updated_at = EXCLUDED.updated_at;
  IF (SELECT row(platform_supports, platform_claimed_at)::text FROM public.engine_environments WHERE env = 'behavior-claim') IS DISTINCT FROM v_claim THEN
    RAISE EXCEPTION 'ASSERT FAIL: a boot write changed the claim (was %)', v_claim;
  END IF;
  SELECT row(plugin_build_id, supports, updated_at)::text INTO v_engine FROM public.engine_environments WHERE env = 'behavior-claim';
  IF v_engine IS DISTINCT FROM row('@nodaroai/cloud-plugins@1.0.0'::text, '{"castSwap":{"roleKinds":["person"]}}'::jsonb, '2026-11-03T12:11:00Z'::timestamptz)::text THEN
    RAISE EXCEPTION 'ASSERT FAIL: the rolled-back build''s boot write is not the engine record: %', v_engine;
  END IF;

  -- The outgoing process beats once more: the rolled-back engine record stays, byte for byte.
  UPDATE public.engine_environments SET platform_supports = '{"faceMeshMinFaceHeightPct":true}', platform_claimed_at = '2026-11-03T12:15:30Z' WHERE env = 'behavior-claim';
  IF (SELECT row(plugin_build_id, supports, updated_at)::text FROM public.engine_environments WHERE env = 'behavior-claim') IS DISTINCT FROM v_engine THEN
    RAISE EXCEPTION 'ASSERT FAIL: an outgoing beat overwrote the rolled-back engine record';
  END IF;

  -- A beat for an environment with no engine record yet changes nothing and inserts nothing.
  UPDATE public.engine_environments SET platform_supports = '{"faceMeshMinFaceHeightPct":true}', platform_claimed_at = now() WHERE env = 'behavior-claim-none';
  IF EXISTS (SELECT 1 FROM public.engine_environments WHERE env = 'behavior-claim-none') THEN
    RAISE EXCEPTION 'ASSERT FAIL: a beat inserted a row';
  END IF;

  -- A claim is whole, and an object.
  BEGIN
    UPDATE public.engine_environments SET platform_supports = '{"faceMeshMinFaceHeightPct":true}', platform_claimed_at = NULL WHERE env = 'behavior-claim';
    RAISE EXCEPTION 'ASSERT FAIL: a claim without its time was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.engine_environments SET platform_supports = NULL, platform_claimed_at = now() WHERE env = 'behavior-claim';
    RAISE EXCEPTION 'ASSERT FAIL: a claim time without its claim was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.engine_environments SET platform_supports = '[true]', platform_claimed_at = now() WHERE env = 'behavior-claim';
    RAISE EXCEPTION 'ASSERT FAIL: a non-object claim was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;

DO $$ BEGIN
  IF has_column_privilege('authenticated', 'public.engine_environments', 'platform_supports', 'SELECT')
     OR has_column_privilege('anon', 'public.engine_environments', 'platform_supports', 'SELECT')
     OR has_column_privilege('authenticated', 'public.engine_environments', 'platform_claimed_at', 'UPDATE')
     OR has_column_privilege('anon', 'public.engine_environments', 'platform_claimed_at', 'UPDATE') THEN
    RAISE EXCEPTION 'ASSERT FAIL: a client role holds a privilege on the platform claim';
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
