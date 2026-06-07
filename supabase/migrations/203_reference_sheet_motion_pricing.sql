-- 201_reference_sheet_motion_pricing.sql
-- Reference Sheet (Plan 10): motion / video sheets.
--   Pricing: reference-sheet:assembly-motion = 6 credits — a flat FFmpeg-assembly
--   fee for composing motion clips onto the still chrome background → MP4. The
--   motion clips themselves are priced separately by the per-asset motion routes.
--   A missing row here → admin can't see/edit it; STATIC_CREDIT_COSTS is the
--   runtime fallback (and the route 503s if neither source has the identifier).

BEGIN;

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('reference-sheet:assembly-motion', 6, true, 'video')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

COMMIT;
