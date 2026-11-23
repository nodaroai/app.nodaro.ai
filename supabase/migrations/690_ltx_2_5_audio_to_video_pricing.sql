-- LTX 2.5 Fast audio-to-video (KIE ltx/2-5-fast-audio-to-video): the clip is as
-- long as its audio, priced on the measured length rounded up to a whole
-- second (decided 2026-11-23). The even 6-20 s rows already exist; these are
-- the other whole seconds: 2-20 s at 720p and 1080p, 2-10 s at 1440p, by the
-- same per-second rule as the existing rows. Machine-generated; values MUST
-- match STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('ltx-2.5-fast:2s:720p', 60, true, 'video'),
  ('ltx-2.5-fast:3s:720p', 90, true, 'video'),
  ('ltx-2.5-fast:4s:720p', 110, true, 'video'),
  ('ltx-2.5-fast:5s:720p', 140, true, 'video'),
  ('ltx-2.5-fast:7s:720p', 190, true, 'video'),
  ('ltx-2.5-fast:9s:720p', 250, true, 'video'),
  ('ltx-2.5-fast:11s:720p', 300, true, 'video'),
  ('ltx-2.5-fast:13s:720p', 360, true, 'video'),
  ('ltx-2.5-fast:15s:720p', 410, true, 'video'),
  ('ltx-2.5-fast:17s:720p', 460, true, 'video'),
  ('ltx-2.5-fast:19s:720p', 520, true, 'video'),
  ('ltx-2.5-fast:2s:1080p', 80, true, 'video'),
  ('ltx-2.5-fast:3s:1080p', 120, true, 'video'),
  ('ltx-2.5-fast:4s:1080p', 160, true, 'video'),
  ('ltx-2.5-fast:5s:1080p', 200, true, 'video'),
  ('ltx-2.5-fast:7s:1080p', 280, true, 'video'),
  ('ltx-2.5-fast:9s:1080p', 360, true, 'video'),
  ('ltx-2.5-fast:11s:1080p', 430, true, 'video'),
  ('ltx-2.5-fast:13s:1080p', 510, true, 'video'),
  ('ltx-2.5-fast:15s:1080p', 590, true, 'video'),
  ('ltx-2.5-fast:17s:1080p', 670, true, 'video'),
  ('ltx-2.5-fast:19s:1080p', 750, true, 'video'),
  ('ltx-2.5-fast:2s:1440p', 120, true, 'video'),
  ('ltx-2.5-fast:3s:1440p', 180, true, 'video'),
  ('ltx-2.5-fast:4s:1440p', 230, true, 'video'),
  ('ltx-2.5-fast:5s:1440p', 290, true, 'video'),
  ('ltx-2.5-fast:7s:1440p', 400, true, 'video'),
  ('ltx-2.5-fast:9s:1440p', 520, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
