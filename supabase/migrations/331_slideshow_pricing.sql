-- Migration: seed model_pricing for the slideshow node
--
--   slideshow — 2-100 still images + one optional audio track → MP4,
--   rendered by local FFmpeg (no provider, no GPU). ZERO credits, same
--   rationale as still-to-video (migration 330): no provider cost behind it,
--   and the pair is the platform's free bridge from stills into the video
--   pipeline. The credit guard still runs (storage limit, admin kill-switch
--   via is_enabled, dedup) — the 0-cost reservation path creates a 0-credit
--   usage log and deducts nothing.
--
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts is the runtime
-- fallback (also 0); the admin UI reads pricing exclusively from this table.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('slideshow', 0, true, 'processing')
ON CONFLICT (model_identifier) DO NOTHING;
