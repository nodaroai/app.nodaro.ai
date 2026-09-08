-- Server-owned copies of canonical video bytes. Gallery edits/deletion cannot
-- mutate these records or their object keys. One snapshot per owner/film/hash.
CREATE TABLE IF NOT EXISTS public.retained_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Billing identity, not lifetime ownership: a departing collaborator must
  -- not remove bytes still owned by a surviving workflow.
  user_id uuid NOT NULL,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length > 0 AND byte_length <= 524288000),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  duration_ms integer NOT NULL CHECK (duration_ms > 0),
  content_type text NOT NULL CHECK (content_type IN ('video/mp4','video/webm')),
  state text NOT NULL DEFAULT 'creating' CHECK (state IN ('creating','ready')),
  charged boolean NOT NULL,
  upload_until timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, workflow_id, sha256)
);
CREATE INDEX IF NOT EXISTS retained_videos_workflow ON public.retained_videos(workflow_id);
CREATE INDEX IF NOT EXISTS retained_videos_creating ON public.retained_videos(upload_until) WHERE state = 'creating';
ALTER TABLE public.retained_videos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retained_videos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.retained_videos TO service_role;

-- Tasks double as tombstones: a deleted id is never re-published. Quota is
-- refunded exactly once, only after the physical object has been removed.
CREATE TABLE IF NOT EXISTS public.retained_video_gc (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  byte_length bigint NOT NULL,
  charged boolean NOT NULL,
  not_before timestamptz NOT NULL,
  claimed_at timestamptz,
  completed_at timestamptz
);
ALTER TABLE public.retained_video_gc ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retained_video_gc FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.retained_video_gc TO service_role;
CREATE INDEX IF NOT EXISTS retained_video_gc_pending ON public.retained_video_gc(not_before) WHERE completed_at IS NULL;

CREATE OR REPLACE FUNCTION public.guard_retained_video() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.retained_video_gc WHERE id = NEW.id) THEN
      RAISE EXCEPTION 'A deleted snapshot id cannot be reused';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.id,NEW.user_id,NEW.workflow_id,NEW.sha256,NEW.byte_length,NEW.width,NEW.height,NEW.duration_ms,NEW.content_type,NEW.charged,NEW.upload_until,NEW.created_at)
      IS DISTINCT FROM
      (OLD.id,OLD.user_id,OLD.workflow_id,OLD.sha256,OLD.byte_length,OLD.width,OLD.height,OLD.duration_ms,OLD.content_type,OLD.charged,OLD.upload_until,OLD.created_at)
      OR (OLD.state = 'ready' AND NEW.state <> 'ready')
      OR (OLD.state = 'creating' AND NEW.state = 'ready' AND OLD.upload_until <= now()) THEN
      RAISE EXCEPTION 'Retained video metadata is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'ready'
    AND EXISTS (SELECT 1 FROM public.workflows WHERE id = OLD.workflow_id) THEN
    RAISE EXCEPTION 'A retained video cannot be deleted while its production exists';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.guard_retained_video() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_retained_video() TO service_role;
DROP TRIGGER IF EXISTS guard_retained_video ON public.retained_videos;
CREATE TRIGGER guard_retained_video BEFORE INSERT OR UPDATE OR DELETE ON public.retained_videos
FOR EACH ROW EXECUTE FUNCTION public.guard_retained_video();

CREATE OR REPLACE FUNCTION public.queue_retained_video_gc() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.retained_video_gc(id,user_id,byte_length,charged,not_before)
  VALUES (OLD.id,OLD.user_id,OLD.byte_length,OLD.charged,
    greatest(now() + interval '2 minutes', OLD.upload_until + interval '2 minutes'))
  ON CONFLICT (id) DO NOTHING;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.queue_retained_video_gc() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_retained_video_gc() TO service_role;
DROP TRIGGER IF EXISTS queue_retained_video_gc ON public.retained_videos;
CREATE TRIGGER queue_retained_video_gc AFTER DELETE ON public.retained_videos
FOR EACH ROW EXECUTE FUNCTION public.queue_retained_video_gc();

