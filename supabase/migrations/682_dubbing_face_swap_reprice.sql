-- 682: two video tools repriced (decided 2026-11-22).
--
-- Dubbing, every language but Hebrew (`elevenlabs-dubbing`): 260 credits per
-- started minute of the dubbed span, in place of 40. A dub's whole-run price
-- (`elevenlabs-dubbing:<N>u`) is this row × its minutes, so every quote and
-- hold follows. Hebrew (`elevenlabs-dubbing-v2`) keeps its row.
--
-- Face Swap (`roop-face-swap`): 119, in place of 130. A run is charged this
-- row, or what its processing cost when that is more. Each tool's own pricing
-- setting comes with the same release (683).
--
-- A reprice (upsert, as 360): values MUST match STATIC_CREDIT_COSTS
-- (static-costs-match-migrations.test.ts). Re-running is a no-op.

BEGIN;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('elevenlabs-dubbing', 260)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('roop-face-swap', 119)
  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

COMMIT;
