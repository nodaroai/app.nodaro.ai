-- 568 — concurrency lanes: how many jobs one payer runs at once, per lane
-- (provider / llm / local / run), and the stamps a job, run or pipeline
-- carries while it waits for a slot.
--
-- Nothing here changes behaviour. Waiting is gated by the `lanes_enforced`
-- setting, which starts empty (off in every environment); until it is on, the
-- lanes only measure. Staging runs dev code on this same database before the
-- migration reaches it, so every reader of these tables and columns tolerates
-- their absence.
--
-- Every table is service-role only: the server reads and writes them; a
-- person never does (the admin pages go through the server). The jobs
-- columns stay private like every jobs column 347 did not grant to
-- `authenticated`. workflow_executions keeps its table-level SELECT for the
-- row's owner (474 revoked writes only), so its lane columns are
-- owner-readable; they carry no billing context. pipelines stays server-only
-- (359 revoked every client privilege).
--
-- Lock order: jobs, then workflow_executions, then pipelines. Each ADD COLUMN
-- with a constant default is metadata-only, but takes ACCESS EXCLUSIVE on its
-- table until the migration commits; the lock_timeout bounds each wait for
-- one: a failed, safely retried migration rather than every read and write
-- queued behind it. The queued-jobs index is built alone, in 569 (379's and
-- 562's reasoning). Apply off-peak. Safe to re-run.
SET LOCAL lock_timeout = '2s';

-- ------------------------------------------------------------ queue stamps

-- Written when a job parks (first park only for lane_queued_at), read by the
-- queued sweep of the environment that parked it (lane_env = the runtime
-- environment, lane_env_id = the deployment's environment id, null off
-- Railway), and by the cancel paths (the BullMQ queue and id). lane_wait_ms
-- is the total time it waited for a slot.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS lane_queued_at TIMESTAMPTZ;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS lane_env TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS lane_env_id TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS lane_bull_queue TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS lane_bull_job_id TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS lane_wait_ms BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS lane_queued_at TIMESTAMPTZ;
ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS lane_env TEXT;
ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS lane_env_id TEXT;
ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS lane_wait_ms BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.pipelines ADD COLUMN IF NOT EXISTS lane_queued_at TIMESTAMPTZ;
ALTER TABLE public.pipelines ADD COLUMN IF NOT EXISTS lane_env TEXT;
ALTER TABLE public.pipelines ADD COLUMN IF NOT EXISTS lane_env_id TEXT;
ALTER TABLE public.pipelines ADD COLUMN IF NOT EXISTS lane_wait_ms BIGINT NOT NULL DEFAULT 0;

-- ---------------------------------------------------------- lane plan sizes

-- Each plan's lane sizes, editable in Admin. A tier with no row is sized by
-- the code default.
CREATE TABLE IF NOT EXISTS public.lane_plan_sizes (
  tier TEXT PRIMARY KEY,
  provider INT NOT NULL CHECK (provider BETWEEN 1 AND 500),
  llm INT NOT NULL CHECK (llm BETWEEN 1 AND 500),
  local INT NOT NULL CHECK (local BETWEEN 1 AND 500),
  run INT NOT NULL CHECK (run BETWEEN 1 AND 500),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The code defaults (provider = the plan's parallelism; llm = max(3, 2 ×
-- provider); local = max(4, 2 × provider); run = provider). Enterprise has no
-- per-run parallelism of its own; its lanes default to Business's sizes. An
-- edited row is never overwritten.
INSERT INTO public.lane_plan_sizes (tier, provider, llm, local, run) VALUES
  ('free', 2, 4, 4, 2),
  ('payg', 4, 8, 8, 4),
  ('basic', 4, 8, 8, 4),
  ('standard', 6, 12, 12, 6),
  ('pro', 10, 20, 20, 10),
  ('business', 12, 24, 24, 12),
  ('enterprise', 12, 24, 24, 12)
ON CONFLICT (tier) DO NOTHING;

-- ------------------------------------------------------ lane user overrides

-- One person's sizes, any lane; NULL = that lane follows the plan. Wins over
-- the plan for that person. updated_by = the admin who last edited it (NULL
-- once that admin's account is deleted).
CREATE TABLE IF NOT EXISTS public.lane_user_overrides (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider INT NULL CHECK (provider BETWEEN 1 AND 500),
  llm INT NULL CHECK (llm BETWEEN 1 AND 500),
  local INT NULL CHECK (local BETWEEN 1 AND 500),
  run INT NULL CHECK (run BETWEEN 1 AND 500),
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- --------------------------------------------------- lane provider ceilings

-- A platform-wide ceiling per provider: how many of its calls run at once
-- across every user. No row = no ceiling.
CREATE TABLE IF NOT EXISTS public.lane_provider_ceilings (
  provider TEXT PRIMARY KEY,
  ceiling INT NOT NULL CHECK (ceiling >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------- lane requeue payloads

-- The BullMQ entry a parked job, run or pipeline was taken off the queue
-- with, so it can be added again if the queue loses it. A side table, never a
-- jobs column: the payload carries the billing context (a deployment payer's
-- id, hidden from users), and jobs rows reach users through Realtime and
-- owner reads. Deleted at admission; the queued sweep deletes rows whose job
-- has ended. `opts` holds priority, attempts, backoff, removeOnComplete and
-- removeOnFail.
CREATE TABLE IF NOT EXISTS public.lane_requeue_payloads (
  kind TEXT NOT NULL CHECK (kind IN ('job', 'execution', 'pipeline')),
  row_id UUID NOT NULL,
  bull_queue TEXT NOT NULL,
  bull_job_id TEXT NOT NULL,
  name TEXT NOT NULL,
  data JSONB NOT NULL,
  opts JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, row_id)
);

-- --------------------------------------------------------------- settings

-- lane_queue_timeout_minutes: how long a job may wait for a slot before it
-- fails (5–1440). lane_live_wait_minutes: how long a request that answers
-- live may wait. lanes_enforced: a map of runtime environment → boolean
-- (staging and production share this database); absent = off.
INSERT INTO public.app_settings (key, value) VALUES
  ('lane_queue_timeout_minutes', '120'::jsonb),
  ('lane_live_wait_minutes', '10'::jsonb),
  ('lanes_enforced', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------- service role only (RLS)

-- No policy for authenticated or anon is what keeps them out, and the revokes
-- take away Supabase's default table grants; the service role bypasses RLS
-- and the policy only says so.
ALTER TABLE public.lane_plan_sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lane_user_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lane_provider_ceilings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lane_requeue_payloads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lane_plan_sizes' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.lane_plan_sizes FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lane_user_overrides' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.lane_user_overrides FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lane_provider_ceilings' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.lane_provider_ceilings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lane_requeue_payloads' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.lane_requeue_payloads FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE public.lane_plan_sizes FROM PUBLIC;
REVOKE ALL ON TABLE public.lane_plan_sizes FROM anon;
REVOKE ALL ON TABLE public.lane_plan_sizes FROM authenticated;
GRANT ALL ON TABLE public.lane_plan_sizes TO service_role;

REVOKE ALL ON TABLE public.lane_user_overrides FROM PUBLIC;
REVOKE ALL ON TABLE public.lane_user_overrides FROM anon;
REVOKE ALL ON TABLE public.lane_user_overrides FROM authenticated;
GRANT ALL ON TABLE public.lane_user_overrides TO service_role;

REVOKE ALL ON TABLE public.lane_provider_ceilings FROM PUBLIC;
REVOKE ALL ON TABLE public.lane_provider_ceilings FROM anon;
REVOKE ALL ON TABLE public.lane_provider_ceilings FROM authenticated;
GRANT ALL ON TABLE public.lane_provider_ceilings TO service_role;

REVOKE ALL ON TABLE public.lane_requeue_payloads FROM PUBLIC;
REVOKE ALL ON TABLE public.lane_requeue_payloads FROM anon;
REVOKE ALL ON TABLE public.lane_requeue_payloads FROM authenticated;
GRANT ALL ON TABLE public.lane_requeue_payloads TO service_role;

COMMENT ON TABLE public.lane_plan_sizes IS
  'Concurrency lanes (568): each plan''s lane sizes, edited in Admin. Server-only.';
COMMENT ON TABLE public.lane_user_overrides IS
  'Concurrency lanes (568): one person''s lane sizes; NULL = the plan''s. Server-only.';
COMMENT ON TABLE public.lane_provider_ceilings IS
  'Concurrency lanes (568): platform-wide in-flight ceiling per provider; no row = none. Server-only.';
COMMENT ON TABLE public.lane_requeue_payloads IS
  'Concurrency lanes (568): the BullMQ entry a parked row is re-added from; carries billing context. Server-only, never granted to anon/authenticated.';
