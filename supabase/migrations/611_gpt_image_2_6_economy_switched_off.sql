-- GPT Image 2.6 Economy is switched off until its provider can serve it: on
-- 2026-11-09 every request failed with an internal error, in text-to-image and
-- edit, also on the provider's own playground. The rest of GPT Image 2.6 is
-- unaffected.
--
-- `is_enabled = false` is the admin's model switch (backend/src/lib/model-switch.ts):
-- it hides the model from /v1/models, MCP list_models and every model menu, and
-- refuses a run with `model_disabled`. Turning these two rows on at /admin/models
-- brings the models back, with no deploy. Only these rows are touched: the prices
-- stay, and a rerun is a no-op.
UPDATE public.model_pricing
SET is_enabled = false
WHERE model_identifier IN ('gpt-image-2-6-economy', 'gpt-image-2-6-economy-i2i')
  AND is_enabled IS DISTINCT FROM false;
