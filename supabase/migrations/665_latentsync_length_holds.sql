-- LatentSync (Lip Sync) is held by the length of its audio and charged what the
-- run used.
--
-- It had one row for every clip, whatever its length, while the work it does
-- grows with the audio's length. It now holds the bucket of that length (the
-- same 15 / 30 / 60 / 120 / 300 s buckets as the other models priced by their
-- audio), 4.5 credits per second of the bucket, and the run is then charged
-- what it used: the rest of the hold is released, an overrun is collected.
--
-- The bare `latentsync` row is deliberately left as it is. This migration is
-- applied before the code that holds the bucket rows is live, and until then a
-- run is still charged the bare row: raising it here would charge every run
-- the 5-minute ceiling in that window. The rows below are read by the new code
-- only.
--
-- Values MUST match STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('latentsync:15s', 68, true, 'lip-sync'),
  ('latentsync:30s', 135, true, 'lip-sync'),
  ('latentsync:60s', 270, true, 'lip-sync'),
  ('latentsync:120s', 540, true, 'lip-sync'),
  ('latentsync:300s', 1350, true, 'lip-sync')
ON CONFLICT (model_identifier) DO NOTHING;
