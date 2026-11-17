-- 661: Suno Speech, the node that makes spoken audio with Suno (a one-line
-- brief Suno scripts and performs, or a script with tone, variety, voice
-- gender and background music). Flat: one run, two takes, one row.
--
-- The value MUST match the unit's backend/src/nodes/suno-speech/price.ee.ts
-- (static-costs-match-migrations.test.ts holds the two together).
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.

BEGIN;

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('suno-speech', 30, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;

COMMIT;