-- Taking the workflow lock before reserving serializes capture against deletion.
-- The caller has already authorized editing the workflow. quota_mode is supplied
-- by the server edition/payer configuration, never a public request field.
CREATE OR REPLACE FUNCTION public.reserve_retained_video(
  p_user_id uuid, p_workflow_id uuid, p_sha256 text, p_byte_length bigint,
  p_width integer, p_height integer, p_duration_ms integer, p_content_type text, p_quota_mode text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.retained_videos;
BEGIN
  IF p_quota_mode NOT IN ('none','track','enforce') OR p_quota_mode IS NULL
    OR p_byte_length IS NULL OR p_byte_length <= 0 OR p_byte_length > 524288000 THEN
    RAISE EXCEPTION 'Invalid retained video reservation';
  END IF;
  PERFORM 1 FROM public.workflows WHERE id = p_workflow_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workflow is unavailable'; END IF;
  -- Serialize the same owner's reservations, including their quota counter.
  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Video owner is unavailable'; END IF;
  SELECT * INTO v_row FROM public.retained_videos
    WHERE user_id = p_user_id AND workflow_id = p_workflow_id AND sha256 = p_sha256;
  IF FOUND THEN
    IF v_row.state = 'creating' AND v_row.upload_until <= now() + interval '30 seconds' THEN
      RAISE EXCEPTION 'Video capture expired; retry after cleanup';
    END IF;
    IF v_row.byte_length <> p_byte_length OR v_row.width <> p_width
      OR v_row.height <> p_height OR v_row.duration_ms <> p_duration_ms OR v_row.content_type <> p_content_type THEN
      RAISE EXCEPTION 'Retained video metadata does not match its hash';
    END IF;
    RETURN to_jsonb(v_row);
  END IF;
  IF p_quota_mode = 'enforce' THEN
    IF NOT public.reserve_storage_if_within_limit(p_user_id,p_byte_length) THEN
      RAISE EXCEPTION 'Storage limit exceeded';
    END IF;
  ELSIF p_quota_mode = 'track' THEN
    UPDATE public.profiles SET storage_used_bytes = coalesce(storage_used_bytes,0) + p_byte_length WHERE id = p_user_id;
  END IF;
  INSERT INTO public.retained_videos(user_id,workflow_id,sha256,byte_length,width,height,duration_ms,content_type,charged)
  VALUES(p_user_id,p_workflow_id,p_sha256,p_byte_length,p_width,p_height,p_duration_ms,p_content_type,p_quota_mode <> 'none')
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;
REVOKE ALL ON FUNCTION public.reserve_retained_video(uuid,uuid,text,bigint,integer,integer,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_retained_video(uuid,uuid,text,bigint,integer,integer,integer,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_retained_video(p_id uuid, p_sha256 text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.retained_videos SET state = 'ready'
    WHERE id = p_id AND sha256 = p_sha256 AND (state = 'ready' OR upload_until > now());
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.complete_retained_video(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_retained_video(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_retained_video_gc(p_limit integer DEFAULT 50)
RETURNS SETOF public.retained_video_gc
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.retained_videos WHERE id IN (
    SELECT id FROM public.retained_videos WHERE state = 'creating' AND upload_until < now()
    ORDER BY upload_until LIMIT greatest(0,least(p_limit,100)) FOR UPDATE SKIP LOCKED
  );
  RETURN QUERY UPDATE public.retained_video_gc SET claimed_at = now() WHERE id IN (
    SELECT id FROM public.retained_video_gc WHERE completed_at IS NULL AND not_before <= now()
      AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
    ORDER BY not_before LIMIT greatest(0,least(p_limit,100)) FOR UPDATE SKIP LOCKED
  ) RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.claim_retained_video_gc(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_retained_video_gc(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_retained_video_gc(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.retained_video_gc;
BEGIN
  SELECT * INTO v_row FROM public.retained_video_gc WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.completed_at IS NOT NULL OR v_row.claimed_at IS NULL THEN RETURN false; END IF;
  IF v_row.charged THEN
    UPDATE public.profiles SET storage_used_bytes = greatest(0,coalesce(storage_used_bytes,0)-v_row.byte_length)
      WHERE id = v_row.user_id;
  END IF;
  UPDATE public.retained_video_gc SET completed_at = now() WHERE id = p_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.complete_retained_video_gc(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_retained_video_gc(uuid) TO service_role;

-- A workflow DELETE cascades jobs. Refuse that cascade while retained bytes
-- are still needed by an active job; deleting a gallery entry is not a cancel.
CREATE OR REPLACE FUNCTION public.protect_active_retained_videos() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.retained_videos WHERE workflow_id = OLD.id)
    AND EXISTS (SELECT 1 FROM public.jobs WHERE workflow_id = OLD.id
      AND status IN ('pending','queued','processing','pending_review')) THEN
    RAISE EXCEPTION 'This production has active jobs using retained videos';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.protect_active_retained_videos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_active_retained_videos() TO service_role;
DROP TRIGGER IF EXISTS protect_active_retained_videos ON public.workflows;
CREATE TRIGGER protect_active_retained_videos BEFORE DELETE ON public.workflows
FOR EACH ROW EXECUTE FUNCTION public.protect_active_retained_videos();

-- A retained result keeps its server provenance even after gallery/job cleanup.
-- No FK to jobs/profiles: the destination workflow owns the retained lifetime.
CREATE TABLE IF NOT EXISTS public.retained_job_videos (
  job_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES public.retained_videos(id) ON DELETE CASCADE,
  submission_context jsonb NOT NULL CHECK (jsonb_typeof(submission_context) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retained_job_videos_workflow ON public.retained_job_videos(workflow_id);
ALTER TABLE public.retained_job_videos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retained_job_videos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.retained_job_videos TO service_role;

CREATE OR REPLACE FUNCTION public.preserve_retained_job_video() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Retained job video is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.workflows WHERE id = OLD.workflow_id) THEN
    RAISE EXCEPTION 'Retained job video belongs to an existing workflow';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.preserve_retained_job_video() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preserve_retained_job_video() TO service_role;
DROP TRIGGER IF EXISTS preserve_retained_job_video ON public.retained_job_videos;
CREATE TRIGGER preserve_retained_job_video BEFORE UPDATE OR DELETE ON public.retained_job_videos
FOR EACH ROW EXECUTE FUNCTION public.preserve_retained_job_video();

-- Call only after downloading the completed videoUrl and verifying its retained
-- bytes. The database rechecks that source and copies provenance itself.
CREATE OR REPLACE FUNCTION public.record_retained_job_video(
  p_user_id uuid, p_workflow_id uuid, p_job_id uuid, p_video_id uuid, p_source_url text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_record public.retained_job_videos; v_context jsonb;
BEGIN
  PERFORM 1 FROM public.workflows WHERE id = p_workflow_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_record FROM public.retained_job_videos
    WHERE job_id = p_job_id AND user_id = p_user_id AND workflow_id = p_workflow_id;
  IF FOUND THEN RETURN to_jsonb(v_record); END IF;
  SELECT submission_context INTO v_context FROM public.jobs
    WHERE id = p_job_id AND user_id = p_user_id AND workflow_id = p_workflow_id
      AND status = 'completed' AND job_type IN ('text-to-video','image-to-video')
      AND output_data->>'videoUrl' = p_source_url AND submission_context IS NOT NULL
    FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.retained_videos WHERE id = p_video_id AND user_id = p_user_id
    AND workflow_id = p_workflow_id AND state = 'ready' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.retained_job_videos(job_id,user_id,workflow_id,video_id,submission_context)
    VALUES (p_job_id,p_user_id,p_workflow_id,p_video_id,v_context)
    ON CONFLICT (job_id) DO NOTHING;
  SELECT * INTO v_record FROM public.retained_job_videos
    WHERE job_id = p_job_id AND user_id = p_user_id AND workflow_id = p_workflow_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_record);
END $$;
REVOKE ALL ON FUNCTION public.record_retained_job_video(uuid,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_retained_job_video(uuid,uuid,uuid,uuid,text) TO service_role;

-- Copy proofs have their own identity. They are not jobs and never grant a
-- review decision. Source context survives source workflow/job deletion.
CREATE TABLE IF NOT EXISTS public.retained_video_copies (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES public.retained_videos(id) ON DELETE CASCADE,
  source_workflow_id uuid NOT NULL,
  source_job_id uuid,
  source_copy_id uuid,
  source_context jsonb NOT NULL CHECK (jsonb_typeof(source_context) = 'object'),
  origin_workflow_id uuid NOT NULL,
  origin_job_id uuid NOT NULL,
  origin_submission_context jsonb NOT NULL CHECK (jsonb_typeof(origin_submission_context) = 'object'),
  context jsonb NOT NULL CHECK (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 262144),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source_job_id IS NULL) <> (source_copy_id IS NULL)),
  CHECK (id IS DISTINCT FROM source_copy_id)
);
CREATE INDEX IF NOT EXISTS retained_video_copies_workflow ON public.retained_video_copies(workflow_id);
ALTER TABLE public.retained_video_copies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retained_video_copies FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.retained_video_copies TO service_role;
DROP TRIGGER IF EXISTS preserve_retained_video_copy ON public.retained_video_copies;
CREATE TRIGGER preserve_retained_video_copy BEFORE UPDATE OR DELETE ON public.retained_video_copies
FOR EACH ROW EXECUTE FUNCTION public.preserve_retained_job_video();

-- The trusted integration authorizes source read + destination edit and
-- validates its mapped context. The database copies source proof itself and
-- verifies equal ready video hashes/dimensions within the two workflows.
CREATE OR REPLACE FUNCTION public.record_retained_video_copy(
  p_id uuid, p_user_id uuid, p_workflow_id uuid, p_video_id uuid,
  p_source_workflow_id uuid, p_source_job_id uuid, p_source_copy_id uuid, p_context jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_prior public.retained_video_copies;
  v_job public.retained_job_videos;
  v_copy public.retained_video_copies;
  v_source public.retained_videos;
  v_destination public.retained_videos;
  v_source_context jsonb; v_origin_context jsonb; v_origin_workflow uuid; v_origin_job uuid;
BEGIN
  IF (p_source_job_id IS NULL) = (p_source_copy_id IS NULL) OR p_id = p_source_copy_id
    OR p_context IS NULL OR jsonb_typeof(p_context) <> 'object' OR octet_length(p_context::text) > 262144 THEN
    RAISE EXCEPTION 'Invalid retained video copy' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.workflows WHERE id = p_workflow_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_prior FROM public.retained_video_copies WHERE id = p_id;
  IF FOUND THEN
    IF v_prior.user_id = p_user_id AND v_prior.workflow_id = p_workflow_id AND v_prior.video_id = p_video_id
      AND v_prior.source_workflow_id = p_source_workflow_id
      AND v_prior.source_job_id IS NOT DISTINCT FROM p_source_job_id
      AND v_prior.source_copy_id IS NOT DISTINCT FROM p_source_copy_id AND v_prior.context = p_context THEN
      RETURN to_jsonb(v_prior);
    END IF;
    RAISE EXCEPTION 'Retained video copy conflict' USING ERRCODE = '23505';
  END IF;
  PERFORM 1 FROM public.workflows WHERE id = p_source_workflow_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_source_job_id IS NOT NULL THEN
    SELECT * INTO v_job FROM public.retained_job_videos
      WHERE workflow_id = p_source_workflow_id AND job_id = p_source_job_id FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO v_source FROM public.retained_videos
      WHERE id = v_job.video_id AND workflow_id = p_source_workflow_id AND state = 'ready' FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_source_context := v_job.submission_context;
    v_origin_context := v_job.submission_context;
    v_origin_workflow := v_job.workflow_id; v_origin_job := v_job.job_id;
  ELSE
    SELECT * INTO v_copy FROM public.retained_video_copies
      WHERE workflow_id = p_source_workflow_id AND id = p_source_copy_id FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO v_source FROM public.retained_videos
      WHERE id = v_copy.video_id AND workflow_id = p_source_workflow_id AND state = 'ready' FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_source_context := v_copy.context;
    v_origin_context := v_copy.origin_submission_context;
    v_origin_workflow := v_copy.origin_workflow_id; v_origin_job := v_copy.origin_job_id;
  END IF;
  SELECT * INTO v_destination FROM public.retained_videos
    WHERE id = p_video_id AND workflow_id = p_workflow_id AND user_id = p_user_id AND state = 'ready' FOR SHARE;
  IF NOT FOUND OR v_source.sha256 <> v_destination.sha256
    OR v_source.byte_length <> v_destination.byte_length OR v_source.width <> v_destination.width
    OR v_source.height <> v_destination.height OR v_source.duration_ms <> v_destination.duration_ms OR v_source.content_type <> v_destination.content_type THEN RETURN NULL; END IF;
  INSERT INTO public.retained_video_copies(id,user_id,workflow_id,video_id,source_workflow_id,source_job_id,source_copy_id,
    source_context,origin_workflow_id,origin_job_id,origin_submission_context,context)
    VALUES (p_id,p_user_id,p_workflow_id,p_video_id,p_source_workflow_id,p_source_job_id,p_source_copy_id,
      v_source_context,v_origin_workflow,v_origin_job,v_origin_context,p_context)
    ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_prior FROM public.retained_video_copies WHERE id = p_id;
  IF v_prior.user_id IS DISTINCT FROM p_user_id OR v_prior.workflow_id <> p_workflow_id OR v_prior.video_id <> p_video_id
    OR v_prior.source_workflow_id <> p_source_workflow_id
    OR v_prior.source_job_id IS DISTINCT FROM p_source_job_id
    OR v_prior.source_copy_id IS DISTINCT FROM p_source_copy_id OR v_prior.context <> p_context THEN
    RAISE EXCEPTION 'Retained video copy conflict' USING ERRCODE = '23505';
  END IF;
  RETURN to_jsonb(v_prior);
END $$;
REVOKE ALL ON FUNCTION public.record_retained_video_copy(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_retained_video_copy(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb) TO service_role;
