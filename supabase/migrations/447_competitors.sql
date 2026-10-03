-- Competitor tracking: brands a person follows (competitors, or their own
-- brand), each scan of them, and the price of a scan.
--
-- tracked_competitors: one row per tracked brand. `accounts` holds a handle
-- per platform the scan reads straight from; `about_platforms` where it
-- searches the brand's name; `schedule` (off / weekly / daily) drives
-- `next_scan_at`, which the minute cron reads. `scan_job_id` +
-- `scan_started_at` mark a scan in progress (one at a time per brand).
-- `is_own` marks the person's own brand.
--
-- competitor_scans: every scan's posts (the Social Search post shape plus
-- whose each post is), counts, and the action cards it produced. The newest
-- twelve per brand are kept.
--
-- Personal data, reached only through the competitors plugin's routes (the
-- service role), like saved_posts (446): RLS on and no client grants. The
-- plugin enforces what the table cannot (the brand cap, account handles, the
-- scan claim and the schedule), so a signed-in client never writes here
-- directly. Unique brand name per person, compared without case.
--
-- Pricing: a scan runs one Social Search page per search, so
-- competitor-scan:<n> costs n pages (packages/shared/src/competitors.ts,
-- COMPETITOR_SCAN_CREDIT_COSTS, which follows SOCIAL_SEARCH_CREDITS_PER_PAGE;
-- mirrored in STATIC_CREDIT_COSTS). ON CONFLICT DO NOTHING: an
-- administrator's retune survives re-application.

CREATE TABLE IF NOT EXISTS public.tracked_competitors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  brand             TEXT NOT NULL CHECK (char_length(brand) BETWEEN 1 AND 100),
  website           TEXT NOT NULL DEFAULT '' CHECK (char_length(website) <= 500),
  accounts          JSONB NOT NULL DEFAULT '{}'::jsonb,
  about_platforms   TEXT[] NOT NULL DEFAULT '{}'::text[],
  is_own            BOOLEAN NOT NULL DEFAULT false,
  schedule          TEXT NOT NULL DEFAULT 'weekly' CHECK (schedule IN ('off', 'weekly', 'daily')),
  next_scan_at      TIMESTAMPTZ,
  last_scan_at      TIMESTAMPTZ,
  last_scan_id      UUID,
  last_scan_error   TEXT CHECK (last_scan_error IS NULL OR char_length(last_scan_error) <= 300),
  scan_job_id       UUID,
  scan_started_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tracked_competitors_user_brand
  ON public.tracked_competitors (user_id, lower(brand));

CREATE INDEX IF NOT EXISTS idx_tracked_competitors_due
  ON public.tracked_competitors (next_scan_at)
  WHERE schedule <> 'off';

ALTER TABLE public.tracked_competitors ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tracked_competitors FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tracked_competitors TO service_role;

CREATE TABLE IF NOT EXISTS public.competitor_scans (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id  UUID NOT NULL REFERENCES public.tracked_competitors(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_id         UUID,
  posts          JSONB NOT NULL DEFAULT '[]'::jsonb,
  counts         JSONB NOT NULL DEFAULT '{}'::jsonb,
  cards          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_competitor_scans_competitor_created
  ON public.competitor_scans (competitor_id, created_at DESC);

ALTER TABLE public.competitor_scans ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.competitor_scans FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.competitor_scans TO service_role;

COMMENT ON TABLE public.tracked_competitors IS
  'Per-user tracked brands (competitors or their own): accounts, where to search their name, scan schedule.';
COMMENT ON TABLE public.competitor_scans IS
  'Each scan of a tracked brand: the posts found (with whose each is), counts, and the action cards produced.';

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('competitor-scan:1', 20) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('competitor-scan:2', 40) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('competitor-scan:3', 60) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('competitor-scan:4', 80) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('competitor-scan:5', 100) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('competitor-scan:6', 120) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('competitor-scan:7', 140) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('competitor-scan:8', 160) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('competitor-scan:9', 180) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('competitor-scan:10', 200) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('competitor-scan:11', 220) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('competitor-scan:12', 240) ON CONFLICT (model_identifier) DO NOTHING;
