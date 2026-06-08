-- 207: append_character_reference_video — atomic auto-attach of a completed
-- generate-video clip to characters.reference_videos_by_variant.
-- (Renumbered 206->207: 206 was taken by 206_creatures.sql, which merged to dev
--  first; two files sharing version 206 collide in Supabase's migration tracker
--  and would silently skip one.)
--
-- Why
-- ---
-- When a generate-video (image-to-video) request carries an explicit "save
-- this clip to a character" intent (attachToCharacterId +
-- attachReferenceVideoVariant in jobs.input_data), job-finalize.ts appends the
-- finished R2 clip to the character's per-variant reference-video map on
-- completion — covering BOTH the worker path and the reconcile cron (they share
-- finalizeJobWithMedia). Doing this read-modify-write in JS would let two
-- concurrent completions for the same character clobber each other, so the
-- append is a single atomic RPC under a row lock instead.
--
-- Mirrors the column shape + caps written by the route (routes/characters.ts):
-- keys lowercased+trimmed, max 20 keys, max 5 URLs per key (migration 192).
-- Divergence from the route, by necessity: the route REJECTS overflow (400) on
-- interactive edit; a background auto-attach cannot return an error to a human,
-- so it instead (a) silently no-ops a brand-new 21st key and (b) drops the
-- OLDEST URL to keep the 5 most-recent generated takes per key.
--
-- Security (learns from migration 200)
-- ------------------------------------
-- SECURITY DEFINER so the backend's service-role client can call it. It is
-- granted to service_role ONLY from the start — NEVER to authenticated/anon —
-- because filtering on a caller-supplied p_user_id is NOT an auth check when the
-- function bypasses RLS (the cross-tenant IDOR that migration 200 had to patch
-- retroactively for append_character_asset). The sole caller is
-- lib/character-auto-attach.ts (service-role), and the userId it passes is the
-- authoritative job owner (jobs.user_id, set from the auth token at job
-- creation), so a forged attachToCharacterId pointing at another user's
-- character fails the ownership filter and no-ops.
--
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT re-assert the same state.

BEGIN;

CREATE OR REPLACE FUNCTION public.append_character_reference_video(
  p_character_id UUID,
  p_user_id UUID,
  p_variant TEXT,
  p_url TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT := lower(trim(COALESCE(p_variant, '')));
  v_map JSONB;
  v_arr JSONB;
  v_len INT;
BEGIN
  -- Best-effort caller: no-op on empty key/url rather than raising.
  IF v_key = '' OR p_url IS NULL OR trim(p_url) = '' THEN
    RETURN;
  END IF;

  -- Load + lock the owner's row. Ownership is enforced HERE (SECURITY DEFINER
  -- bypasses the RLS owner policy): the caller-supplied p_user_id must match
  -- the row's user_id and the row must not be soft-deleted. FOR UPDATE
  -- serializes concurrent appends to the same character.
  SELECT COALESCE(reference_videos_by_variant, '{}'::jsonb)
    INTO v_map
    FROM public.characters
   WHERE id = p_character_id AND user_id = p_user_id AND deleted_at IS NULL
   FOR UPDATE;

  -- Not owned / deleted → no matching row → no-op.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_arr := COALESCE(v_map -> v_key, '[]'::jsonb);

  -- Dedupe: URL already present under this key → nothing to do. (JSONB allows
  -- an array to "contain" a primitive: '["a","b"]'::jsonb @> '"a"'::jsonb.)
  IF v_arr @> to_jsonb(p_url) THEN
    RETURN;
  END IF;

  -- 20-key cap: never create a 21st key (drop silently — best-effort).
  IF (v_map ? v_key) IS NOT TRUE
     AND (SELECT count(*) FROM jsonb_object_keys(v_map)) >= 20 THEN
    RETURN;
  END IF;

  -- Append, then keep only the 5 most-recent (drop oldest), preserving order.
  v_arr := v_arr || to_jsonb(p_url);
  v_len := jsonb_array_length(v_arr);
  IF v_len > 5 THEN
    SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
      INTO v_arr
      FROM jsonb_array_elements(v_arr) WITH ORDINALITY AS t(elem, ord)
     WHERE ord > v_len - 5;
  END IF;

  UPDATE public.characters
     SET reference_videos_by_variant = jsonb_set(v_map, ARRAY[v_key], v_arr, true),
         updated_at = NOW()
   WHERE id = p_character_id AND user_id = p_user_id AND deleted_at IS NULL;
END;
$$;

-- service_role ONLY (see header). REVOKE on a role that never held the grant is
-- a harmless no-op; doing it explicitly documents intent + survives any default
-- PUBLIC grant on function creation.
REVOKE EXECUTE ON FUNCTION public.append_character_reference_video(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.append_character_reference_video(uuid, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.append_character_reference_video(uuid, uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.append_character_reference_video(uuid, uuid, text, text) TO service_role;

COMMIT;
