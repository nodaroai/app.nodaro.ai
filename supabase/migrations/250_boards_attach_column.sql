-- 250_boards_attach_column.sql
-- Allow the ffmpeg image-collage worker to auto-attach finished identity
-- boards to characters.boards via append_character_asset — the same
-- worker-attach pattern every other Character Studio asset uses (expressions,
-- poses, sheets…), so a board generation survives the studio being closed.
-- Byte-identical to the migration 202 version except 'boards' in the
-- whitelist. Grants from migration 200 (service_role only) persist across
-- CREATE OR REPLACE.

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
  IF p_column NOT IN ('expressions', 'poses', 'lighting_variations', 'angles', 'body_angles', 'motions', 'sheets', 'detail_closeups', 'outfit_variations', 'boards') THEN
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
