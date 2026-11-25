-- One clean-up at a time for a SET job's stored pictures (decided 2026-11-25).
--
-- A set job (several pictures from one task) can be cleaned up by several
-- paths at once: the failure write, a cancel, the result gate, a finalize's
-- fence. Each one deletes the pictures and gives their bytes back to the
-- owner's storage account; the storage service cannot tell two deletes of one
-- object apart, so the decision of WHO cleans up is made here, on the job row.
--
-- `claim_job_set_discard` marks the row `server_output.setDiscard =
-- { claimedAt }` in ONE update, only when the row is in one of `p_statuses`
-- (the states in which the caller may clean up) and no clean-up is live: none
-- was ever claimed, the last one finished (`doneAt`), or it was claimed more
-- than 15 minutes ago and never finished (a crashed clean-up is taken over).
-- It answers the claim's `claimedAt` to the caller whose update landed, NULL
-- to every other: only that caller reads, deletes and gives back, then calls
-- `finish_job_set_discard` with the same `claimedAt`. A later clean-up of the
-- same row (an object stored after the first one finished) may claim again.
--
-- `server_output` is server-only (695); every other key in it is kept
-- (jsonb_set on one path). SECURITY INVOKER, as 695's functions: only the
-- service role can update jobs or call these. No table changes.
CREATE OR REPLACE FUNCTION public.claim_job_set_discard(
  p_job_id uuid,
  p_statuses text[]
) RETURNS text
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  claimed text;
BEGIN
  UPDATE public.jobs
     SET server_output = jsonb_set(
           coalesce(server_output, '{}'::jsonb),
           '{setDiscard}',
           jsonb_build_object('claimedAt', to_jsonb(clock_timestamp())),
           true)
   WHERE id = p_job_id
     AND status = ANY (coalesce(p_statuses, ARRAY[]::text[]))
     AND (
       server_output->'setDiscard' IS NULL
       OR (server_output->'setDiscard') ? 'doneAt'
       OR (server_output->'setDiscard'->>'claimedAt')::timestamptz < clock_timestamp() - interval '15 minutes'
     )
  RETURNING server_output->'setDiscard'->>'claimedAt' INTO claimed;
  RETURN claimed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_job_set_discard(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_job_set_discard(uuid, text[]) TO service_role;

-- The clean-up claimed with `p_claimed_at` is done: `doneAt` is set, only when
-- the row still carries that claim (a clean-up that took a stale one over has
-- its own). True when it was marked.
CREATE OR REPLACE FUNCTION public.finish_job_set_discard(
  p_job_id uuid,
  p_claimed_at text
) RETURNS boolean
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  marked boolean;
BEGIN
  UPDATE public.jobs
     SET server_output = jsonb_set(server_output, '{setDiscard,doneAt}', to_jsonb(clock_timestamp()), true)
   WHERE id = p_job_id
     AND server_output->'setDiscard'->>'claimedAt' = p_claimed_at
  RETURNING true INTO marked;
  RETURN coalesce(marked, false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finish_job_set_discard(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_job_set_discard(uuid, text) TO service_role;
