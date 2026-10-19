-- 536_llm_lane_columns.sql
-- Which lane served a Claude call that can move between lanes: 'direct' (the
-- platform's own Anthropic account) or 'kie' (the aggregator).
--   * llm_calls.lane     — one film-pipeline stage call (ee/pipelines/llms/call-llm.ts)
--   * copilot_turns.lane — one Copilot turn (ee/copilot/store.ts recordTurnLane)
-- Nullable: rows written before this column carry NULL, and so do rows written
-- by code running before this migration is applied — both writers drop the
-- field when the database reports the column missing.
--
-- Both tables are hot: llm_calls takes an insert on every pipeline call, and
-- copilot_turns a heartbeat/progress update every few seconds per live turn.
-- Each ALTER takes ACCESS EXCLUSIVE on its table, so behind a long transaction
-- it would wait and every read and write of that table would queue behind it.
-- The lock_timeout bounds that wait to a failed (and safely retried: every
-- step is guarded) migration instead of a stalled platform. The column is
-- added bare (a nullable column with no default rewrites nothing), and its
-- CHECK is added NOT VALID so no rows are scanned under the lock: every
-- existing row is NULL, so there is nothing to validate.
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.llm_calls ADD COLUMN IF NOT EXISTS lane text;
ALTER TABLE public.copilot_turns ADD COLUMN IF NOT EXISTS lane text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.llm_calls'::regclass AND conname = 'llm_calls_lane_check') THEN
    ALTER TABLE public.llm_calls ADD CONSTRAINT llm_calls_lane_check
      CHECK (lane IN ('direct', 'kie')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.copilot_turns'::regclass AND conname = 'copilot_turns_lane_check') THEN
    ALTER TABLE public.copilot_turns ADD CONSTRAINT copilot_turns_lane_check
      CHECK (lane IN ('direct', 'kie')) NOT VALID;
  END IF;
END $$;
