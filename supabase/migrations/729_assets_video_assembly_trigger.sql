-- 729 — public.assets, alone in this file: a Library row filed late
-- takes the assembled video a background assembly already published
-- (722 holds that function), and the rule that an asset's key never moves
-- gains its one exception for that assembly. Both read a jobs column that
-- 723 adds, so this file comes after it: the rule below is a function live
-- requests already run, and its new body must not be in place before the
-- column is.
--
-- Locks: SHARE ROW EXCLUSIVE on assets (a trigger is being attached), on a
-- first apply and on a re-run alike, held until the file commits, and no lock
-- on any other table: writes to assets wait for it, reads do not. The
-- lock_timeout bounds the wait for it behind a long writer: a failed migration
-- that is simply run again, never writes queued behind it.
SET LOCAL lock_timeout = '2s';

-- Ordinary assets remain immutable. The recovery publisher may replace only
-- this job's first delivered clip with the exact assembly it just committed,
-- in the same transaction; client writes can never use this exception.
CREATE OR REPLACE FUNCTION public.assets_recorded_reference_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE assembled boolean := false;
BEGIN
  IF NEW.recorded_reference IS DISTINCT FROM OLD.recorded_reference THEN
    RAISE EXCEPTION 'assets.recorded_reference is written once, at insert' USING ERRCODE='42501';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'an assets row never changes hands' USING ERRCODE='42501';
  END IF;
  IF NEW.r2_key IS NOT NULL AND NEW.r2_key IS DISTINCT FROM OLD.r2_key THEN
    -- The job is read only here — a key being pointed elsewhere — and only for
    -- the server: a client role is refused before it, in a statement of its
    -- own, so it is never asked for a jobs column it may not read.
    IF current_user NOT IN ('anon','authenticated') THEN
      assembled := coalesce((
        NEW.job_id IS NOT DISTINCT FROM OLD.job_id
        AND NEW.type='video' AND OLD.type='video' AND OLD.restricted_at IS NULL
        AND (OLD.expires_at IS NULL OR OLD.expires_at>now())
        AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id=OLD.job_id AND j.user_id=OLD.user_id
          AND j.status='completed' AND j.deleted_at IS NULL AND j.restricted_at IS NULL
          AND j.video_assembly_recovery->>'state'='done'
          AND OLD.r2_url=j.output_data->'unassembledClips'->0->>'url'
          AND NEW.r2_url=j.output_data->>'videoUrl'
          AND NEW.r2_key='videos/'||j.id::text||'-assembly-'||(j.video_assembly_recovery->>'attemptId')||'.mp4'
          AND NEW.size_bytes=(j.video_assembly_recovery->>'size')::bigint)
      ),false);
    END IF;
    IF NOT assembled THEN
      RAISE EXCEPTION 'an assets row''s key can be cleared, never pointed elsewhere' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assets_recorded_reference_immutable() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE TRIGGER file_recovered_video_primary BEFORE INSERT ON public.assets FOR EACH ROW
  WHEN (NEW.job_id IS NOT NULL AND NEW.type='video' AND NEW.metadata ? 'separateClipCount')
  EXECUTE FUNCTION public.file_recovered_video_primary();
