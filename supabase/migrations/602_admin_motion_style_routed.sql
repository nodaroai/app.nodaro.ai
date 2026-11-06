-- The admin Motion price check's style of a run (`public.admin_motion_style`,
-- 593) reads a Precise run with an art style that the Precise art-style route
-- made the Flex way as flex.
--
-- Such a run keeps the style its caller asked for (`style` absent, or
-- 'precise') and records that it was made the Flex way in the hidden
-- `__preciseStyleRouted` (true). The style is how a run was made, so a hand run
-- with that flag is flex. Trend runs are never routed: they keep reading the
-- prompt style their recipe ran, as before. Every other reading is unchanged.
--
-- Replaces the function body only; its privileges are stated again as 593 and
-- 598 left them.
CREATE OR REPLACE FUNCTION public.admin_motion_style(p_input JSONB)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_input->'__videoUrl') = 'string' OR jsonb_typeof(p_input->'trend') = 'object' THEN
      CASE
        WHEN p_input->>'__promptStyle' = 'flexible' THEN 'flex'
        -- No prompt style recorded (a JSON null is none): a run from before
        -- the choice, Flexible for a full-depth clip while masking is on.
        WHEN coalesce(jsonb_typeof(p_input->'__promptStyle'), 'null') = 'null'
         AND p_input->'__faceMasking'->>'source' = 'full-depth'
         AND p_input->'__faceMasking'->>'mode' IS DISTINCT FROM 'off' THEN 'flex'
        ELSE 'precise'
      END
    -- A Precise run with an art style made the Flex way (its asked style kept).
    WHEN p_input->'__preciseStyleRouted' = 'true'::jsonb THEN 'flex'
    WHEN p_input->>'style' = 'motion' THEN 'flex'
    ELSE 'precise'
  END
$$;

REVOKE ALL ON FUNCTION public.admin_motion_style(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_motion_style(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.admin_motion_style(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_motion_style(JSONB) TO service_role;
