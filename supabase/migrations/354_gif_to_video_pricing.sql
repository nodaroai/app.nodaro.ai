-- Migration: seed model_pricing for the gif-to-video node
--
--   gif-to-video — animated GIF → H.264 MP4, rendered by local FFmpeg (no
--   provider, no GPU). Deliberately ZERO credits, same rationale as
--   still-to-video (migration 330) and slideshow (migration 331): there is no
--   provider cost behind it, and the node is a free bridge that lets a GIF be
--   used as a motion reference for video models that reject GIF input. The
--   credit guard still runs for it (storage limit, admin kill-switch via
--   is_enabled, dedup) — the 0-cost reservation path creates a 0-credit usage
--   log and deducts nothing.
--
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts is the runtime
-- fallback (also 0); the admin UI reads pricing exclusively from this table.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('gif-to-video', 0, true, 'processing')
ON CONFLICT (model_identifier) DO NOTHING;
