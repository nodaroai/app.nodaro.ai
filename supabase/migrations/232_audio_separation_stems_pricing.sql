-- Add the Audio Separation "stems" tier (htdemucs_6s, 6-stem full split).
-- The credit id ignored `mode`, so a full-stems run (htdemucs_6s — materially
-- more GPU compute) was charged the same as a 2-stem run. audioSeparationCreditId
-- now emits `audio-separation:stems` for mode=stems@auto/best.
-- 6 cr is a conservative estimate (heavier than the 3 cr base, below the 8 cr
-- htdemucs_ft tier); tune via the audit-credits skill once there is usage data.
-- Admin /admin/models reads model_pricing exclusively; ON CONFLICT DO NOTHING
-- preserves any admin override. Value matches STATIC_CREDIT_COSTS
-- (credit-pricing-migration-sync.test.ts enforces this).
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('audio-separation:stems', 6, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
