-- Migration: seed model_pricing for Grok Imagine Image 2.0 (KIE)
--
-- Three model identifiers (see backend/src/providers/kie/models.ts):
--   grok-2         — text-to-image (KIE grok-imagine-image-2-0/text-to-image,
--                    4 KIE credits = $0.02 → 10 credits, parity with grok v1)
--   grok-2-edit    — prompt/region edit of a PRIOR grok-2 generation by
--                    task_id (grok-imagine-image-2-0/image-edit, $0.02 → 10)
--   grok-2-segment — FREE named segment-mask map of a prior grok-2
--                    generation (grok-imagine-image-2-0/segment-map, 0)
--
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts is the runtime
-- fallback; the admin UI reads pricing exclusively from this table.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('grok-2',         10, true, 'image'),
  ('grok-2-edit',    10, true, 'image'),
  ('grok-2-segment',  0, true, 'image')
ON CONFLICT (model_identifier) DO NOTHING;
