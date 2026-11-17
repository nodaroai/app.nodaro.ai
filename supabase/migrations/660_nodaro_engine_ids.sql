-- Video Remake's engines take the public ids "nodaro-prism" (Nodaro Prism) and
-- "nodaro-pulse" (Nodaro Pulse). The earlier ids stay readable everywhere an
-- engine is read, so the admin Motion price check groups a run by its engine
-- whichever id its input names:
--
--   public.admin_motion_engine(input) answers 'pulse' for an input whose
--   `engine` is `nodaro-pulse`, `motion-pulse`, `motion-lite` or `kling-4`;
--   else 'prism' (migration 593's function, one id added). Cases:
--   supabase/tests/fixtures/motion-engine-cases.json, held to
--   `castSwapEngineFrom` by backend/src/lib/__tests__/motion-price-run-cases.test.ts.
--
-- A function only: no table, index or data changes.

CREATE OR REPLACE FUNCTION public.admin_motion_engine(p_input JSONB)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_input->'engine') = 'string'
     AND p_input->>'engine' IN ('nodaro-pulse', 'motion-pulse', 'motion-lite', 'kling-4') THEN 'pulse'
    ELSE 'prism'
  END
$$;

REVOKE ALL ON FUNCTION public.admin_motion_engine(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_motion_engine(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.admin_motion_engine(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_motion_engine(JSONB) TO service_role;
