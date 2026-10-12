-- Pitch & Tempo node (ffmpeg rubberband: pitch shift + time-stretch).
-- Priced per STARTED minute of the input (1..30): a run reserves
-- `pitch-tempo:<N>m`, which billing prices as this rate row × N — the minutes
-- ids are never stored. Admins retune the per-minute rate here, in /admin/models.
-- Value matches STATIC_CREDIT_COSTS["pitch-tempo"] (credit-pricing-migration-sync.test.ts).
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('pitch-tempo', 20, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
