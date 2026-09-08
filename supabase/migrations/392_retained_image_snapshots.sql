-- Server-owned copies of canonical image bytes. Gallery edits/deletion cannot
-- mutate these records or their object keys. One snapshot per owner/film/hash.
CREATE TABLE IF NOT EXISTS public.retained_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Billing identity, not lifetime ownership: a departing collaborator must
  -- not remove bytes still owned by a surviving workflow.
  user_id uuid NOT NULL,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length > 0 AND byte_length <= 26214400),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  content_type text NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  state text NOT NULL DEFAULT 'creating' CHECK (state IN ('creating','ready')),
  charged boolean NOT NULL,
  upload_until timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, workflow_id, sha256)
);
CREATE INDEX IF NOT EXISTS retained_images_workflow ON public.retained_images(workflow_id);
CREATE INDEX IF NOT EXISTS retained_images_creating ON public.retained_images(upload_until) WHERE state = 'creating';
ALTER TABLE public.retained_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retained_images FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.retained_images TO service_role;

-- Tasks double as tombstones: a deleted id is never re-published. Quota is
-- refunded exactly once, only after the physical object has been removed.
CREATE TABLE IF NOT EXISTS public.retained_image_gc (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  byte_length bigint NOT NULL,
  charged boolean NOT NULL,
  not_before timestamptz NOT NULL,
  claimed_at timestamptz,
  completed_at timestamptz
);
ALTER TABLE public.retained_image_gc ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retained_image_gc FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.retained_image_gc TO service_role;
CREATE INDEX IF NOT EXISTS retained_image_gc_pending ON public.retained_image_gc(not_before) WHERE completed_at IS NULL;

CREATE OR REPLACE FUNCTION public.guard_retained_image() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.retained_image_gc WHERE id = NEW.id) THEN
      RAISE EXCEPTION 'A deleted snapshot id cannot be reused';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.id,NEW.user_id,NEW.workflow_id,NEW.sha256,NEW.byte_length,NEW.width,NEW.height,NEW.content_type,NEW.charged,NEW.upload_until,NEW.created_at)
      IS DISTINCT FROM
      (OLD.id,OLD.user_id,OLD.workflow_id,OLD.sha256,OLD.byte_length,OLD.width,OLD.height,OLD.content_type,OLD.charged,OLD.upload_until,OLD.created_at)
      OR (OLD.state = 'ready' AND NEW.state <> 'ready')
      OR (OLD.state = 'creating' AND NEW.state = 'ready' AND OLD.upload_until <= now()) THEN
      RAISE EXCEPTION 'Retained image metadata is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'ready'
    AND EXISTS (SELECT 1 FROM public.workflows WHERE id = OLD.workflow_id) THEN
    RAISE EXCEPTION 'A retained image cannot be deleted while its production exists';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.guard_retained_image() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_retained_image() TO service_role;
DROP TRIGGER IF EXISTS guard_retained_image ON public.retained_images;
CREATE TRIGGER guard_retained_image BEFORE INSERT OR UPDATE OR DELETE ON public.retained_images
FOR EACH ROW EXECUTE FUNCTION public.guard_retained_image();

CREATE OR REPLACE FUNCTION public.queue_retained_image_gc() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.retained_image_gc(id,user_id,byte_length,charged,not_before)
  VALUES (OLD.id,OLD.user_id,OLD.byte_length,OLD.charged,
    greatest(now() + interval '2 minutes', OLD.upload_until + interval '2 minutes'))
  ON CONFLICT (id) DO NOTHING;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.queue_retained_image_gc() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_retained_image_gc() TO service_role;
DROP TRIGGER IF EXISTS queue_retained_image_gc ON public.retained_images;
CREATE TRIGGER queue_retained_image_gc AFTER DELETE ON public.retained_images
FOR EACH ROW EXECUTE FUNCTION public.queue_retained_image_gc();

