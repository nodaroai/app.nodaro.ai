-- 127_seed_flux_lora_character_pricing.sql
-- Seed model_pricing for two directly-emitted credit identifiers used by the
-- character LoRA training flow. Per CLAUDE.md hard-fail policy, both the DB
-- row AND STATIC_CREDIT_COSTS must be populated or the runtime 503s.

BEGIN;

INSERT INTO public.model_pricing (model_identifier, credit_cost, notes)
VALUES
  (
    'flux-lora-character',
    3,
    'Replicate flux-dev-lora inference. Internal-only id selected by payload-builder.ts when a single trained @character is mentioned in generate-image.'
  ),
  (
    'character-lora-training',
    150,
    'Replicate ostris/flux-dev-lora-trainer per-training (1000 steps). Refunded by webhook on failure/cancel.'
  )
ON CONFLICT (model_identifier) DO NOTHING;

COMMIT;
