-- 2026-05-27 — LTX 2.3 model_pricing entries
--
-- Seeds the model_pricing rows for LTX 2.3 Pro and LTX 2.3 Fast (Lightricks
-- via KIE.ai), plus the two per-second op variants (extend, retake) used by
-- the video-extend / video-retake nodes.
--
-- Without these rows the admin UI (/admin/models) can't see / override the
-- per-resolution-per-duration prices — STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts charges correctly at runtime via
-- composite lookup, but the prices are invisible to admins.
--
-- Pricing math
-- ------------
-- Placeholder credit values mirror the entries added in Task 1.7
-- (backend/src/ee/billing/credits.ts STATIC_CREDIT_COSTS). LTX has not
-- published a per-second rate breakdown yet, so values scale linearly with
-- duration and quadratically with resolution tier (1080p → 2k = 2×,
-- 1080p → 4k = 4×). Update via /admin/models after launch once real KIE
-- billing data is available — ON CONFLICT DO NOTHING preserves admin
-- overrides.
--
-- Identifier format:
--   ltx-2.3-pro                       (base id — default = 1080p:6s)
--   ltx-2.3-pro:{tier}:{duration}s    (composite)
--   ltx-2.3-fast                      (base id — default = 1080p:6s)
--   ltx-2.3-fast:{tier}:{duration}s   (composite)
--   ltx-2.3-pro-extend:per-second     (dynamic per-second extend op)
--   ltx-2.3-pro-retake:per-second     (dynamic per-second retake op)

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  -- Base ids (default = 1080p:6s, surfaced to admin UI)
  ('ltx-2.3-pro',                    300, true, 'image-to-video'),
  ('ltx-2.3-fast',                   150, true, 'image-to-video'),
  -- LTX 2.3 Pro — 1080p
  ('ltx-2.3-pro:1080p:6s',           300, true, 'image-to-video'),
  ('ltx-2.3-pro:1080p:8s',           400, true, 'image-to-video'),
  ('ltx-2.3-pro:1080p:10s',          500, true, 'image-to-video'),
  -- LTX 2.3 Pro — 2k
  ('ltx-2.3-pro:2k:6s',              600, true, 'image-to-video'),
  ('ltx-2.3-pro:2k:8s',              800, true, 'image-to-video'),
  ('ltx-2.3-pro:2k:10s',            1000, true, 'image-to-video'),
  -- LTX 2.3 Pro — 4k
  ('ltx-2.3-pro:4k:6s',             1200, true, 'image-to-video'),
  ('ltx-2.3-pro:4k:8s',             1600, true, 'image-to-video'),
  ('ltx-2.3-pro:4k:10s',            2000, true, 'image-to-video'),
  -- LTX 2.3 Fast — 1080p
  ('ltx-2.3-fast:1080p:6s',          150, true, 'image-to-video'),
  ('ltx-2.3-fast:1080p:8s',          200, true, 'image-to-video'),
  ('ltx-2.3-fast:1080p:10s',         250, true, 'image-to-video'),
  ('ltx-2.3-fast:1080p:12s',         300, true, 'image-to-video'),
  ('ltx-2.3-fast:1080p:14s',         350, true, 'image-to-video'),
  ('ltx-2.3-fast:1080p:16s',         400, true, 'image-to-video'),
  ('ltx-2.3-fast:1080p:18s',         450, true, 'image-to-video'),
  ('ltx-2.3-fast:1080p:20s',         500, true, 'image-to-video'),
  -- LTX 2.3 Fast — 2k
  ('ltx-2.3-fast:2k:6s',             300, true, 'image-to-video'),
  ('ltx-2.3-fast:2k:8s',             400, true, 'image-to-video'),
  ('ltx-2.3-fast:2k:10s',            500, true, 'image-to-video'),
  -- LTX 2.3 Fast — 4k
  ('ltx-2.3-fast:4k:6s',             600, true, 'image-to-video'),
  ('ltx-2.3-fast:4k:8s',             800, true, 'image-to-video'),
  ('ltx-2.3-fast:4k:10s',           1000, true, 'image-to-video'),
  -- Per-second extend / retake ops (dynamic — actual cost = rate × duration)
  ('ltx-2.3-pro-extend:per-second',   50, true, 'image-to-video'),
  ('ltx-2.3-pro-retake:per-second',   50, true, 'image-to-video'),
  -- Node-level fallback for /admin/models display. Real reservation runs
  -- through ltx-2.3-pro-retake:per-second × retakeDuration (computeCredits
  -- hook in routes/video-retake.ts); this row is the static display-only
  -- entry that satisfies STATIC_CREDIT_COSTS × model_pricing sync.
  ('video-retake',                   100, true, 'image-to-video')
ON CONFLICT (model_identifier) DO NOTHING;
