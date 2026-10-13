-- 505_quiet_stops.sql
--
-- Quiet stop (admin → Users): an account whose new jobs are accepted — the row
-- is created and its credits reserved as for anyone — but held in the queue
-- until an admin releases it. The workers enforce it (lib/access-blocks.ts
-- reads this table into the same snapshot as the block tables); this migration
-- only adds the state. Releasing deletes the row; the history lives in
-- admin_actions (migration 102).
--
-- RLS on with NO policies and revoked from anon and authenticated: only the
-- service role reads or writes it. A policy here would be an oracle.
--
-- Idempotent: CI re-applies the newest migration.
CREATE TABLE IF NOT EXISTS public.quiet_stops (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 500),
  stopped_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quiet_stops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quiet_stops FROM anon, authenticated;
