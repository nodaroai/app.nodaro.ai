-- 360: dubbing goes duration-priced — `elevenlabs-dubbing` becomes a PER-MINUTE
-- base (40 credits / minute of the dubbed span, minimum 1 minute) instead of a
-- flat 80. The route's computeCredits multiplies this base by
-- ceil(probed_seconds / 60); un-probeable sources (sourceUrl / probe failure)
-- reserve a 120s fallback bucket = 2 minutes = exactly the old flat price, so
-- the typical short clip costs the same as before. The admin panel edits the
-- RATE through this same row (the runtime reads it via getModelCreditBaseCost).
-- Convergent and idempotent (upsert), matching 356/357: re-running is a no-op.

BEGIN;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('elevenlabs-dubbing', 40)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

COMMIT;
