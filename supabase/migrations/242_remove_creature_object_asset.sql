-- supabase/migrations/242_remove_creature_object_asset.sql
-- Atomic per-column JSONB asset REMOVAL for creatures + objects — the
-- delete-side mirror of append_creature_asset (206) / append_object_asset
-- (147), and structurally identical to remove_location_asset (215). The
-- worker-owned buckets are deliberately dropped from the Studio upsert UPDATE
-- branch (a stale Studio snapshot must not clobber concurrent worker appends),
-- so deleting ONE take (e.g. a pose the user wants to regenerate) needs this
-- single-statement filter instead of a read-modify-write.
--
-- Ownership is enforced INSIDE each function (id + user_id + not deleted),
-- mirroring the worker attach helpers' belt-and-braces re-verify.
-- Returns true when a matching entry existed and was removed.

CREATE OR REPLACE FUNCTION public.remove_creature_asset(
  p_creature_id uuid,
  p_user_id uuid,
  p_column text,
  p_url text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  -- Whitelist = the worker-owned {name,url} bucket columns (matches
  -- CREATURE_ATTACH_COLUMNS in @nodaro/shared). %I quoting + this check keep
  -- the dynamic SQL injection-safe.
  IF p_column NOT IN (
    'angles', 'poses', 'variations', 'motion_clips',
    'sheets', 'detail_closeups'
  ) THEN
    RAISE EXCEPTION 'remove_creature_asset: invalid column %', p_column;
  END IF;

  EXECUTE format(
    'UPDATE creatures
        SET %1$I = COALESCE(
              (SELECT jsonb_agg(e)
                 FROM jsonb_array_elements(COALESCE(%1$I, ''[]''::jsonb)) AS e
                WHERE e->>''url'' <> $3),
              ''[]''::jsonb),
            updated_at = now()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1
            FROM jsonb_array_elements(COALESCE(%1$I, ''[]''::jsonb)) AS e
           WHERE e->>''url'' = $3)',
    p_column
  ) USING p_creature_id, p_user_id, p_url;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

COMMENT ON FUNCTION public.remove_creature_asset IS
  'Atomically remove every {name,url} entry matching p_url from one worker-owned creatures bucket column. Ownership-scoped; returns true when something was removed.';

CREATE OR REPLACE FUNCTION public.remove_object_asset(
  p_object_id uuid,
  p_user_id uuid,
  p_column text,
  p_url text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  -- Whitelist = the worker-owned {name,url} bucket columns (matches
  -- OBJECT_ATTACH_COLUMNS in @nodaro/shared). %I quoting + this check keep
  -- the dynamic SQL injection-safe.
  IF p_column NOT IN (
    'angles', 'materials', 'variations', 'motion_clips',
    'sheets', 'detail_closeups'
  ) THEN
    RAISE EXCEPTION 'remove_object_asset: invalid column %', p_column;
  END IF;

  EXECUTE format(
    'UPDATE objects
        SET %1$I = COALESCE(
              (SELECT jsonb_agg(e)
                 FROM jsonb_array_elements(COALESCE(%1$I, ''[]''::jsonb)) AS e
                WHERE e->>''url'' <> $3),
              ''[]''::jsonb),
            updated_at = now()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1
            FROM jsonb_array_elements(COALESCE(%1$I, ''[]''::jsonb)) AS e
           WHERE e->>''url'' = $3)',
    p_column
  ) USING p_object_id, p_user_id, p_url;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

COMMENT ON FUNCTION public.remove_object_asset IS
  'Atomically remove every {name,url} entry matching p_url from one worker-owned objects bucket column. Ownership-scoped; returns true when something was removed.';