-- Taking the workflow lock before reserving serializes capture against deletion.
-- The caller has already authorized editing the workflow. quota_mode is supplied
-- by the server edition/payer configuration, never a public request field.
CREATE OR REPLACE FUNCTION public.reserve_retained_image(
  p_user_id uuid, p_workflow_id uuid, p_sha256 text, p_byte_length bigint,
  p_width integer, p_height integer, p_content_type text, p_quota_mode text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.retained_images;
BEGIN
  IF p_quota_mode NOT IN ('none','track','enforce') OR p_quota_mode IS NULL
    OR p_byte_length IS NULL OR p_byte_length <= 0 OR p_byte_length > 26214400 THEN
    RAISE EXCEPTION 'Invalid retained image reservation';
  END IF;
  PERFORM 1 FROM public.workflows WHERE id = p_workflow_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workflow is unavailable'; END IF;
  -- Serialize the same owner's reservations, including their quota counter.
  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Image owner is unavailable'; END IF;
  SELECT * INTO v_row FROM public.retained_images
    WHERE user_id = p_user_id AND workflow_id = p_workflow_id AND sha256 = p_sha256;
  IF FOUND THEN
    IF v_row.state = 'creating' AND v_row.upload_until <= now() + interval '30 seconds' THEN
      RAISE EXCEPTION 'Image capture expired; retry after cleanup';
    END IF;
    IF v_row.byte_length <> p_byte_length OR v_row.width <> p_width
      OR v_row.height <> p_height OR v_row.content_type <> p_content_type THEN
      RAISE EXCEPTION 'Retained image metadata does not match its hash';
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
  INSERT INTO public.retained_images(user_id,workflow_id,sha256,byte_length,width,height,content_type,charged)
  VALUES(p_user_id,p_workflow_id,p_sha256,p_byte_length,p_width,p_height,p_content_type,p_quota_mode <> 'none')
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;
REVOKE ALL ON FUNCTION public.reserve_retained_image(uuid,uuid,text,bigint,integer,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_retained_image(uuid,uuid,text,bigint,integer,integer,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_retained_image(p_id uuid, p_sha256 text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.retained_images SET state = 'ready'
    WHERE id = p_id AND sha256 = p_sha256 AND (state = 'ready' OR upload_until > now());
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.complete_retained_image(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_retained_image(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_retained_image_gc(p_limit integer DEFAULT 50)
RETURNS SETOF public.retained_image_gc
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.retained_images WHERE id IN (
    SELECT id FROM public.retained_images WHERE state = 'creating' AND upload_until < now()
    ORDER BY upload_until LIMIT greatest(0,least(p_limit,100)) FOR UPDATE SKIP LOCKED
  );
  RETURN QUERY UPDATE public.retained_image_gc SET claimed_at = now() WHERE id IN (
    SELECT id FROM public.retained_image_gc WHERE completed_at IS NULL AND not_before <= now()
      AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
    ORDER BY not_before LIMIT greatest(0,least(p_limit,100)) FOR UPDATE SKIP LOCKED
  ) RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.claim_retained_image_gc(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_retained_image_gc(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_retained_image_gc(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.retained_image_gc;
BEGIN
  SELECT * INTO v_row FROM public.retained_image_gc WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.completed_at IS NOT NULL OR v_row.claimed_at IS NULL THEN RETURN false; END IF;
  IF v_row.charged THEN
    UPDATE public.profiles SET storage_used_bytes = greatest(0,coalesce(storage_used_bytes,0)-v_row.byte_length)
      WHERE id = v_row.user_id;
  END IF;
  UPDATE public.retained_image_gc SET completed_at = now() WHERE id = p_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.complete_retained_image_gc(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_retained_image_gc(uuid) TO service_role;

-- A workflow DELETE cascades jobs. Refuse that cascade while retained bytes
-- are still needed by an active job; deleting a gallery entry is not a cancel.
CREATE OR REPLACE FUNCTION public.protect_active_retained_images() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.retained_images WHERE workflow_id = OLD.id)
    AND EXISTS (SELECT 1 FROM public.jobs WHERE workflow_id = OLD.id
      AND status IN ('pending','queued','processing','pending_review')) THEN
    RAISE EXCEPTION 'This production has active jobs using retained images';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.protect_active_retained_images() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_active_retained_images() TO service_role;
DROP TRIGGER IF EXISTS protect_active_retained_images ON public.workflows;
CREATE TRIGGER protect_active_retained_images BEFORE DELETE ON public.workflows
FOR EACH ROW EXECUTE FUNCTION public.protect_active_retained_images();
