-- 576 — Trend Radar: the daily run that finds candidate trends, what it read,
-- and the admin's decisions.
--
-- A candidate is a short clip that several different creators recast within a
-- few weeks. The radar reads template sites' sitemaps and public posts through
-- Social Search, keeps ids, names, counts and links, and an admin approves a
-- candidate into a draft trend. Readings are kept `retention_days` (default
-- 90) and pruned by the run.
--
-- Every table is service-role only: the admin page reads them through the
-- server, and the public never sees them. Safe to re-run.
SET LOCAL lock_timeout = '2s';

-- ---------------------------------------------------------------- settings

-- One row (id = 1): the thresholds, alerts, retention, the run hour, who the
-- run searches as (an admin; the searches are that account's), and the last
-- run's summary. `searches_date` / `searches_today` meter the day's searches
-- against `thresholds.dailySearchBudget`.
CREATE TABLE IF NOT EXISTS public.trend_radar_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
  alerts JSONB NOT NULL DEFAULT '{}'::jsonb,
  retention_days INT NOT NULL DEFAULT 90,
  run_at TEXT NOT NULL DEFAULT '06:00',
  runner_user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_run JSONB NULL,
  last_run_date DATE NULL,
  searches_date DATE NULL,
  searches_today INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.trend_radar_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------- sources

-- Where the run reads: a template site's public sitemap (`sitemap`), the
-- social search of each name (`social`), or the search-suggestion check
-- (`suggest`). `pages` and `new_today` are what the last read found.
CREATE TABLE IF NOT EXISTS public.trend_radar_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sitemap', 'social', 'suggest')),
  url TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_read_at TIMESTAMPTZ NULL,
  pages INT NULL,
  new_today INT NULL,
  last_error TEXT NULL,
  seen_slugs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------- candidates

-- One row per candidate name. `status` is the admin's and the run's state
-- (`watching` until the creator threshold, `candidate` once passed, `slowing`,
-- `approved` with its draft `trend_id`, `rejected`, `archived`); `label` is the
-- run's read of the last readings (`new`, `watching`, `rising`, `hot`,
-- `slowing`). `posts` holds the top posts as links and counts; `history` the
-- events, newest last.
CREATE TABLE IF NOT EXISTS public.trend_radar_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'watching'
    CHECK (status IN ('watching', 'candidate', 'slowing', 'approved', 'rejected', 'archived')),
  label TEXT NOT NULL DEFAULT 'new'
    CHECK (label IN ('new', 'watching', 'rising', 'hot', 'slowing')),
  sound_name TEXT NULL,
  duration_sec INT NULL,
  creators INT NOT NULL DEFAULT 0,
  plays BIGINT NOT NULL DEFAULT 0,
  day_change_pct REAL NULL,
  first_seen_kind TEXT NOT NULL CHECK (first_seen_kind IN ('template-site', 'social')),
  first_seen_name TEXT NOT NULL,
  first_seen_url TEXT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  top_post JSONB NULL,
  posts JSONB NOT NULL DEFAULT '[]'::jsonb,
  templates_elsewhere JSONB NOT NULL DEFAULT '[]'::jsonb,
  search JSONB NULL,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT NULL,
  reject_reason TEXT NULL,
  passed_at TIMESTAMPTZ NULL,
  trend_id UUID NULL REFERENCES public.trends(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trend_radar_candidates_status ON public.trend_radar_candidates (status, updated_at DESC);

-- ---------------------------------------------------------------- readings

-- One row per candidate and day: distinct creators, summed plays and the posts
-- the search returned. Pruned past `retention_days`.
CREATE TABLE IF NOT EXISTS public.trend_radar_readings (
  candidate_id UUID NOT NULL REFERENCES public.trend_radar_candidates(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  creators INT NOT NULL DEFAULT 0,
  plays BIGINT NOT NULL DEFAULT 0,
  posts INT NOT NULL DEFAULT 0,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, day)
);

-- ---------------------------------------------------------------- policies

ALTER TABLE public.trend_radar_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trend_radar_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trend_radar_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trend_radar_readings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trend_radar_settings' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.trend_radar_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trend_radar_sources' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.trend_radar_sources FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trend_radar_candidates' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.trend_radar_candidates FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trend_radar_readings' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.trend_radar_readings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE public.trend_radar_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.trend_radar_settings FROM anon;
REVOKE ALL ON TABLE public.trend_radar_settings FROM authenticated;
GRANT ALL ON TABLE public.trend_radar_settings TO service_role;

REVOKE ALL ON TABLE public.trend_radar_sources FROM PUBLIC;
REVOKE ALL ON TABLE public.trend_radar_sources FROM anon;
REVOKE ALL ON TABLE public.trend_radar_sources FROM authenticated;
GRANT ALL ON TABLE public.trend_radar_sources TO service_role;

REVOKE ALL ON TABLE public.trend_radar_candidates FROM PUBLIC;
REVOKE ALL ON TABLE public.trend_radar_candidates FROM anon;
REVOKE ALL ON TABLE public.trend_radar_candidates FROM authenticated;
GRANT ALL ON TABLE public.trend_radar_candidates TO service_role;

REVOKE ALL ON TABLE public.trend_radar_readings FROM PUBLIC;
REVOKE ALL ON TABLE public.trend_radar_readings FROM anon;
REVOKE ALL ON TABLE public.trend_radar_readings FROM authenticated;
GRANT ALL ON TABLE public.trend_radar_readings TO service_role;

COMMENT ON TABLE public.trend_radar_settings IS
  'Trend Radar (576): one row of settings and the last run. Server-only.';
COMMENT ON TABLE public.trend_radar_sources IS
  'Trend Radar (576): where the daily run reads. Server-only.';
COMMENT ON TABLE public.trend_radar_candidates IS
  'Trend Radar (576): candidate trends and the admin decisions on them. Links and counts. Server-only.';
COMMENT ON TABLE public.trend_radar_readings IS
  'Trend Radar (576): one reading per candidate and day. Kept retention_days. Server-only.';
