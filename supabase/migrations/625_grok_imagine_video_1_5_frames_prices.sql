-- Grok Imagine Video 1.5 at the provider's current per-second rates, and its
-- new 1080p tier (decided 2026-11-11).
--
-- The model gains an exact first and last frame, a seamless loop (one image as
-- both) and up to 4 in-between frames; none of them is billed. Every row is
-- repriced on the ladder the platform's other per-second video models use
-- (migrations 304, 324 and 594):
--   credits = ceil(KIE_rate x seconds / 4) x 10
-- KIE rates: 2.4 / 4.5 / 8 cr/s at 480p / 720p / 1080p, with no per-image part
-- (the rows migrations 186 and 288 seeded were built on older rates plus a
-- per-image charge). One row per second, 1-15 s, at each resolution; the bare
-- id prices the 8 s 480p render, KIE's default.
--
-- A `model_pricing` row wins over STATIC_CREDIT_COSTS, so the rows move with
-- the static table, whose values these MUST match
-- (static-costs-match-migrations.test.ts). Each UPDATE names one row and moves
-- it only from the price it held before: a row an administrator retuned stays
-- as it is, a row a deployment does not have stays missing, and a second run
-- changes nothing. Only `credit_cost` is set, so `is_enabled`,
-- `tier_restriction` and `category` stay. The fifteen 1080p rows are new and
-- seeded ON CONFLICT DO NOTHING, in the category the model's other rows were
-- seeded in. Proven on a database by
-- supabase/tests/grok-imagine-video-1-5-prices.behavior.sql.

-- The bare id (8 s at 480p)
UPDATE public.model_pricing SET credit_cost = 50 WHERE model_identifier = 'grok-imagine-video-1.5' AND credit_cost = 295;

-- 480p
UPDATE public.model_pricing SET credit_cost = 10 WHERE model_identifier = 'grok-imagine-video-1.5:1s:480p' AND credit_cost = 50;
UPDATE public.model_pricing SET credit_cost = 20 WHERE model_identifier = 'grok-imagine-video-1.5:2s:480p' AND credit_cost = 80;
UPDATE public.model_pricing SET credit_cost = 20 WHERE model_identifier = 'grok-imagine-video-1.5:3s:480p' AND credit_cost = 120;
UPDATE public.model_pricing SET credit_cost = 30 WHERE model_identifier = 'grok-imagine-video-1.5:4s:480p' AND credit_cost = 150;
UPDATE public.model_pricing SET credit_cost = 30 WHERE model_identifier = 'grok-imagine-video-1.5:5s:480p' AND credit_cost = 190;
UPDATE public.model_pricing SET credit_cost = 40 WHERE model_identifier = 'grok-imagine-video-1.5:6s:480p' AND credit_cost = 230;
UPDATE public.model_pricing SET credit_cost = 50 WHERE model_identifier = 'grok-imagine-video-1.5:7s:480p' AND credit_cost = 260;
UPDATE public.model_pricing SET credit_cost = 50 WHERE model_identifier = 'grok-imagine-video-1.5:8s:480p' AND credit_cost = 300;
UPDATE public.model_pricing SET credit_cost = 60 WHERE model_identifier = 'grok-imagine-video-1.5:9s:480p' AND credit_cost = 340;
UPDATE public.model_pricing SET credit_cost = 60 WHERE model_identifier = 'grok-imagine-video-1.5:10s:480p' AND credit_cost = 370;
UPDATE public.model_pricing SET credit_cost = 70 WHERE model_identifier = 'grok-imagine-video-1.5:11s:480p' AND credit_cost = 410;
UPDATE public.model_pricing SET credit_cost = 80 WHERE model_identifier = 'grok-imagine-video-1.5:12s:480p' AND credit_cost = 440;
UPDATE public.model_pricing SET credit_cost = 80 WHERE model_identifier = 'grok-imagine-video-1.5:13s:480p' AND credit_cost = 480;
UPDATE public.model_pricing SET credit_cost = 90 WHERE model_identifier = 'grok-imagine-video-1.5:14s:480p' AND credit_cost = 520;
UPDATE public.model_pricing SET credit_cost = 90 WHERE model_identifier = 'grok-imagine-video-1.5:15s:480p' AND credit_cost = 550;

