-- 170: Lock down append_location_asset / append_object_asset to service_role only.
-- (Renumbered 167 → 169 → 170 to avoid version collisions with a concurrent
--  gemini-omni pricing migration (#2904/#2907) and the billing-accounting
--  migration (169) — Supabase tracks migrations by a version PRIMARY KEY, so two
--  files sharing a numeric prefix break deploys.)
--
-- Security bug (cross-tenant IDOR)
-- -------------------------------
-- `append_location_asset(uuid, text, jsonb)` (migration 124, re-granted 142)
-- and `append_object_asset(uuid, text, jsonb)` (migration 147) are
-- SECURITY DEFINER — they run as the function owner and therefore BYPASS RLS.
-- Every UPDATE inside them filters only on `WHERE id = p_*_id AND deleted_at
-- IS NULL` — there is NO user_id / auth.uid() ownership predicate (unlike the
-- correct template `append_character_asset` in migration 111, which takes a
-- p_user_id and filters on it).
--
-- Both were `GRANT EXECUTE ... TO authenticated`. Worse, Postgres grants
-- EXECUTE to PUBLIC by default on every function, so `anon` and
-- `authenticated` could call them via PUBLIC even without the explicit grant.
-- Because Supabase exposes every executable function through PostgREST
-- (`POST /rest/v1/rpc/append_location_asset`), ANY logged-in user could call
-- these with another tenant's location/object UUID and append arbitrary
-- {name,url} entries into the victim's JSONB asset columns — a cross-tenant
-- write that fully bypasses the locations/objects RLS owner policy.
--
-- Fix
-- ---
-- These RPCs are ONLY ever called from the backend, which connects as
-- `service_role` and re-verifies ownership in the application layer before
-- calling (lib/location-auto-attach.ts, lib/object-auto-attach.ts,
-- workers/handlers/entity.ts). There is no frontend / client caller. So the
-- correct, minimal fix is to make them callable by `service_role` only:
-- REVOKE the (default) PUBLIC grant plus the explicit anon/authenticated
-- grants, then GRANT EXECUTE to service_role. REVOKE on a role that never
-- held the privilege is a harmless no-op.
--
-- Idempotent: re-running only re-asserts the same grant state.

BEGIN;

-- append_location_asset(uuid, text, jsonb)
REVOKE EXECUTE ON FUNCTION public.append_location_asset(uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.append_location_asset(uuid, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.append_location_asset(uuid, text, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.append_location_asset(uuid, text, jsonb) TO service_role;

-- append_object_asset(uuid, text, jsonb)
REVOKE EXECUTE ON FUNCTION public.append_object_asset(uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.append_object_asset(uuid, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.append_object_asset(uuid, text, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.append_object_asset(uuid, text, jsonb) TO service_role;

COMMIT;
