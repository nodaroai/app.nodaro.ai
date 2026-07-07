-- 240_beeble_switchx_pricing.sql
-- Beeble SwitchX relight/composite provider (`beeble-switchx`), billed per
-- frame-tier × output resolution. Metered per-step (Beeble returns no per-job
-- meter), so we reserve a frame-tier bucket and commit it verbatim — bucketed
-- via composite identifiers `beeble-switchx:<tier>f:<res>p`, where tier ∈
-- SWITCHX_FRAME_TIERS (48/96/144/192/240, see packages/shared/src/switchx-pricing.ts)
-- is picked from the node's client-side frame-count probe and res ∈ {720,1080}.
--
-- PROVISIONAL worst-case values (0% markup; global markup applies at reserve),
-- deliberately HIGH so any pre-anchor Cloud usage over-reserves and never
-- under-bills. RE-ANCHOR these before opening the gate (spec §9.2).
-- Base credits are derived from an estimated per-frame provider cost, tiered by
-- resolution (1080p/720p).
-- The bare `beeble-switchx` row is the back-compat/worst-case default
-- (= 240f/1080p) used when no frame count is supplied.
--
-- Values MUST match STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts
-- (the credit-pricing-migration-sync test enforces both directions). Per
-- CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING preserves any
-- admin overrides set via /admin/models (these identifiers are new, so there
-- is no conflict on first apply).

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('beeble-switchx',            180, true, 'video'),  -- bare = 240f/1080p worst-case
  ('beeble-switchx:48f:1080p',   36, true, 'video'),
  ('beeble-switchx:48f:720p',    22, true, 'video'),
  ('beeble-switchx:96f:1080p',   72, true, 'video'),
  ('beeble-switchx:96f:720p',    44, true, 'video'),
  ('beeble-switchx:144f:1080p', 108, true, 'video'),
  ('beeble-switchx:144f:720p',   65, true, 'video'),
  ('beeble-switchx:192f:1080p', 144, true, 'video'),
  ('beeble-switchx:192f:720p',   87, true, 'video'),
  ('beeble-switchx:240f:1080p', 180, true, 'video'),
  ('beeble-switchx:240f:720p',  108, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
