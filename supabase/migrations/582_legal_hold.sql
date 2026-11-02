-- 582_legal_hold.sql
--
-- The legal hold: evidence is never deleted. A stored file is HELD while an
-- administrator's restriction covers it (581) or while it is matched to a
-- VERIFIED complaint case that is still open (580); a job is held while its
-- output is restricted. A hold is a predicate over those records, never a
-- flag of its own, so there is nothing to keep in sync and nothing a writer
-- can forget to set. An unverified complaint holds nothing: anyone can paste
-- a stranger's links into the public form, and a hold they could place would
-- be a way to keep another account from deleting its own files.
--
-- Two layers hold it:
--   1. The bytes: `deleteFromR2` / `batchDeleteFromR2` (lib/storage.ts), the
--      point every delete of the media bucket reaches (the funnel, the retry
--      pass, the sweeps), ask `held_storage_keys_among` before any delete and
--      leave a held key alone, as a kept prefix is left alone.
--   2. The rows: a trigger refuses the DELETE of a held file or job, and the
--      UPDATE that would take a held file's key away (the reaper's "let go").
--      A cascade reaches the trigger too: an account with a held file cannot
--      be deleted until the case is closed or the restriction lifted, which
--      is the point of a hold.
--
-- `restrict_content` (581) is replaced here so that the keys of EVERY row it
-- marks (a copy found by content hash under another key included) are in
-- the restriction's `r2_keys`: that array is what the proxies, the job gate
-- and the hold read, so a copy is covered everywhere, not only on its row.
--
-- Idempotent: CI re-applies the newest migration.

-- The indexes the hold's predicate needs: the active restrictions' keys, and
-- the files the open, verified complaint cases match.
CREATE INDEX IF NOT EXISTS content_restrictions_r2_keys_idx
  ON public.content_restrictions USING gin (r2_keys) WHERE lifted_at IS NULL;
DROP INDEX IF EXISTS public.rights_complaints_matched_assets_idx;
CREATE INDEX IF NOT EXISTS rights_complaints_matched_assets_idx
  ON public.rights_complaints USING gin (matched_asset_ids)
  WHERE status NOT IN ('resolved', 'closed') AND verified_at IS NOT NULL;

-- Whether one file row is held.
CREATE OR REPLACE FUNCTION public.asset_is_held(p_asset_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.assets a WHERE a.id = p_asset_id AND a.restricted_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.rights_complaints c
                  WHERE c.status NOT IN ('resolved', 'closed') AND c.verified_at IS NOT NULL
                    AND c.matched_asset_ids @> ARRAY[p_asset_id]);
