-- 131_seed_suno_voice_create_pricing.sql
-- Seed model_pricing for the Suno custom-voice persona creation flow. KIE does
-- not publish pricing for /api/v1/voice/validate + /api/v1/voice/generate, so
-- the 20-credit default is a one-time conservative charge covering both calls.
-- Per CLAUDE.md hard-fail policy, both this DB row AND STATIC_CREDIT_COSTS
-- must be populated or runtime 503s.
--
-- One-time per-persona charge for /api/v1/voice/validate + /api/v1/voice/generate
-- (KIE custom Suno voice). Charged on POST /v1/suno/voice/generate, committed
-- when /record-info returns status="success" and refunded on status="fail".
--
-- NOTE: model_pricing has no `notes` column (see migration 017 + 007). The
-- original revision of this migration referenced a non-existent `notes`
-- column and crashed at apply-time with `column "notes" of relation
-- "model_pricing" does not exist`. Matches the convention used by 128/129/130
-- (is_enabled + category — 'audio' to match existing suno rows from 007/059).

BEGIN;

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('suno-voice-create', 20, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;

COMMIT;
