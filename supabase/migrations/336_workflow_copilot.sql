-- Migration 336: in-app Workflow Copilot — conversation state.
--
-- A copilot thread belongs to ONE workflow and ONE user; a turn is one user
-- message answered by one agent loop; a message stores the raw model content
-- blocks so a later turn can replay the conversation verbatim.
--
-- Reads go through RLS (owner SELECT only). Every write is made by the
-- backend with the service-role client, which bypasses RLS — so there are
-- deliberately no INSERT/UPDATE/DELETE policies. These tables are NOT added
-- to the realtime publication: the canvas follows `workflows`, and thread
-- content is fetched over the API.

CREATE TABLE IF NOT EXISTS public.copilot_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  -- 'ask' shows the user a Run card with the estimate; 'auto' lets the panel
  -- start the run itself while the estimate stays under the limit below.
  run_mode text NOT NULL DEFAULT 'ask' CHECK (run_mode IN ('ask', 'auto')),
  auto_run_limit_credits integer NOT NULL DEFAULT 100 CHECK (auto_run_limit_credits >= 0 AND auto_run_limit_credits <= 100000),
  user_turn_count integer NOT NULL DEFAULT 0 CHECK (user_turn_count >= 0),
  archived_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One live thread per (user, workflow); archived rows are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS copilot_threads_active_per_workflow
  ON public.copilot_threads (user_id, workflow_id)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS copilot_threads_user_recent
  ON public.copilot_threads (user_id, last_message_at DESC);
-- Archive sweep (cleanup cron) reads this.
CREATE INDEX IF NOT EXISTS copilot_threads_archived
  ON public.copilot_threads (archived_at)
  WHERE archived_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.copilot_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.copilot_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'capped')),
  -- Liveness: a turn whose process died stops beating, and the next request
  -- settles it instead of the thread staying wedged on a stale 'running' row.
  heartbeat_at timestamptz,
  model_id text NOT NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  base_version integer,
  final_version integer,
  iterations integer NOT NULL DEFAULT 0,
  tool_calls integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  -- Written after EVERY iteration: the reconcile handler settles a crashed
  -- turn from this column, so a partial spend is charged, not refunded.
  cost_usd numeric(12, 6),
  credits_charged integer,
  cancel_requested_at timestamptz,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS copilot_turns_thread ON public.copilot_turns (thread_id, started_at DESC);
CREATE INDEX IF NOT EXISTS copilot_turns_running ON public.copilot_turns (status, heartbeat_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS copilot_turns_job ON public.copilot_turns (job_id) WHERE job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.copilot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.copilot_threads(id) ON DELETE CASCADE,
  turn_id uuid NOT NULL REFERENCES public.copilot_turns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq > 0),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  -- Raw model content blocks (text / tool_use / tool_result / thinking).
  -- octet_length, NOT pg_column_size: the latter measures the COMPRESSED
  -- datum, and a node graph compresses ~10x, so a multi-megabyte payload
  -- would pass while still being loaded into memory and replayed.
  content jsonb NOT NULL CHECK (octet_length(content::text) <= 262144),
  -- The volatile per-turn context block, stored apart from the user's own
  -- text so replay can include only the latest one.
  context_preamble text CHECK (context_preamble IS NULL OR length(context_preamble) <= 16000),
  text_preview text CHECK (text_preview IS NULL OR length(text_preview) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, seq)
);

CREATE INDEX IF NOT EXISTS copilot_messages_thread_seq ON public.copilot_messages (thread_id, seq);

ALTER TABLE public.copilot_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS copilot_threads_owner_select ON public.copilot_threads;
CREATE POLICY copilot_threads_owner_select ON public.copilot_threads
  FOR SELECT USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS copilot_turns_owner_select ON public.copilot_turns;
CREATE POLICY copilot_turns_owner_select ON public.copilot_turns
  FOR SELECT USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS copilot_messages_owner_select ON public.copilot_messages;
CREATE POLICY copilot_messages_owner_select ON public.copilot_messages
  FOR SELECT USING (user_id = (select auth.uid()));

-- Supabase grants anon explicitly, so REVOKE FROM PUBLIC alone is not enough.
REVOKE ALL ON TABLE public.copilot_threads FROM PUBLIC;
REVOKE ALL ON TABLE public.copilot_threads FROM anon;
REVOKE ALL ON TABLE public.copilot_turns FROM PUBLIC;
REVOKE ALL ON TABLE public.copilot_turns FROM anon;
REVOKE ALL ON TABLE public.copilot_messages FROM PUBLIC;
REVOKE ALL ON TABLE public.copilot_messages FROM anon;

GRANT SELECT ON public.copilot_threads TO authenticated;
GRANT SELECT ON public.copilot_turns TO authenticated;
GRANT SELECT ON public.copilot_messages TO authenticated;
GRANT ALL ON public.copilot_threads TO service_role;
GRANT ALL ON public.copilot_turns TO service_role;
GRANT ALL ON public.copilot_messages TO service_role;

-- Reservation ceiling for a copilot turn (the turn is metered and commits the
-- actual). Without a row here the hard-fail policy answers 503.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('workflow-copilot', 900, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;

-- Per-service rate override for the copilot identifier; see
-- backend/src/ee/billing/service-margin.ts. Admin-editable afterwards, so the
-- seed only fills the key when it is absent.
INSERT INTO app_settings (key, value)
VALUES ('service_margin_percent', '{"workflow-copilot": 20}'::jsonb)
ON CONFLICT (key) DO UPDATE
  SET value = app_settings.value || '{"workflow-copilot": 20}'::jsonb
  WHERE NOT (app_settings.value ? 'workflow-copilot');

-- Runtime pause switch (the env kill switch is COPILOT_ENABLED).
INSERT INTO app_settings (key, value)
VALUES ('copilot_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
