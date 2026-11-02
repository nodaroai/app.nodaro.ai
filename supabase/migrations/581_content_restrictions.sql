-- 581_content_restrictions.sql
--
-- Content restrictions: an administrator takes stored bytes out of reach
-- after a complaint, and later lifts the restriction or not. The record of
-- each restriction is kept here, for the life of the platform; the
-- restriction itself is a column on every row that names the bytes, which
-- every read honours.
--
-- A restriction is of the BYTES, not of one row: the same object is named by
-- the file's own `assets` row, by the `assets` row the worker writes for a
-- job's output, by a copy another account saved, and by the job's
-- `output_data`. `restrict_content` marks every one of them in ONE
-- transaction (by storage key, and by content hash when the file has one),
-- and `lift_content_restriction` restores exactly what each row was, in one
-- transaction too: a restriction is never half applied.
--
-- Reads are held three ways, by construction rather than by each reader's
-- care:
--   1. A restrictive policy on `assets` and `jobs`: a restricted row is
--      invisible to anon and authenticated through PostgREST and Realtime
--      (a logged-in browser reads these tables directly), except to admins.
--   2. The backend's own reads filter `restricted_at` (lib/content-restrictions.ts;
--      a guard test holds every user-facing `assets` read to it).
--   3. A restricted job's `output_data` (and a held one's `held_output_data`)
--      is moved to `restricted_output_data`, a column no grant names and no
--      select lists (migration 347's column grant on `jobs` stays as it is),
--      the way a held output is parked (lib/job-policy-gate.ts): every reader
--      of outputs sees none without a change of its own.
-- The bytes themselves (the public CDN, its year-long cache) are a later
-- change; this migration is the row level.
--
-- Idempotent: CI re-applies the newest migration.

CREATE TABLE IF NOT EXISTS public.content_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What the administrator named (one of them). Null once that row is gone: the record stays.
  asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  -- What the restriction covers: the storage keys, the hash, and every row
  -- marked (ids, kept as text so the record survives the rows).
  r2_keys text[] NOT NULL DEFAULT '{}',
  content_hash text,
  asset_ids uuid[] NOT NULL DEFAULT '{}',
  job_ids uuid[] NOT NULL DEFAULT '{}',
  source_url text CHECK (source_url IS NULL OR char_length(source_url) <= 4000),
  owner_user_id uuid,
  -- Why, and for which complaint.
  reason text NOT NULL CHECK (char_length(reason) <= 4000),
  complaint_id uuid REFERENCES public.rights_complaints(id),
  -- What each row looked like before, so a lift restores exactly:
  -- {"assets": {"<id>": {"is_shared", "is_library_item"}}, "jobs": {"<id>": {"is_public"}}}.
  prior jsonb NOT NULL DEFAULT '{}'::jsonb,
  restricted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  restricted_at timestamptz NOT NULL DEFAULT now(),
  lifted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  lifted_at timestamptz,
  lift_reason text CHECK (lift_reason IS NULL OR char_length(lift_reason) <= 4000)
);
-- (No check that a target is still named: the rows a record points at fall
-- away with the foreign keys' SET NULL, and the record must outlive them.)
ALTER TABLE public.content_restrictions DROP CONSTRAINT IF EXISTS content_restrictions_target;

CREATE INDEX IF NOT EXISTS content_restrictions_active_idx ON public.content_restrictions (restricted_at DESC) WHERE lifted_at IS NULL;
CREATE INDEX IF NOT EXISTS content_restrictions_asset_idx ON public.content_restrictions (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_restrictions_job_idx ON public.content_restrictions (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_restrictions_complaint_idx ON public.content_restrictions (complaint_id) WHERE complaint_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_restrictions_asset_ids_idx ON public.content_restrictions USING gin (asset_ids) WHERE lifted_at IS NULL;
CREATE INDEX IF NOT EXISTS content_restrictions_job_ids_idx ON public.content_restrictions USING gin (job_ids) WHERE lifted_at IS NULL;

ALTER TABLE public.content_restrictions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_restrictions FROM anon, authenticated;

-- A restriction is a record: never deleted, and the one change is the lift
-- (who, when and why, in the one update that sets `lifted_at`); the rows it
-- named may only fall away with the row (the foreign keys' SET NULL).
CREATE OR REPLACE FUNCTION public.preserve_content_restriction() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  mutable text[] := ARRAY['asset_id', 'job_id', 'restricted_by', 'lifted_by', 'lifted_at', 'lift_reason'];
  lifting boolean := OLD.lifted_at IS NULL AND NEW.lifted_at IS NOT NULL;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A content restriction cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - mutable) = (to_jsonb(OLD) - mutable)
     AND (NEW.asset_id IS NULL OR NEW.asset_id = OLD.asset_id)
     AND (NEW.job_id IS NULL OR NEW.job_id = OLD.job_id)
     AND (NEW.restricted_by IS NULL OR NEW.restricted_by = OLD.restricted_by)
     AND (NEW.lifted_at IS NOT DISTINCT FROM OLD.lifted_at OR lifting)
     AND (NEW.lifted_by IS NOT DISTINCT FROM OLD.lifted_by OR lifting OR NEW.lifted_by IS NULL)
     AND (NEW.lift_reason IS NOT DISTINCT FROM OLD.lift_reason OR lifting) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A content restriction is immutable' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_content_restriction() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS preserve_content_restriction ON public.content_restrictions;
CREATE TRIGGER preserve_content_restriction
  BEFORE UPDATE OR DELETE ON public.content_restrictions
  FOR EACH ROW EXECUTE FUNCTION public.preserve_content_restriction();
DROP TRIGGER IF EXISTS refuse_content_restrictions_truncate ON public.content_restrictions;
CREATE TRIGGER refuse_content_restrictions_truncate
  BEFORE TRUNCATE ON public.content_restrictions
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_content_rights_truncate();

-- The restriction on the rows it covers.
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS restricted_at timestamptz;
COMMENT ON COLUMN public.assets.restricted_at IS
  'When the file was restricted after a complaint (hidden from every read but an admin''s); NULL = not restricted.';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS restricted_at timestamptz;
COMMENT ON COLUMN public.jobs.restricted_at IS
  'When the job''s output was restricted after a complaint (the row hidden from every read but an admin''s, its output moved aside); NULL = not restricted.';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS restricted_output_data jsonb;
COMMENT ON COLUMN public.jobs.restricted_output_data IS
  'The output_data and held_output_data of a restricted job ({"output_data", "held_output_data"}), moved here so no reader sees them; no grant names this column. A lift moves them back.';

CREATE INDEX IF NOT EXISTS assets_restricted_idx ON public.assets (restricted_at) WHERE restricted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_restricted_idx ON public.jobs (restricted_at) WHERE restricted_at IS NOT NULL;
-- The rows that name the same bytes: by key and by hash (the key index also
-- serves the complaint matching of 580).
CREATE INDEX IF NOT EXISTS idx_assets_r2_key ON public.assets (r2_key);
CREATE INDEX IF NOT EXISTS idx_assets_content_hash ON public.assets (content_hash) WHERE content_hash IS NOT NULL;

-- A restricted row is invisible through PostgREST and Realtime, admins apart
-- (the shape of 561's "A deleted job is hidden").
DROP POLICY IF EXISTS "A restricted file is hidden" ON public.assets;
CREATE POLICY "A restricted file is hidden" ON public.assets
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (restricted_at IS NULL OR (SELECT public.is_admin()));
DROP POLICY IF EXISTS "A restricted job is hidden" ON public.jobs;
CREATE POLICY "A restricted job is hidden" ON public.jobs
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (restricted_at IS NULL OR (SELECT public.is_admin()));

-- ---------------------------------------------------------------------------
-- restrict_content: one transaction over every row that names the bytes.
--
-- `p_keys` are the storage keys the backend read off the named row (the
-- file's own key and its thumbnail's; a job's output keys, held output
-- included); `p_content_hash` finds the copies of the same file. Every
-- `assets` row with one of those keys or that hash, and every job whose
-- output row names one of those keys (the named job included), is marked;
-- a job that is not finished is refused (its worker would write a fresh
-- output over the restriction). Answers the record. Service role only.
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
  v_prior := jsonb_build_object(
    'assets', (SELECT coalesce(jsonb_object_agg(a.id::text, jsonb_build_object('is_shared', coalesce(a.is_shared, false), 'is_library_item', coalesce(a.is_library_item, false))), '{}'::jsonb)
                 FROM public.assets a WHERE a.id = ANY(v_asset_ids)),
    'jobs', (SELECT coalesce(jsonb_object_agg(j.id::text, jsonb_build_object('is_public', coalesce(j.is_public, false))), '{}'::jsonb)
               FROM public.jobs j WHERE j.id = ANY(v_job_ids)));
  IF v_unfinished > 0 THEN
    RAISE EXCEPTION 'restrict_content: a job is not finished' USING ERRCODE = '55P03';
  END IF;

  INSERT INTO public.content_restrictions (asset_id, job_id, r2_keys, content_hash, asset_ids, job_ids, source_url, owner_user_id, reason, complaint_id, prior, restricted_by, restricted_at)
  VALUES (p_asset_id, p_job_id, coalesce(p_keys, '{}'), p_content_hash, v_asset_ids, v_job_ids, p_source_url, p_owner_user_id, p_reason, p_complaint_id, v_prior, p_admin_user_id, v_now)
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

-- lift_content_restriction: the record says so, and every row the
-- restriction marked is restored to what it was, unless another active
-- restriction still covers it. A job's output goes back only where nothing
-- was written since (the open column still empty, the parked one still full).
CREATE OR REPLACE FUNCTION public.lift_content_restriction(
  p_id uuid,
  p_admin_user_id uuid,
  p_reason text
) RETURNS public.content_restrictions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.content_restrictions;
  v_asset uuid;
  v_job uuid;
BEGIN
  SELECT * INTO v_row FROM public.content_restrictions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lift_content_restriction: no such restriction' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.lifted_at IS NOT NULL THEN
    RAISE EXCEPTION 'lift_content_restriction: lifted before' USING ERRCODE = '23505';
  END IF;

  UPDATE public.content_restrictions
     SET lifted_at = now(), lifted_by = p_admin_user_id, lift_reason = p_reason
   WHERE id = p_id
  RETURNING * INTO v_row;

  FOREACH v_asset IN ARRAY v_row.asset_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.content_restrictions r WHERE r.lifted_at IS NULL AND r.id <> p_id AND v_asset = ANY(r.asset_ids)) THEN
      UPDATE public.assets
         SET restricted_at = NULL,
             is_shared = coalesce((v_row.prior -> 'assets' -> v_asset::text ->> 'is_shared')::boolean, false),
             is_library_item = coalesce((v_row.prior -> 'assets' -> v_asset::text ->> 'is_library_item')::boolean, false)
       WHERE id = v_asset AND restricted_at IS NOT NULL;
    END IF;
  END LOOP;
  FOREACH v_job IN ARRAY v_row.job_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.content_restrictions r WHERE r.lifted_at IS NULL AND r.id <> p_id AND v_job = ANY(r.job_ids)) THEN
      UPDATE public.jobs
         SET restricted_at = NULL,
             output_data = CASE WHEN output_data IS NULL THEN restricted_output_data -> 'output_data' ELSE output_data END,
             held_output_data = CASE WHEN held_output_data IS NULL THEN restricted_output_data -> 'held_output_data' ELSE held_output_data END,
             restricted_output_data = NULL,
             is_public = coalesce((v_row.prior -> 'jobs' -> v_job::text ->> 'is_public')::boolean, false)
       WHERE id = v_job AND restricted_at IS NOT NULL;
    END IF;
  END LOOP;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.lift_content_restriction(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
