-- supabase/migrations/215_remove_location_asset.sql
-- Atomic per-column JSONB asset REMOVAL for locations — the delete-side
-- mirror of append_location_asset (124). The worker-owned buckets are
-- deliberately dropped from the upsert UPDATE branch (a stale Studio
-- snapshot must not clobber concurrent worker appends), so deleting ONE
-- take (e.g. a 360° surround view the user wants to regenerate) needs this
-- single-statement filter instead of a read-modify-write.
--
-- Ownership is enforced INSIDE the function (id + user_id + not deleted),
-- mirroring the worker attach helpers' belt-and-braces re-verify.
-- Returns true when a matching entry existed and was removed.

CREATE OR REPLACE FUNCTION public.remove_location_asset(
  p_location_id uuid,
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
  -- LOCATION_ATTACH_COLUMNS in @nodaro/shared). %I quoting + this check keep
  -- the dynamic SQL injection-safe.
  IF p_column NOT IN (
    'time_of_day', 'weather', 'seasons', 'angles', 'lighting',
    'atmosphere_motions', 'sheets', 'detail_closeups'
  ) THEN
    RAISE EXCEPTION 'remove_location_asset: invalid column %', p_column;
  END IF;

  EXECUTE format(
    'UPDATE locations
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
  ) USING p_location_id, p_user_id, p_url;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

COMMENT ON FUNCTION public.remove_location_asset IS
  'Atomically remove every {name,url} entry matching p_url from one worker-owned locations bucket column. Ownership-scoped; returns true when something was removed.';
