-- 130_seed_suno_voice_create_pricing.sql
-- Seed model_pricing for the Suno custom-voice persona creation flow. KIE does
-- not publish pricing for /api/v1/voice/validate + /api/v1/voice/generate, so
-- the 20-credit default is a one-time conservative charge covering both calls.
-- Per CLAUDE.md hard-fail policy, both this DB row AND STATIC_CREDIT_COSTS
-- must be populated or runtime 503s.

BEGIN;

INSERT INTO public.model_pricing (model_identifier, credit_cost, notes)
VALUES
  (
    'suno-voice-create',
    20,
    'One-time per-persona charge for /api/v1/voice/validate + /api/v1/voice/generate (KIE custom Suno voice). Charged on POST /v1/suno/voice/generate, committed when /record-info returns status="success" and refunded on status="fail". KIE does not publish pricing for this flow — value is a conservative default to be tuned post-launch.'
  )
ON CONFLICT (model_identifier) DO NOTHING;

COMMIT;
