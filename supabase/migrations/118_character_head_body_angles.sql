-- 118_character_head_body_angles.sql
-- Split character "angles" surface into head + body. Add new column for body
-- angles and rename ambiguous reference photo `kind` values in existing rows.
--
-- 1. NEW COLUMN: characters.body_angles — JSONB array of { name, url, description?, realLifeRefs? }
-- 2. RENAME reference_photos JSONB kinds: front -> frontFace, fullBody -> frontBody
-- 3. EXTEND append_character_asset whitelist to allow writes to body_angles.
-- 4. The existing `angles` column is kept; it's now treated as head_angles by the UI.

BEGIN;

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS body_angles JSONB DEFAULT '[]'::jsonb;

-- Rename existing reference_photos kinds atomically per row. Idempotent: re-running
-- against already-migrated rows is a no-op since the source keys no longer exist.
UPDATE public.characters
SET reference_photos = COALESCE((
  SELECT jsonb_agg(
    CASE
      WHEN (elem ->> 'kind') = 'front' THEN
        jsonb_set(elem, '{kind}', '"frontFace"'::jsonb, true)
      WHEN (elem ->> 'kind') = 'fullBody' THEN
        jsonb_set(elem, '{kind}', '"frontBody"'::jsonb, true)
      ELSE elem
    END
  )
  FROM jsonb_array_elements(reference_photos) AS elem
), '[]'::jsonb)
WHERE reference_photos IS NOT NULL
  AND jsonb_typeof(reference_photos) = 'array'
  AND jsonb_array_length(reference_photos) > 0
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(reference_photos) AS elem
    WHERE (elem ->> 'kind') IN ('front', 'fullBody')
  );

COMMENT ON COLUMN public.characters.body_angles IS
  'Full-body T-pose / standing-posture angle views. Mirrors the angles column shape.';

-- Extend the auto-attach RPC whitelist so workers can append to body_angles.
-- CREATE OR REPLACE preserves the existing GRANTs to authenticated + service_role.
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
  IF p_column NOT IN ('expressions', 'poses', 'lighting_variations', 'angles', 'body_angles', 'motions') THEN
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

COMMIT;
