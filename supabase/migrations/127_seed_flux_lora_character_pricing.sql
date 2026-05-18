-- 127_seed_flux_lora_character_pricing.sql
-- Seed model_pricing for two directly-emitted credit identifiers used by the
-- character LoRA training flow. Per CLAUDE.md hard-fail policy, both the DB
-- row AND STATIC_CREDIT_COSTS must be populated or the runtime 503s.
--
-- NOTE: model_pricing has no `notes` column (see migration 017 + 007 — schema
-- is id, model_identifier, provider_cost_usd, credit_cost, is_enabled,
-- tier_restriction, category, created_at, updated_at). The original revision
-- of this migration referenced a non-existent `notes` column and crashed at
-- apply-time with `column "notes" of relation "model_pricing" does not exist`.
-- Matches the convention used by 128/129/130 (is_enabled + category).

BEGIN;

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  -- Replicate flux-dev-lora inference. Internal-only id selected by
  -- payload-builder.ts when a single trained @character is mentioned in
  ***REDACTED-OSS-SCRUB***
  ('flux-lora-character',     3,   true, 'generate-image'),
  -- Replicate ostris/flux-dev-lora-trainer per-training (1000 steps).
  -- Refunded by webhook on failure/cancel. 150cr = conservative one-shot.
  ('character-lora-training', 150, true, 'character-training')
ON CONFLICT (model_identifier) DO NOTHING;

COMMIT;
