-- Migration: seed model_pricing for the still-to-video node
--
--   still-to-video — one still image + one audio track → MP4, rendered by
--   local FFmpeg (no provider, no GPU). Deliberately ZERO credits: there is
--   no provider cost behind it, and the node is the platform's free bridge
--   from a still to the video pipeline. The credit guard still runs for it
--   (storage limit, admin kill-switch via is_enabled, dedup) — the 0-cost
--   reservation path creates a 0-credit usage log and deducts nothing.
--
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts is the runtime
-- fallback (also 0); the admin UI reads pricing exclusively from this table.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('still-to-video', 0, true, 'processing')
ON CONFLICT (model_identifier) DO NOTHING;