-- 720p
UPDATE public.model_pricing SET credit_cost = 20 WHERE model_identifier = 'grok-imagine-video-1.5:1s:720p' AND credit_cost = 70;
UPDATE public.model_pricing SET credit_cost = 30 WHERE model_identifier = 'grok-imagine-video-1.5:2s:720p' AND credit_cost = 130;
UPDATE public.model_pricing SET credit_cost = 40 WHERE model_identifier = 'grok-imagine-video-1.5:3s:720p' AND credit_cost = 200;
UPDATE public.model_pricing SET credit_cost = 50 WHERE model_identifier = 'grok-imagine-video-1.5:4s:720p' AND credit_cost = 260;
UPDATE public.model_pricing SET credit_cost = 60 WHERE model_identifier = 'grok-imagine-video-1.5:5s:720p' AND credit_cost = 320;
UPDATE public.model_pricing SET credit_cost = 70 WHERE model_identifier = 'grok-imagine-video-1.5:6s:720p' AND credit_cost = 380;
UPDATE public.model_pricing SET credit_cost = 80 WHERE model_identifier = 'grok-imagine-video-1.5:7s:720p' AND credit_cost = 450;
UPDATE public.model_pricing SET credit_cost = 90 WHERE model_identifier = 'grok-imagine-video-1.5:8s:720p' AND credit_cost = 510;
UPDATE public.model_pricing SET credit_cost = 110 WHERE model_identifier = 'grok-imagine-video-1.5:9s:720p' AND credit_cost = 570;
UPDATE public.model_pricing SET credit_cost = 120 WHERE model_identifier = 'grok-imagine-video-1.5:10s:720p' AND credit_cost = 630;
UPDATE public.model_pricing SET credit_cost = 130 WHERE model_identifier = 'grok-imagine-video-1.5:11s:720p' AND credit_cost = 700;
UPDATE public.model_pricing SET credit_cost = 140 WHERE model_identifier = 'grok-imagine-video-1.5:12s:720p' AND credit_cost = 760;
UPDATE public.model_pricing SET credit_cost = 150 WHERE model_identifier = 'grok-imagine-video-1.5:13s:720p' AND credit_cost = 820;
UPDATE public.model_pricing SET credit_cost = 160 WHERE model_identifier = 'grok-imagine-video-1.5:14s:720p' AND credit_cost = 880;
UPDATE public.model_pricing SET credit_cost = 170 WHERE model_identifier = 'grok-imagine-video-1.5:15s:720p' AND credit_cost = 950;

-- 1080p (new)
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('grok-imagine-video-1.5:1s:1080p', 20, true, 'image-to-video'),
  ('grok-imagine-video-1.5:2s:1080p', 40, true, 'image-to-video'),
  ('grok-imagine-video-1.5:3s:1080p', 60, true, 'image-to-video'),
  ('grok-imagine-video-1.5:4s:1080p', 80, true, 'image-to-video'),
  ('grok-imagine-video-1.5:5s:1080p', 100, true, 'image-to-video'),
  ('grok-imagine-video-1.5:6s:1080p', 120, true, 'image-to-video'),
  ('grok-imagine-video-1.5:7s:1080p', 140, true, 'image-to-video'),
  ('grok-imagine-video-1.5:8s:1080p', 160, true, 'image-to-video'),
  ('grok-imagine-video-1.5:9s:1080p', 180, true, 'image-to-video'),
  ('grok-imagine-video-1.5:10s:1080p', 200, true, 'image-to-video'),
  ('grok-imagine-video-1.5:11s:1080p', 220, true, 'image-to-video'),
  ('grok-imagine-video-1.5:12s:1080p', 240, true, 'image-to-video'),
  ('grok-imagine-video-1.5:13s:1080p', 260, true, 'image-to-video'),
  ('grok-imagine-video-1.5:14s:1080p', 280, true, 'image-to-video'),
  ('grok-imagine-video-1.5:15s:1080p', 300, true, 'image-to-video')
ON CONFLICT (model_identifier) DO NOTHING;