$$;
REVOKE ALL ON FUNCTION public.asset_is_held(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asset_is_held(uuid) TO service_role;

-- The keys among `p_keys` that are held: under an active restriction, the
-- key of a restricted file row, or the key of a file an open, verified
-- complaint matches. The storage layer's question.
CREATE OR REPLACE FUNCTION public.held_storage_keys_among(p_keys text[]) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(array_agg(DISTINCT k), '{}'::text[])
    FROM unnest(coalesce(p_keys, '{}'::text[])) AS k
   WHERE EXISTS (SELECT 1 FROM public.content_restrictions r WHERE r.lifted_at IS NULL AND r.r2_keys @> ARRAY[k])
      OR EXISTS (SELECT 1 FROM public.assets a WHERE a.r2_key = k AND a.restricted_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.assets a
                  JOIN public.rights_complaints c
                    ON c.status NOT IN ('resolved', 'closed') AND c.verified_at IS NOT NULL
                   AND c.matched_asset_ids @> ARRAY[a.id]
                 WHERE a.r2_key = k);
$$;
REVOKE ALL ON FUNCTION public.held_storage_keys_among(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.held_storage_keys_among(text[]) TO service_role;

-- Whether an account holds any held file: an account with evidence under hold
-- is not deleted until the hold ends.
CREATE OR REPLACE FUNCTION public.user_has_held_content(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.assets a WHERE a.user_id = p_user_id AND a.restricted_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p_user_id AND j.restricted_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.assets a
                  JOIN public.rights_complaints c
                    ON c.status NOT IN ('resolved', 'closed') AND c.verified_at IS NOT NULL
                   AND c.matched_asset_ids @> ARRAY[a.id]
                 WHERE a.user_id = p_user_id);
$$;
REVOKE ALL ON FUNCTION public.user_has_held_content(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_held_content(uuid) TO service_role;

-- A held file row is neither deleted nor parted from its key. SECURITY
-- DEFINER: the predicate it asks is the service role's, and a deleting role
-- that cannot call it must still be refused, never fail for another reason.
CREATE OR REPLACE FUNCTION public.preserve_held_asset() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.asset_is_held(OLD.id) THEN
      RAISE EXCEPTION 'The file is held as evidence of a complaint and cannot be deleted' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.r2_key IS DISTINCT FROM OLD.r2_key OR NEW.r2_url IS DISTINCT FROM OLD.r2_url) AND public.asset_is_held(OLD.id) THEN
    RAISE EXCEPTION 'The file is held as evidence of a complaint and keeps its key' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_held_asset() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS preserve_held_asset ON public.assets;
CREATE TRIGGER preserve_held_asset
  BEFORE UPDATE OF r2_key, r2_url OR DELETE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.preserve_held_asset();

-- A restricted job row is not deleted.
CREATE OR REPLACE FUNCTION public.preserve_held_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.restricted_at IS NOT NULL THEN
    RAISE EXCEPTION 'The job is held as evidence of a complaint and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_held_job() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS preserve_held_job ON public.jobs;
CREATE TRIGGER preserve_held_job
  BEFORE DELETE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.preserve_held_job();

-- ---------------------------------------------------------------------------
-- restrict_content, as in 581, with one addition: the restriction's
-- `r2_keys` are the keys the caller read off the named row AND the key of
-- every file row the restriction marks (the copies the hash found), so the
-- proxies, the job gate and the hold cover each copy by its own address.
CREATE OR REPLACE FUNCTION public.restrict_content(
  p_asset_id uuid,
  p_job_id uuid,
  p_keys text[],
  p_content_hash text,
  p_source_url text,
  p_owner_user_id uuid,
  p_reason text,
  p_complaint_id uuid,
  p_admin_user_id uuid
) RETURNS public.content_restrictions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamptz := now();
  v_asset_ids uuid[];
  v_job_ids uuid[];
  v_keys text[];
  v_prior jsonb;
  v_unfinished int;
  v_row public.content_restrictions;
BEGIN
  IF p_asset_id IS NULL AND p_job_id IS NULL THEN
    RAISE EXCEPTION 'restrict_content: name a file or a job' USING ERRCODE = '22023';
  END IF;
  IF p_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.assets WHERE id = p_asset_id) THEN
    RAISE EXCEPTION 'restrict_content: no such file' USING ERRCODE = 'P0002';
  END IF;
  IF p_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id) THEN
    RAISE EXCEPTION 'restrict_content: no such job' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.assets WHERE id = p_asset_id AND restricted_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND restricted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'restrict_content: already restricted' USING ERRCODE = '23505';
  END IF;

  -- The rows that name the bytes, locked for this transaction: the files
  -- (by id, key or hash), then the jobs (the named one, and every job whose
  -- output row is among those files).
  SELECT coalesce(array_agg(a.id), '{}'::uuid[]) INTO v_asset_ids
    FROM (SELECT a.id FROM public.assets a
           WHERE a.restricted_at IS NULL
             AND (a.id = p_asset_id
                  OR (cardinality(p_keys) > 0 AND a.r2_key = ANY(p_keys))
                  OR (p_content_hash IS NOT NULL AND a.content_hash = p_content_hash))
           FOR UPDATE) a;
  SELECT coalesce(array_agg(j.id), '{}'::uuid[]),
         coalesce(count(*) FILTER (WHERE j.status NOT IN ('completed', 'failed', 'cancelled', 'pending_review')), 0)
    INTO v_job_ids, v_unfinished
    FROM (SELECT j.id, j.status FROM public.jobs j
           WHERE j.restricted_at IS NULL
             AND (j.id = p_job_id
                  OR j.id IN (SELECT a.job_id FROM public.assets a WHERE a.job_id IS NOT NULL AND a.id = ANY(v_asset_ids)))
           FOR UPDATE) j;
  -- The keys: the caller's, and every marked row's own.
  SELECT coalesce(array_agg(DISTINCT s.k), '{}'::text[]) INTO v_keys
    FROM (SELECT unnest(coalesce(p_keys, '{}'::text[])) AS k
          UNION
          SELECT a.r2_key FROM public.assets a WHERE a.id = ANY(v_asset_ids)) s
   WHERE s.k IS NOT NULL AND s.k <> '';
  v_prior := jsonb_build_object(
    'assets', (SELECT coalesce(jsonb_object_agg(a.id::text, jsonb_build_object('is_shared', coalesce(a.is_shared, false), 'is_library_item', coalesce(a.is_library_item, false))), '{}'::jsonb)
                 FROM public.assets a WHERE a.id = ANY(v_asset_ids)),
    'jobs', (SELECT coalesce(jsonb_object_agg(j.id::text, jsonb_build_object('is_public', coalesce(j.is_public, false))), '{}'::jsonb)
               FROM public.jobs j WHERE j.id = ANY(v_job_ids)));
  IF v_unfinished > 0 THEN
    RAISE EXCEPTION 'restrict_content: a job is not finished' USING ERRCODE = '55P03';
  END IF;

  INSERT INTO public.content_restrictions (asset_id, job_id, r2_keys, content_hash, asset_ids, job_ids, source_url, owner_user_id, reason, complaint_id, prior, restricted_by, restricted_at)
  VALUES (p_asset_id, p_job_id, v_keys, p_content_hash, v_asset_ids, v_job_ids, p_source_url, p_owner_user_id, p_reason, p_complaint_id, v_prior, p_admin_user_id, v_now)
  RETURNING * INTO v_row;

  UPDATE public.assets SET restricted_at = v_now, is_shared = false, is_library_item = false
   WHERE id = ANY(v_asset_ids);
  UPDATE public.jobs
     SET restricted_at = v_now,
         restricted_output_data = jsonb_build_object('output_data', output_data, 'held_output_data', held_output_data),
         output_data = NULL,
         held_output_data = NULL,
         is_public = false
   WHERE id = ANY(v_job_ids);
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.restrict_content(uuid, uuid, text[], text, text, uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
