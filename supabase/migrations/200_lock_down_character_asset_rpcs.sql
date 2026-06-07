-- 200: Lock down append_character_asset / character_workflow_usage to service_role only.
--
-- Security bug (cross-tenant IDOR) — the character variant migration 170 missed.
-- -----------------------------------------------------------------------------
-- Migration 170 locked down `append_location_asset` and `append_object_asset`
-- (REVOKE from PUBLIC/anon/authenticated, GRANT service_role) because they are
-- SECURITY DEFINER (bypass RLS) yet were callable by `authenticated` via
-- PostgREST (`POST /rest/v1/rpc/...`). It explicitly called
-- `append_character_asset` (migration 111/118) the "correct template … which
-- takes a p_user_id and filters on it" and left it granted to `authenticated`.
--
-- But filtering on a CALLER-SUPPLIED `p_user_id` is not an auth check. The
-- function is SECURITY DEFINER, so the RLS owner policy on `characters` is
-- bypassed; the only gate is `WHERE id = p_character_id AND user_id = p_user_id`
-- with both values supplied by the caller. Any authenticated user who learns a
-- victim's (character_id, user_id) pair can append arbitrary {name,url} JSONB
-- into the victim's character asset arrays (expressions / poses /
-- lighting_variations / angles / body_angles / motions) — a cross-tenant write
-- that fully bypasses RLS. `character_workflow_usage(UUID, UUID)` (migration
-- 112) is the same class, read-only: it returns the workflow id+name rows that
-- reference a given character, filtered only on caller-supplied p_user_id.
--
-- Fix
-- ---
-- Both RPCs are ONLY called from the backend service-role client
-- (lib/character-auto-attach.ts → append_character_asset;
--  routes/characters.ts → character_workflow_usage), which re-verifies ownership
-- in the application layer. There is no frontend / SDK / client caller. So make
-- them callable by `service_role` only — REVOKE the (default) PUBLIC grant plus
-- the explicit authenticated/anon grants, then GRANT EXECUTE to service_role.
-- service_role bypasses grant checks regardless, so the backend is unaffected.
-- REVOKE on a role that never held the privilege is a harmless no-op.
--
-- Idempotent: re-running only re-asserts the same grant state.

BEGIN;

-- append_character_asset(uuid, uuid, text, jsonb)
REVOKE EXECUTE ON FUNCTION public.append_character_asset(uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.append_character_asset(uuid, uuid, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.append_character_asset(uuid, uuid, text, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.append_character_asset(uuid, uuid, text, jsonb) TO service_role;

-- character_workflow_usage(uuid, uuid)
REVOKE EXECUTE ON FUNCTION public.character_workflow_usage(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.character_workflow_usage(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.character_workflow_usage(uuid, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.character_workflow_usage(uuid, uuid) TO service_role;

COMMIT;
