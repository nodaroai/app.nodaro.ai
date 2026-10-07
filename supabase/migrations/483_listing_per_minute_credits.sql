-- A listing whose price follows the input recording's length lists it as
-- fixed credits plus credits per minute of the episode (decided 2026-10-07).
-- The existing price columns keep the FIXED part; these hold the per-minute
-- part, 0 when a listing has none (every listing stored before this, until
-- its next publish recomputes it).
--
-- published_apps, mirroring the fixed pair:
--   base_per_minute_credits  the preview part's per-minute credits, before the
--                            creator's fee (the fee's base, as
--                            base_estimated_credits is for the fixed part)
--   per_minute_credits       the listed per-minute price: the preview part
--                            with the fee's percentage, plus the final part
-- workflow_templates:
--   estimated_per_minute_credits  the listed per-minute price
--
-- A List the app's user fills is listed per further item (decided
-- 2026-10-07), the same pair again:
--   base_per_item_credits    the preview part's credits per item beyond the
--                            creator's saved count, before the fee
--   per_item_credits         the listed per-item price: the preview part with
--                            the fee's percentage, plus the final part
ALTER TABLE public.published_apps
  ADD COLUMN IF NOT EXISTS base_per_minute_credits INT NOT NULL DEFAULT 0 CHECK (base_per_minute_credits >= 0),
  ADD COLUMN IF NOT EXISTS per_minute_credits INT NOT NULL DEFAULT 0 CHECK (per_minute_credits >= 0),
  ADD COLUMN IF NOT EXISTS base_per_item_credits INT NOT NULL DEFAULT 0 CHECK (base_per_item_credits >= 0),
  ADD COLUMN IF NOT EXISTS per_item_credits INT NOT NULL DEFAULT 0 CHECK (per_item_credits >= 0);

ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS estimated_per_minute_credits INT NOT NULL DEFAULT 0 CHECK (estimated_per_minute_credits >= 0);

-- The template gallery's "cheapest first" sort (decided 2026-10-07) orders by
-- the price of a typical episode, 60 minutes: the fixed part plus 60 x the
-- per-minute part. 60 is TYPICAL_EPISODE_MINUTES in @nodaro/render-rules,
-- which the gallery's tooltip states; a guard test reads this line.
ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS typical_episode_credits INT
    GENERATED ALWAYS AS (estimated_credits + 60 * estimated_per_minute_credits) STORED;
