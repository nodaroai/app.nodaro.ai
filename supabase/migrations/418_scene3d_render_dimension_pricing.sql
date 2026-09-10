-- Scene3D renders above 1920 px — the two frame-size tiers.
--
-- A render's work is per pixel per frame. Until the frame cap moved from 1920
-- to 2560 px (PR #1328) every admissible frame was small enough that the flat
-- `render-video` price was honest; it no longer is. Measured on the software
-- GL path a container actually uses, one frame costs ~65 ms at 1920x1080,
-- ~97 ms at 2560x1440 and ~154 ms at 2560x2560, so the ladder is 1x / 1.5x /
-- 2.5x — the measured ratios rounded to halves.
--
-- Which tier a frame lands in is decided by `renderVideoCreditId`
-- (`@nodaro/shared/scene3d-render-pricing`), and ONLY for `planType:
-- "3d-scene"` requests:
--
--   longest side <= 1920 px ................ bare `render-video` (unchanged)
--   longer, area <= 5,120,000 px ........... `render-video:3d-large`
--   longer, area  > 5,120,000 px ........... `render-video:3d-xlarge`
--
-- The base row is deliberately NOT re-inserted or updated here: every frame
-- that was renderable before the cap moved keeps exactly the price it had,
-- including whatever override an operator has already set. These two rows only
-- ever describe frames that could not be rendered at all until the cap moved,
-- so nothing gets more expensive.
--
-- Values MUST match STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts,
-- where they are DERIVED from the base render's 50 via
-- `scene3DRenderTierCredits`. `/admin/models` reads model_pricing and nothing
-- else, so without these rows the tiers are invisible to admins and
-- unoverridable even though the runtime would charge them correctly.
--
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves
-- admin overrides).

BEGIN;

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('render-video:3d-large',   75, true, 'processing'),
  ('render-video:3d-xlarge', 125, true, 'processing')
ON CONFLICT (model_identifier) DO NOTHING;

COMMIT;
