-- Trend tag labels: a translated label for each tag of the trend catalog.
--
-- A trend's tags stay plain strings on `trends.tags` (549) — what the catalog
-- filters on (`GET /v1/trends?tag=`). This table gives a tag a label in any
-- platform language, keyed by the exact tag string; `labels` is
-- `{ "<locale>": "<label>" }`. A tag with no row, or no label in the asked
-- language (nor English), reads as the tag itself. Admins edit the labels;
-- `GET /v1/trends/tags` lists the tags in use on published trends with the
-- label in the reader's language.
--
-- `tags` also becomes a slug no trend may take: `/v1/trends/tags` is the tag
-- list, and a trend at that slug would be unreachable (as `runs` is, 549).
-- NOT VALID: a row that already holds it is left to an admin to rename, not
-- allowed to fail the deploy; every new write is checked.
--
-- Reached only through the API, which decides what is public:
-- RLS on, no client grants (549's posture).

CREATE TABLE IF NOT EXISTS public.trend_tags (
  tag         TEXT PRIMARY KEY CHECK (char_length(tag) BETWEEN 1 AND 100),
  labels      JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(labels) = 'object'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.trend_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trend_tags FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.trend_tags TO service_role;

COMMENT ON TABLE public.trend_tags IS
  'Trend tag labels: { locale: label } per tag string. A tag with no row reads as itself. Server only.';

ALTER TABLE public.trends DROP CONSTRAINT IF EXISTS trends_slug_not_tags;
ALTER TABLE public.trends
  ADD CONSTRAINT trends_slug_not_tags CHECK (slug <> 'tags') NOT VALID;
