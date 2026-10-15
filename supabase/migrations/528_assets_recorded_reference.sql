-- 528: `assets.recorded_reference` — whether a library row only RECORDS a url
-- someone named, written once, at insert, and never changed (decided
-- 2026-10-15, review of the library ownership fix).
--
-- WHY. A permanent delete (and every retention reaper) deletes the object a
-- user's `assets` row names only when the user provably made it, and refunds
-- the row's size only when that size was a charge. For a key with no maker in
-- its name — an upload, an import, a social download — the proof is the row
-- the storing path wrote when it stored the bytes (backend/src/lib/key-ownership.ts).
-- A row that only RECORDS a url (a library save, a pipeline entity's attached
-- image, a generation's row for a url its output repeated, a relayed output)
-- is never that proof.
--
-- The backend used to tell the two apart from the row's columns at read time.
-- Those columns change after the fact: `pipeline_entity_id` and `pipeline_id`
-- are ON DELETE SET NULL (121), so deleting a pipeline turned its attached
-- images into rows that read like uploads; `job_id` is ON DELETE SET NULL
-- too; an admin's promote/demote rewrites `upload_source`. The answer is now
-- computed by the database when the row is inserted, from the row as its
-- writer wrote it, and frozen.
--
-- THE CLASSIFICATION (`asset_recorded_reference_by_shape`). A row is a
-- recorded reference when:
--   - it is a relayed output (`relay_job_id`): the bytes are the far end's;
--   - its source has no storing path behind it (`api`, `generation`,
--     `library`, none);
--   - it has neither a job nor a size: its writer stored nothing;
--   - it is a `manual_upload` pointing at a pipeline (an entity's attached
--     image), or naming a key no upload path mints
--     (`uploads/<image|video|audio|data>s/<uuid>.<ext>`);
--   - it is a generation's row (`generated`) for a key outside its job's
--     family (`<jobId>` / `<jobId>-<suffix>` as the key's stem), or — its job
--     since deleted — a key that is not a job output in the worker's folders.
-- A row naming no key records nothing. A writer may set the flag itself; the
-- classification can only add to it.
--
-- The backend's twin (`recordedReferenceByShape`, used only while a database
-- lacks this column — staging runs dev code against the shared database
-- before main applies this migration) and this function are held to one
-- golden table: backend/src/lib/__tests__/key-ownership-proof.test.ts and
-- supabase/tests/assets-recorded-reference.behavior.sql.
--
-- IMMUTABLE. After insert nobody — the service role included — may change the
-- flag, hand the row to another user, or point it at another key (clearing
-- the key, as the reapers do when they delete the object, stays allowed).
-- Browser roles cannot write `assets` at all (480).
--
-- THE BACKFILL classifies every existing row once, by the same function.
-- A read-only dry run of it against production (2026-10-15, the backend twin
-- over all 30,890 rows) flags 229: 76 size-less job-less rows (library saves,
-- one attached image), 3 attached images still pointing at their pipeline,
-- 46 `generated` rows naming a url outside their own job's family, and 104
-- rows of unknown provenance (`api`, no writer left). No `manual_upload` row
-- outside a pipeline names a key no upload path mints, and none of the 104
-- sized `generated` rows whose job was deleted names a key outside the
-- worker's output folders: no row a storing path wrote changes standing.
-- `assets_updated_at` is held off for the backfill so it does not stamp every
-- row as edited.

ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS recorded_reference boolean;

COMMENT ON COLUMN public.assets.recorded_reference IS
  'true: the row records a url someone named (a library save, an attached image, an echoed or relayed output) and is never proof of whose the object is, nor was its size a charge. Computed at insert by asset_recorded_reference_by_shape (migration 528); immutable.';

CREATE OR REPLACE FUNCTION public.asset_recorded_reference_by_shape(
  p_r2_key text,
  p_job_id uuid,
  p_size_bytes bigint,
  p_pipeline_id uuid,
  p_pipeline_entity_id uuid,
  p_relay_job_id text,
  p_upload_source text
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base text;
  v_stem text;
  v_job text;
BEGIN
  IF p_r2_key IS NULL OR p_r2_key = '' THEN
    RETURN false;
  END IF;
  IF coalesce(p_relay_job_id, '') <> '' THEN
    RETURN true;
  END IF;
  IF coalesce(p_upload_source, '') NOT IN
     ('manual_upload', 'generated', 'url_import', 'social_download', 'media_process', 'job') THEN
    RETURN true;
  END IF;
  IF p_job_id IS NULL AND coalesce(p_size_bytes, 0) <= 0 THEN
    RETURN true;
  END IF;
  IF p_upload_source = 'manual_upload' THEN
    RETURN p_pipeline_entity_id IS NOT NULL
        OR p_pipeline_id IS NOT NULL
        OR p_r2_key !~* '^uploads/(image|video|audio|data)s/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]+$';
  END IF;
  IF p_upload_source = 'generated' THEN
    IF p_job_id IS NULL THEN
      RETURN p_r2_key !~* '^(images|videos|audios|audio)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-[^/]*)?(\.[^./]*)?$';
    END IF;
    -- The job's key family (lib/job-policy-outputs.ts isOwnedObjectKey): the
    -- key's stem — its last segment, less the extension after its last dot —
    -- is the job id or starts with the job id and a dash. Case-sensitive on
    -- the stem, as there.
    v_base := regexp_replace(p_r2_key, '^.*/', '');
    v_stem := regexp_replace(v_base, '^(.+)\.[^.]*$', '\1');
    v_job := p_job_id::text;
    RETURN NOT (v_stem = v_job OR left(v_stem, length(v_job) + 1) = v_job || '-');
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.asset_recorded_reference_by_shape(text, uuid, bigint, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.asset_recorded_reference_by_shape(text, uuid, bigint, uuid, uuid, text, text) TO service_role;

-- Re-running after a partial failure: the immutability trigger must not be in
-- place while the backfill writes the column.
DROP TRIGGER IF EXISTS trg_assets_recorded_reference_immutable ON public.assets;

ALTER TABLE public.assets DISABLE TRIGGER assets_updated_at;
UPDATE public.assets
SET recorded_reference = public.asset_recorded_reference_by_shape(
  r2_key, job_id, size_bytes, pipeline_id, pipeline_entity_id, relay_job_id, upload_source
)
WHERE recorded_reference IS NULL;
ALTER TABLE public.assets ENABLE TRIGGER assets_updated_at;

ALTER TABLE public.assets ALTER COLUMN recorded_reference SET DEFAULT false;
ALTER TABLE public.assets ALTER COLUMN recorded_reference SET NOT NULL;

-- Stamped on every insert, from the row as its writer wrote it. Named to fire
-- after 121's `assets_pipeline_denorm` and 480's `trg_assets_pipeline_owner`
-- (BEFORE triggers fire in name order), so it sees the derived pipeline_id.
CREATE OR REPLACE FUNCTION public.assets_stamp_recorded_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.recorded_reference := coalesce(NEW.recorded_reference, false)
    OR public.asset_recorded_reference_by_shape(
      NEW.r2_key, NEW.job_id, NEW.size_bytes, NEW.pipeline_id, NEW.pipeline_entity_id, NEW.relay_job_id, NEW.upload_source
    );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assets_stamp_recorded_reference() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_assets_recorded_reference_stamp ON public.assets;
CREATE TRIGGER trg_assets_recorded_reference_stamp
  BEFORE INSERT ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.assets_stamp_recorded_reference();

-- Frozen after insert, for every writer.
CREATE OR REPLACE FUNCTION public.assets_recorded_reference_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.recorded_reference IS DISTINCT FROM OLD.recorded_reference THEN
    RAISE EXCEPTION 'assets.recorded_reference is written once, at insert'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'an assets row never changes hands'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.r2_key IS NOT NULL AND NEW.r2_key IS DISTINCT FROM OLD.r2_key THEN
    RAISE EXCEPTION 'an assets row''s key can be cleared, never pointed elsewhere'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assets_recorded_reference_immutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_assets_recorded_reference_immutable
  BEFORE UPDATE OF recorded_reference, user_id, r2_key ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.assets_recorded_reference_immutable();
