-- 572 — the daily history of the concurrency lanes: per (environment, user,
-- payer) and per (environment, provider), what the lanes held each day.
--
-- Written only by the server, from the gate's Redis, by the environment that
-- owns the rows: staging and production share this database but not their
-- Redis, so every row names its runtime environment and each environment
-- writes, prunes and reads only its own. A row is written whole (the day's
-- totals so far, every few minutes, only when they changed), never
-- incremented, so a repeated write changes nothing. Kept 90 days; the admin
-- page shows the last 30.
--
-- Staging runs dev code on this database before the migration reaches it: the
-- writer tolerates the tables' absence (it logs once and skips).
--
-- Every table is service-role only: the admin page reads them through the
-- server. The foreign key takes SHARE ROW EXCLUSIVE on profiles while the
-- table is created; the lock_timeout bounds that wait. Safe to re-run.
SET LOCAL lock_timeout = '2s';

-- ---------------------------------------------------------- per user line

-- One row per (day, environment, user, payer line). The peaks are per lane
-- ({"provider": n, "llm": n, "local": n, "run": n}); peak_over_limit counts
-- the leases that ran only because limits were off (they would have waited).
-- longest_wait_ms: the longest wait seen. minutes_at_limit: sampled minutes in
-- which any lane ran at or above its size. queue_timeouts / live_wait_expiries:
-- jobs that waited too long in the queue, live calls that gave up waiting.
-- peak_by_source: the most jobs of each source (web, MCP, API, app run, …)
-- running or waiting at once, sampled each minute — not a count of jobs.
CREATE TABLE IF NOT EXISTS public.lane_usage_daily (
  day DATE NOT NULL,
  runtime_env TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payer TEXT NOT NULL,
  peak_running JSONB NOT NULL DEFAULT '{}'::jsonb,
  peak_queued JSONB NOT NULL DEFAULT '{}'::jsonb,
  peak_over_limit JSONB NOT NULL DEFAULT '{}'::jsonb,
  longest_wait_ms BIGINT NOT NULL DEFAULT 0,
  minutes_at_limit INT NOT NULL DEFAULT 0,
  queue_timeouts INT NOT NULL DEFAULT 0,
  live_wait_expiries INT NOT NULL DEFAULT 0,
  peak_by_source JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, runtime_env, user_id, payer)
);

-- One user's last 30 days (the drill-down), and the profile delete's cascade.
CREATE INDEX IF NOT EXISTS idx_lane_usage_daily_user ON public.lane_usage_daily (user_id, day);

-- ------------------------------------------------------------ per provider

-- One row per (day, environment, provider): the most of its calls in flight
-- at once, its platform ceiling when last seen (NULL = none), the calls that
-- completed and failed, and the sampled minutes it ran at its ceiling.
CREATE TABLE IF NOT EXISTS public.lane_provider_daily (
  day DATE NOT NULL,
  runtime_env TEXT NOT NULL,
  provider TEXT NOT NULL,
  peak_running INT NOT NULL DEFAULT 0,
  ceiling INT NULL,
  completed INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  minutes_at_ceiling INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, runtime_env, provider)
);

-- -------------------------------------------------------- sampled days

-- One row per (day, environment): how many minutes were sampled, and in how
-- many of them the lanes were enforced. A day sampled with limits off
-- throughout is a day of measure-only data, which the Admin switch counts
-- before it is turned on (completed days sampled for 90 % of their minutes),
-- whether or not anyone ran anything that day.
CREATE TABLE IF NOT EXISTS public.lane_history_days (
  day DATE NOT NULL,
  runtime_env TEXT NOT NULL,
  sampled_minutes INT NOT NULL DEFAULT 0,
  enforced_minutes INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, runtime_env)
);

-- ------------------------------------------------- service role only (RLS)

-- No policy for authenticated or anon is what keeps them out, and the revokes
-- take away Supabase's default table grants; the service role bypasses RLS
-- and the policy only says so.
ALTER TABLE public.lane_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lane_provider_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lane_history_days ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lane_usage_daily' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.lane_usage_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lane_provider_daily' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.lane_provider_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lane_history_days' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.lane_history_days FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE public.lane_usage_daily FROM PUBLIC;
REVOKE ALL ON TABLE public.lane_usage_daily FROM anon;
REVOKE ALL ON TABLE public.lane_usage_daily FROM authenticated;
GRANT ALL ON TABLE public.lane_usage_daily TO service_role;

REVOKE ALL ON TABLE public.lane_provider_daily FROM PUBLIC;
REVOKE ALL ON TABLE public.lane_provider_daily FROM anon;
REVOKE ALL ON TABLE public.lane_provider_daily FROM authenticated;
GRANT ALL ON TABLE public.lane_provider_daily TO service_role;

REVOKE ALL ON TABLE public.lane_history_days FROM PUBLIC;
REVOKE ALL ON TABLE public.lane_history_days FROM anon;
REVOKE ALL ON TABLE public.lane_history_days FROM authenticated;
GRANT ALL ON TABLE public.lane_history_days TO service_role;

COMMENT ON TABLE public.lane_usage_daily IS
  'Concurrency lanes (572): daily history per environment, user and payer line. Kept 90 days. Server-only.';
COMMENT ON TABLE public.lane_provider_daily IS
  'Concurrency lanes (572): daily history per environment and provider. Kept 90 days. Server-only.';
COMMENT ON TABLE public.lane_history_days IS
  'Concurrency lanes (572): minutes sampled per environment and day, and how many were enforced. Kept 90 days. Server-only.';
