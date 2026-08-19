-- Migration: seed model_pricing for the grok-2 reference chain
--
--   grok-2-i2i — auto-selected when reference images are attached to grok-2
--   (T2I_TO_I2I_VARIANT). The grok-imagine-2 t2i endpoint takes no image
--   input, so the chain is segment-map(image_url) [FREE] → image-edit
--   (task_id) [4 KIE credits = $0.02] — same provider cost as grok-2 t2i,
--   priced at parity (10 credits).
--
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts is the runtime
-- fallback; the admin UI reads pricing exclusively from this table.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('grok-2-i2i', 10, true, 'image')
ON CONFLICT (model_identifier) DO NOTHING;
