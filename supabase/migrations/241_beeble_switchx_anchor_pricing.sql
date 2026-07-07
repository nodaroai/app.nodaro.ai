-- 241_beeble_switchx_anchor_pricing.sql
-- Re-anchor Beeble SwitchX pricing to match the provider's published per-block
-- billing (developer.beeble.ai/pricing, 2026-06-26): metered per 30-frame BLOCK,
-- yielding 5 credits @720p, 15 credits @1080p per block.
-- Tiers are now 30-frame multiples (SWITCHX_FRAME_TIERS = 30..240, see
-- packages/shared/src/switchx-pricing.ts) so a clip snaps to the EXACT number of
-- blocks Beeble bills (ceil(frames/30)) — replacing the coarse provisional
-- 48/96/144/192/240 tiers from migration 240, which were both too high AND
-- over-charged clips that fell just past a tier boundary.
--
-- Migration 240 seeded the provisional rows; this migration:
--   (a) INSERTs the new 30..210f block tiers (240f already exists from 240),
--   (b) re-prices the shared rows (bare + 240f) DOWN to the anchored values,
--       guarded WHERE the value is still the provisional one so any admin
--       override set via /admin/models is preserved,
--   (c) DELETEs the now-defunct 48/96/144/192f tiers (no longer produced by
--       resolveSwitchXCreditId).
-- Values MUST match STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts
-- (the credit-pricing-migration-sync test enforces both directions).

-- (a) New 30-frame block tiers. 240f already seeded by migration 240 (re-priced
--     in step (b)). ON CONFLICT DO NOTHING preserves any admin override.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('beeble-switchx:30f:1080p',   15, true, 'video'),
  ('beeble-switchx:30f:720p',     5, true, 'video'),
  ('beeble-switchx:60f:1080p',   30, true, 'video'),
  ('beeble-switchx:60f:720p',    10, true, 'video'),
  ('beeble-switchx:90f:1080p',   45, true, 'video'),
  ('beeble-switchx:90f:720p',    15, true, 'video'),
  ('beeble-switchx:120f:1080p',  60, true, 'video'),
  ('beeble-switchx:120f:720p',   20, true, 'video'),
  ('beeble-switchx:150f:1080p',  75, true, 'video'),
  ('beeble-switchx:150f:720p',   25, true, 'video'),
  ('beeble-switchx:180f:1080p',  90, true, 'video'),
  ('beeble-switchx:180f:720p',   30, true, 'video'),
  ('beeble-switchx:210f:1080p', 105, true, 'video'),
  ('beeble-switchx:210f:720p',   35, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;

-- (b) Re-price the rows shared with migration 240, only if still at the
--     provisional value (preserves a deliberate admin override).
UPDATE public.model_pricing SET credit_cost = 120
  WHERE model_identifier = 'beeble-switchx'            AND credit_cost = 180;
UPDATE public.model_pricing SET credit_cost = 120
  WHERE model_identifier = 'beeble-switchx:240f:1080p' AND credit_cost = 180;
UPDATE public.model_pricing SET credit_cost = 40
  WHERE model_identifier = 'beeble-switchx:240f:720p'  AND credit_cost = 108;

-- (c) Remove the now-defunct coarse tiers (resolveSwitchXCreditId no longer
--     produces 48/96/144/192f — the resolver snaps to 30-frame multiples).
DELETE FROM public.model_pricing
  WHERE model_identifier IN (
    'beeble-switchx:48f:1080p',  'beeble-switchx:48f:720p',
    'beeble-switchx:96f:1080p',  'beeble-switchx:96f:720p',
    'beeble-switchx:144f:1080p', 'beeble-switchx:144f:720p',
    'beeble-switchx:192f:1080p', 'beeble-switchx:192f:720p'
  );
