-- ============================================================
-- Competitors: search terms, and topic tracking.
--
-- Search terms. A tracked brand's name is its display name; the posts ABOUT
-- it used to be found by searching that name, so a brand named with a common
-- word found strangers' posts. `search_terms` holds the phrases or #hashtags
-- to search instead (empty = the name, as before). How many a plan may set
-- is tier_config.features.competitor_search_terms, read by the cloud plugin
-- at write and scan time, so it changes without a release. A downgrade keeps
-- the stored terms; a scan uses the first ones the plan allows.
--
-- Topics. A tracked topic is a hashtag or phrase followed with no brand
-- around it ("ai video"): a row of the same table with kind = 'topic', its
-- one term in `search_terms`, its platforms in `about_platforms`, and how
-- many posts each search reads in `post_count` (20 / 40 / 60, one to three
-- Social Search pages). Its scans are competitor_scans rows, so schedule,
-- history and retention are the brands' own. How many topics a plan may
-- follow is tier_config.features.topic_tracks.
--
-- A name is unique per person AND kind: a topic may share a brand's name.
--
-- Pricing: a scan is charged per Social Search page it runs, summed, at
-- competitor-scan:per-page and topic-scan:per-page (one page each, the
-- Social Search page price; packages/shared/src/competitors.ts and
-- topics.ts, mirrored in STATIC_CREDIT_COSTS). The competitor-scan:1..12
-- rows stay while a plugin that reserves them may still run.
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
--
-- payg rides basic's entitlements, as everywhere else (stripe-config.ts).
-- Idempotent, and an administrator's change to the plan caps or the prices
-- survives re-application.
-- ============================================================

ALTER TABLE public.tracked_competitors
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'brand' CHECK (kind IN ('brand', 'topic')),
  ADD COLUMN IF NOT EXISTS search_terms TEXT[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(search_terms) <= 15),
  ADD COLUMN IF NOT EXISTS post_count SMALLINT NOT NULL DEFAULT 20 CHECK (post_count IN (20, 40, 60));

CREATE UNIQUE INDEX IF NOT EXISTS uq_tracked_competitors_user_kind_brand
  ON public.tracked_competitors (user_id, kind, lower(brand));

DROP INDEX IF EXISTS public.uq_tracked_competitors_user_brand;

COMMENT ON COLUMN public.tracked_competitors.kind IS
  'brand: a tracked brand (a competitor, or the person''s own). topic: a tracked hashtag or phrase with no brand.';
COMMENT ON COLUMN public.tracked_competitors.search_terms IS
  'What the searches for posts about it use instead of its name (empty = the name). A topic has exactly one.';
COMMENT ON COLUMN public.tracked_competitors.post_count IS
  'Posts each search of a topic reads (20, 40 or 60). Brands always read 20.';

-- The seed goes first and the stored features last, so a value an
-- administrator already set survives re-application.
UPDATE tier_config AS t
SET features = jsonb_build_object('competitor_search_terms', v.terms, 'topic_tracks', v.topics)
      || COALESCE(t.features, '{}'::jsonb),
    updated_at = NOW()
FROM (VALUES
  ('free', 0, 0),
  ('payg', 0, 0),
  ('basic', 0, 0),
  ('standard', 3, 10),
  ('pro', 5, 30),
  ('business', 10, 50),
  ('enterprise', 10, 50)
) AS v(tier, terms, topics)
WHERE t.tier = v.tier;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('competitor-scan:per-page', 20) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('topic-scan:per-page', 20) ON CONFLICT (model_identifier) DO NOTHING;
