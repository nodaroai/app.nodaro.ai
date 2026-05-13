-- Character Studio: backend auto-attach support
--
-- Atomic JSONB append for character asset arrays. Without this RPC, a worker
-- that completes asset generation would have to read the current array, append
-- one entry in JS, and write it back — two concurrent completions from the
-- same character would clobber each other.
--
-- Used by `backend/src/lib/character-auto-attach.ts:attachAssetToCharacter`
-- from the worker handlers in `backend/src/workers/handlers/entity.ts`. The
-- function is SECURITY DEFINER so the worker's service-role client can call
-- it; the user_id check inside guarantees a worker can only attach to rows
-- owned by the job's user.

CREATE OR REPLACE FUNCTION public.append_character_asset(
  p_character_id UUID,
  p_user_id UUID,
  p_column TEXT,
  p_item JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Whitelist columns to prevent dynamic SQL injection via p_column.
  IF p_column NOT IN ('expressions', 'poses', 'lighting_variations', 'angles', 'motions') THEN
    RAISE EXCEPTION 'invalid column: %', p_column;
  END IF;

  EXECUTE format(
    'UPDATE public.characters
        SET %I = COALESCE(%I, ''[]''::jsonb) || $1::jsonb,
            updated_at = NOW()
      WHERE id = $2 AND user_id = $3',
    p_column, p_column
  ) USING p_item, p_character_id, p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_character_asset(UUID, UUID, TEXT, JSONB)
  TO authenticated, service_role;
