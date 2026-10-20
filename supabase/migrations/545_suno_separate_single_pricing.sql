-- Suno Separate one-instrument mode (split_stem_advanced): the named
-- instrument alone and the song without it, two takes each
-- (decided 2026-10-19).
--
-- Its own price id beside the two existing modes:
--
--   suno-separate          separate_vocal        40
--   suno-separate-stem     split_stem           130
--   suno-separate-single   split_stem_advanced   80
--
-- The mode → id rule is sunoSeparateCreditId in
-- packages/shared/src/suno-separate.ts. Must match STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('suno-separate-single', 80) ON CONFLICT (model_identifier) DO NOTHING;
