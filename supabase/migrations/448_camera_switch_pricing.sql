-- Camera Switch node (camera-switch, podcast Phase 2 B5): chooses which camera
-- shows each cut of an edit by who is speaking. Deterministic code in the
-- cloud plugin (a length probe per camera plus the switch), no model.
--
-- Pricing: FLAT per run (decided 2026-10-03) — `camera-switch` = 10 credits.
-- A clips fan-out runs it once per clip. Mirrors STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts and the plugin's DB-down floor.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES
  ('camera-switch', 10)
ON CONFLICT (model_identifier) DO NOTHING;
