-- LatentSync (Lip Sync): the hold of each audio-length tier is 40 credits plus
-- 4 per second of the tier, in place of 4.5 per second.
--
-- A run has a part that does not grow with its length, so the first rows held
-- too little for a short clip and a little too much for a long one. The charge
-- does not change: a run is still charged what it used, the rest of the hold
-- released and an overrun collected. Only the hold, and the price shown before
-- a run, move.
--
-- DO UPDATE: these rows were added by migration 665 and are read only by the
-- code that holds by tier. The bare `latentsync` row is still left as it is.
--
-- Values MUST match STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('latentsync:15s', 100, true, 'lip-sync'),
  ('latentsync:30s', 160, true, 'lip-sync'),
  ('latentsync:60s', 280, true, 'lip-sync'),
  ('latentsync:120s', 520, true, 'lip-sync'),
  ('latentsync:300s', 1240, true, 'lip-sync')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
