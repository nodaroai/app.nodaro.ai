-- Immutable scene manifests and independently authorized binary artifacts.
-- These rows are an API implementation detail, not a direct Data API surface.
CREATE TABLE IF NOT EXISTS public.scene3d_artifacts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('glb', 'camera-track-json', 'poster', 'validation-report', 'blend-source', 'source-json')),
  bucket text NOT NULL CHECK (length(bucket) BETWEEN 3 AND 128),
  object_key text NOT NULL CHECK (length(object_key) BETWEEN 1 AND 512),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length > 0 AND byte_length <= 1073741824),
  -- The store's own tag for the exact bytes we hashed at receipt. Metadata
  -- immutability keeps the DIGEST honest; it says nothing about the object,
  -- which the producer can still overwrite at that key afterwards. Comparing
  -- this on every read is what turns "the digest we recorded" into "the bytes
  -- being served", cheaply enough to do it before a single byte is written.
  etag text NOT NULL CHECK (length(etag) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (id, user_id),
  UNIQUE (bucket, object_key)
);

CREATE TABLE IF NOT EXISTS public.scene3d_revisions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_id uuid REFERENCES public.workflows(id) ON DELETE CASCADE,
  source_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  parent_revision_id uuid,
  plan jsonb NOT NULL CHECK (coalesce((
    jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <= 1048576 AND
    plan->>'planType' = '3d-scene' AND plan->>'schemaVersion' IN ('1', '2') AND
    plan->>'revisionId' = id::text
  ), false)),
  plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

-- Composite foreign keys make cross-owner artifact substitution impossible,
-- including for accidental writes through the service-role connection.
CREATE TABLE IF NOT EXISTS public.scene3d_revision_artifacts (
  revision_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  user_id uuid NOT NULL,
  usage text NOT NULL CHECK (usage IN ('playback', 'poster', 'validation', 'source', 'checkpoint')),
  PRIMARY KEY (revision_id, artifact_id),
  FOREIGN KEY (revision_id, user_id) REFERENCES public.scene3d_revisions(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (artifact_id, user_id) REFERENCES public.scene3d_artifacts(id, user_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

-- Deleting metadata revokes access immediately. Retain a durable deletion task
-- so object cleanup survives a crash or user/workflow cascade.
--
-- Rows are never removed. Once an artifact id appears here its bytes are being
-- collected or already were, and the id is RETIRED: it may not be reserved,
-- re-uploaded or published again. Deleting the row on success would reopen the
-- one window nothing else can close — a cleanup worker holding a claim it has
-- not executed yet, while a new grant is minted for the same key.
CREATE TABLE IF NOT EXISTS public.scene3d_artifact_gc (
  artifact_id uuid PRIMARY KEY,
  bucket text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  resolved_at timestamptz,
  -- 'deleted': the object is gone. 'kept': a published artifact owns the key,
  -- so it must never be deleted. Both retire the id.
  resolution text CHECK (resolution IN ('deleted', 'kept')),
  CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);

-- A reservation made BEFORE an upload capability is issued: the exact owner,
-- job, revision, artifact, kind, bucket and key the builder may write. It is
-- what makes bytes from a build that never published collectable — without it
-- an abandoned upload is an object nothing in the database has heard of.
CREATE TABLE IF NOT EXISTS public.scene3d_upload_intents (
  artifact_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  revision_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('glb', 'camera-track-json', 'poster', 'validation-report', 'blend-source', 'source-json')),
  bucket text NOT NULL CHECK (length(bucket) BETWEEN 3 AND 128),
  object_key text NOT NULL CHECK (length(object_key) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- When the upload capability stops working.
  expires_at timestamptz NOT NULL,
  -- Expiry plus a grace period: the earliest moment the bytes may be swept.
  collect_after timestamptz NOT NULL CHECK (collect_after >= expires_at),
  -- Filled once the bytes have been read back and hashed by the platform.
  received_at timestamptz,
  receipt_sha256 text CHECK (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  receipt_byte_length bigint CHECK (receipt_byte_length > 0 AND receipt_byte_length <= 1073741824),
  receipt_etag text CHECK (length(receipt_etag) BETWEEN 1 AND 256),
  UNIQUE (bucket, object_key)
);

CREATE INDEX IF NOT EXISTS scene3d_artifacts_owner ON public.scene3d_artifacts(user_id);
CREATE INDEX IF NOT EXISTS scene3d_artifacts_source_job ON public.scene3d_artifacts(source_job_id);
CREATE INDEX IF NOT EXISTS scene3d_artifacts_expiry ON public.scene3d_artifacts(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS scene3d_revisions_owner ON public.scene3d_revisions(user_id);
CREATE INDEX IF NOT EXISTS scene3d_revisions_workflow ON public.scene3d_revisions(workflow_id);
CREATE INDEX IF NOT EXISTS scene3d_revisions_source_job ON public.scene3d_revisions(source_job_id);
CREATE INDEX IF NOT EXISTS scene3d_revision_artifacts_asset ON public.scene3d_revision_artifacts(artifact_id, user_id);
CREATE INDEX IF NOT EXISTS scene3d_artifact_gc_pending ON public.scene3d_artifact_gc(created_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS scene3d_upload_intents_collect ON public.scene3d_upload_intents(collect_after);
CREATE INDEX IF NOT EXISTS scene3d_upload_intents_revision ON public.scene3d_upload_intents(revision_id);

ALTER TABLE public.scene3d_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene3d_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene3d_revision_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene3d_artifact_gc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene3d_upload_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scene3d_artifacts, public.scene3d_revisions,
  public.scene3d_revision_artifacts, public.scene3d_artifact_gc,
  public.scene3d_upload_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scene3d_artifacts, public.scene3d_revisions,
  public.scene3d_revision_artifacts, public.scene3d_artifact_gc,
  public.scene3d_upload_intents TO service_role;

CREATE OR REPLACE FUNCTION public.scene3d_keep_revision_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (NEW.id, NEW.user_id, NEW.workflow_id, NEW.parent_revision_id, NEW.plan, NEW.plan_sha256, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.user_id, OLD.workflow_id, OLD.parent_revision_id, OLD.plan, OLD.plan_sha256, OLD.created_at) THEN
    RAISE EXCEPTION 'Scene revisions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.scene3d_keep_artifact_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (NEW.id, NEW.user_id, NEW.kind, NEW.bucket, NEW.object_key, NEW.sha256, NEW.byte_length, NEW.etag, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.user_id, OLD.kind, OLD.bucket, OLD.object_key, OLD.sha256, OLD.byte_length, OLD.etag, OLD.created_at) THEN
    RAISE EXCEPTION 'Scene artifacts are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.scene3d_enqueue_artifact_gc()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- A 'kept' row means a claim once found this key still published. If the
  -- artifact is being deleted now, that verdict is stale and the task has to
  -- go pending again — otherwise the bytes are orphaned by their own tombstone.
  -- A 'deleted' row is final.
  INSERT INTO public.scene3d_artifact_gc(artifact_id, bucket, object_key)
    VALUES (OLD.id, OLD.bucket, OLD.object_key)
  ON CONFLICT (artifact_id) DO UPDATE
    SET resolved_at = NULL, resolution = NULL, attempts = 0, last_attempt_at = NULL
    WHERE public.scene3d_artifact_gc.resolution = 'kept';
  RETURN OLD;
END;
$$;

-- An intent disappears either because publication consumed it or because it
-- expired. Only the second case leaves bytes behind: publication inserts the
-- artifact BEFORE deleting the intent, so the guard below sees the live row and
-- writes no cleanup task for bytes somebody is now allowed to read.
CREATE OR REPLACE FUNCTION public.scene3d_enqueue_intent_gc()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.scene3d_artifact_gc(artifact_id, bucket, object_key)
  SELECT OLD.artifact_id, OLD.bucket, OLD.object_key
  WHERE NOT EXISTS (
    SELECT 1 FROM public.scene3d_artifacts a
    WHERE a.bucket = OLD.bucket AND a.object_key = OLD.object_key
  )
  ON CONFLICT (artifact_id) DO NOTHING;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.scene3d_keep_revision_immutable(),
  public.scene3d_keep_artifact_immutable(), public.scene3d_enqueue_artifact_gc(),
  public.scene3d_enqueue_intent_gc() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scene3d_keep_revision_immutable(),
  public.scene3d_keep_artifact_immutable(), public.scene3d_enqueue_artifact_gc(),
  public.scene3d_enqueue_intent_gc() TO service_role;

DROP TRIGGER IF EXISTS scene3d_revision_immutable ON public.scene3d_revisions;
CREATE TRIGGER scene3d_revision_immutable BEFORE UPDATE ON public.scene3d_revisions
  FOR EACH ROW EXECUTE FUNCTION public.scene3d_keep_revision_immutable();
DROP TRIGGER IF EXISTS scene3d_artifact_immutable ON public.scene3d_artifacts;
CREATE TRIGGER scene3d_artifact_immutable BEFORE UPDATE ON public.scene3d_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.scene3d_keep_artifact_immutable();
DROP TRIGGER IF EXISTS scene3d_artifact_gc ON public.scene3d_artifacts;
CREATE TRIGGER scene3d_artifact_gc AFTER DELETE ON public.scene3d_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.scene3d_enqueue_artifact_gc();
DROP TRIGGER IF EXISTS scene3d_upload_intent_gc ON public.scene3d_upload_intents;
CREATE TRIGGER scene3d_upload_intent_gc AFTER DELETE ON public.scene3d_upload_intents
  FOR EACH ROW EXECUTE FUNCTION public.scene3d_enqueue_intent_gc();

-- ---------------------------------------------------------------------------
-- Publication, retention sweep and cleanup claim.
--
-- These three are functions rather than a sequence of PostgREST calls because
-- each one is atomic BY DEFINITION and nothing else can make it so: a manifest
-- published as "revision, then artifacts, then pins" has two windows in which a
-- crash leaves a scene that reads as valid and cannot be rendered. One
-- statement, one transaction, all-or-nothing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.scene3d_publish_revision(payload jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_revision_id uuid := (payload->>'revision_id')::uuid;
  v_user_id uuid := (payload->>'user_id')::uuid;
  v_workflow_id uuid := nullif(payload->>'workflow_id', '')::uuid;
  v_source_job_id uuid := nullif(payload->>'source_job_id', '')::uuid;
  v_parent_id uuid := nullif(payload->>'parent_revision_id', '')::uuid;
  v_plan jsonb := payload->'plan';
  v_plan_sha256 text := payload->>'plan_sha256';
  v_artifacts jsonb := coalesce(payload->'artifacts', '[]'::jsonb);
  v_entry jsonb;
  v_existing public.scene3d_artifacts%ROWTYPE;
  v_revision public.scene3d_revisions%ROWTYPE;
  v_key_holder uuid;
  v_have jsonb;
  v_wanted jsonb;
  v_require_intents boolean := coalesce((payload->>'require_intents')::boolean, false);
  v_intent public.scene3d_upload_intents%ROWTYPE;
  v_job_owner uuid;
  v_job_status text;
BEGIN
  IF v_revision_id IS NULL OR v_user_id IS NULL OR v_plan IS NULL OR v_plan_sha256 IS NULL THEN
    RAISE EXCEPTION 'scene3d publish payload is incomplete' USING ERRCODE = '55015';
  END IF;
  IF jsonb_array_length(v_artifacts) <> (
    SELECT count(DISTINCT e->>'artifact_id') FROM jsonb_array_elements(v_artifacts) e
  ) THEN
    RAISE EXCEPTION 'scene3d publish payload names the same artifact twice' USING ERRCODE = '55015';
  END IF;

  -- The pin's owner-scoped foreign key is DEFERRABLE INITIALLY DEFERRED, so a
  -- cross-owner pin would fail at COMMIT — after this function has already
  -- returned a success. Make the checks immediate so the transaction cannot
  -- outlive its own verdict, and pre-check anyway so the caller gets a reason
  -- rather than a bare 23503.
  SET CONSTRAINTS ALL IMMEDIATE;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_artifacts) LOOP
    SELECT * INTO v_existing FROM public.scene3d_artifacts
      WHERE id = (v_entry->>'artifact_id')::uuid;
    IF FOUND THEN
      IF v_existing.user_id <> v_user_id THEN
        RAISE EXCEPTION 'artifact % belongs to another owner', v_entry->>'artifact_id'
          USING ERRCODE = '55011';
      END IF;
      IF (v_existing.kind, v_existing.bucket, v_existing.object_key,
          v_existing.sha256, v_existing.byte_length, v_existing.etag)
         IS DISTINCT FROM
         (v_entry->>'kind', v_entry->>'bucket', v_entry->>'object_key',
          v_entry->>'sha256', (v_entry->>'byte_length')::bigint, v_entry->>'etag') THEN
        RAISE EXCEPTION 'artifact % is already bound to different bytes', v_entry->>'artifact_id'
          USING ERRCODE = '55012';
      END IF;
    ELSE
      IF coalesce((v_entry->>'reuse')::boolean, false) THEN
        RAISE EXCEPTION 'artifact % cannot be reused: it no longer exists', v_entry->>'artifact_id'
          USING ERRCODE = '55013';
      END IF;
      PERFORM public.scene3d_assert_artifact_id_live(
        (v_entry->>'artifact_id')::uuid, v_entry->>'bucket', v_entry->>'object_key');
      SELECT id INTO v_key_holder FROM public.scene3d_artifacts
        WHERE bucket = v_entry->>'bucket' AND object_key = v_entry->>'object_key';
      IF FOUND THEN
        RAISE EXCEPTION 'object key is already bound to artifact %', v_key_holder
          USING ERRCODE = '55014';
      END IF;
    END IF;
  END LOOP;

  -- Replay. Identical inputs are a no-op so a queue re-delivery is safe;
  -- anything different is a conflict, because a revision id that means two
  -- different scenes is exactly what "immutable" exists to prevent.
  SELECT * INTO v_revision FROM public.scene3d_revisions WHERE id = v_revision_id;
  IF FOUND THEN
    IF (v_revision.user_id, v_revision.workflow_id, v_revision.parent_revision_id,
        v_revision.plan, v_revision.plan_sha256)
       IS DISTINCT FROM (v_user_id, v_workflow_id, v_parent_id, v_plan, v_plan_sha256) THEN
      RAISE EXCEPTION 'revision % already exists with different content', v_revision_id
        USING ERRCODE = '55010';
    END IF;
    SELECT coalesce(jsonb_agg(pin ORDER BY pin->>'artifact_id'), '[]'::jsonb) INTO v_have
      FROM (
        SELECT jsonb_build_object('artifact_id', artifact_id::text, 'usage', usage) AS pin
        FROM public.scene3d_revision_artifacts WHERE revision_id = v_revision_id
      ) held;
    SELECT coalesce(jsonb_agg(pin ORDER BY pin->>'artifact_id'), '[]'::jsonb) INTO v_wanted
      FROM (
        SELECT jsonb_build_object('artifact_id', e->>'artifact_id', 'usage', e->>'usage') AS pin
        FROM jsonb_array_elements(v_artifacts) e
      ) asked;
    IF v_have IS DISTINCT FROM v_wanted THEN
      RAISE EXCEPTION 'revision % already exists with a different asset set', v_revision_id
        USING ERRCODE = '55010';
    END IF;
    RETURN 'unchanged';
  END IF;

  -- A NEW publication needs a live parent. The row is locked, so a
  -- cancellation cannot commit between reading the status and writing the
  -- scene. The replay above returns before this on purpose: re-delivering a
  -- publication that already succeeded stays idempotent whatever the job did
  -- afterwards.
  IF v_source_job_id IS NOT NULL THEN
    SELECT user_id, status INTO v_job_owner, v_job_status
      FROM public.jobs WHERE id = v_source_job_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'source job % no longer exists', v_source_job_id USING ERRCODE = '55016';
    END IF;
    IF v_job_owner IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'source job % belongs to another user', v_source_job_id USING ERRCODE = '55016';
    END IF;
    IF v_job_status IN ('failed', 'cancelled', 'canceled') THEN
      RAISE EXCEPTION 'a % job cannot publish a scene revision', v_job_status USING ERRCODE = '55016';
    END IF;
  END IF;

  INSERT INTO public.scene3d_artifacts
    (id, user_id, source_job_id, kind, bucket, object_key, sha256, byte_length, etag, expires_at)
  SELECT (e->>'artifact_id')::uuid, v_user_id, v_source_job_id, e->>'kind',
         e->>'bucket', e->>'object_key', e->>'sha256', (e->>'byte_length')::bigint,
         e->>'etag', nullif(e->>'expires_at', '')::timestamptz
  FROM jsonb_array_elements(v_artifacts) e
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.scene3d_revisions
    (id, user_id, workflow_id, source_job_id, parent_revision_id, plan, plan_sha256)
  VALUES (v_revision_id, v_user_id, v_workflow_id, v_source_job_id, v_parent_id, v_plan, v_plan_sha256);

  INSERT INTO public.scene3d_revision_artifacts (revision_id, artifact_id, user_id, usage)
  SELECT v_revision_id, (e->>'artifact_id')::uuid, v_user_id, e->>'usage'
  FROM jsonb_array_elements(v_artifacts) e;

  -- Consume the reservations these bytes were uploaded under, AFTER the
  -- artifact rows exist: the intent's cleanup trigger skips a key a live
  -- artifact owns, so publishing can never queue a deletion for bytes it just
  -- made readable. Locking the intent is also what a concurrent expiry sweep
  -- skips over.
  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_artifacts) LOOP
    CONTINUE WHEN coalesce((v_entry->>'reuse')::boolean, false);
    SELECT * INTO v_intent FROM public.scene3d_upload_intents
      WHERE artifact_id = (v_entry->>'artifact_id')::uuid FOR UPDATE;
    IF FOUND THEN
      IF (v_intent.user_id, v_intent.revision_id, v_intent.kind, v_intent.bucket, v_intent.object_key)
         IS DISTINCT FROM
         (v_user_id, v_revision_id, v_entry->>'kind', v_entry->>'bucket', v_entry->>'object_key') THEN
        RAISE EXCEPTION 'artifact % was reserved for different bytes', v_entry->>'artifact_id'
          USING ERRCODE = '55017';
      END IF;
      DELETE FROM public.scene3d_upload_intents WHERE artifact_id = v_intent.artifact_id;
    ELSE
      -- No reservation: either there never was one, or a sweep took it while
      -- this transaction was running. The second case is a retired id, and the
      -- check has to happen after the lock attempt above to see it.
      PERFORM public.scene3d_assert_artifact_id_live(
        (v_entry->>'artifact_id')::uuid, v_entry->>'bucket', v_entry->>'object_key');
      IF v_require_intents THEN
        RAISE EXCEPTION 'artifact % was published without a reservation', v_entry->>'artifact_id'
          USING ERRCODE = '55018';
      END IF;
    END IF;
  END LOOP;

  RETURN 'created';
END;
$$;

-- Expired AND unpinned only. Deleting row-by-row inside an exception block is
-- the point: a single set DELETE loses the whole batch when one candidate is
-- pinned by a revision published a millisecond ago, and retrying the batch
-- forever is not cleanup. The pin's foreign key is the real guarantee — this
-- function cannot delete bytes a retained revision needs even if its own
-- NOT EXISTS raced.
CREATE OR REPLACE FUNCTION public.scene3d_sweep_expired_artifacts(max_rows integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_removed integer := 0;
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  FOR v_id IN
    SELECT a.id FROM public.scene3d_artifacts a
    WHERE a.expires_at IS NOT NULL AND a.expires_at < now()
      AND NOT EXISTS (
        SELECT 1 FROM public.scene3d_revision_artifacts p WHERE p.artifact_id = a.id
      )
    ORDER BY a.expires_at
    LIMIT greatest(max_rows, 0)
  LOOP
    BEGIN
      DELETE FROM public.scene3d_artifacts WHERE id = v_id;
      v_removed := v_removed + 1;
    EXCEPTION WHEN foreign_key_violation THEN
      NULL; -- a revision pinned it while we were looking; it stays.
    END;
  END LOOP;
  RETURN v_removed;
END;
$$;

-- Claim cleanup tasks with an attempt clock. A worker that dies mid-delete
-- leaves the row claimed but not gone, and the next pass past `retry_after`
-- picks it up again — at-least-once, which is the correct semantics for an
-- idempotent object delete.
CREATE OR REPLACE FUNCTION public.scene3d_claim_artifact_gc(
  max_rows integer DEFAULT 50,
  retry_after interval DEFAULT interval '10 minutes'
)
RETURNS TABLE (artifact_id uuid, bucket text, object_key text, attempts integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Bytes a live artifact row names are never deletable, whatever queued the
  -- task. Resolved as 'kept' rather than removed: the row stays as the id's
  -- tombstone so nothing can reserve or republish it later.
  UPDATE public.scene3d_artifact_gc g
  SET resolved_at = now(), resolution = 'kept'
  WHERE g.resolved_at IS NULL AND EXISTS (
    SELECT 1 FROM public.scene3d_artifacts a
    WHERE a.bucket = g.bucket AND a.object_key = g.object_key
  );

  RETURN QUERY
  UPDATE public.scene3d_artifact_gc g
  -- clock_timestamp(), not now(): now() is the TRANSACTION's start time, so a
  -- worker that claims and re-claims inside one transaction would compare a
  -- stamp against itself and never age out. The claim clock has to be real
  -- time.
  SET attempts = g.attempts + 1, last_attempt_at = clock_timestamp()
  WHERE g.artifact_id IN (
    SELECT c.artifact_id FROM public.scene3d_artifact_gc c
    WHERE c.resolved_at IS NULL
      AND (c.last_attempt_at IS NULL OR c.last_attempt_at < clock_timestamp() - retry_after)
    ORDER BY c.created_at
    LIMIT greatest(max_rows, 0)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING g.artifact_id, g.bucket, g.object_key, g.attempts;
END;
$$;

-- ---------------------------------------------------------------------------
-- The upload lifetime, held in one transaction.
--
-- Reserving, extending and receiving all take the reservation's row lock, so a
-- concurrent expiry sweep (which claims with SKIP LOCKED) steps around an
-- in-flight grant instead of deleting it underneath one. The retirement check
-- is what makes the ordering safe in the other direction: once an id has a
-- cleanup row, no later transaction can bring it back.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.scene3d_assert_artifact_id_live(
  p_artifact_id uuid, p_bucket text, p_object_key text
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.scene3d_artifact_gc g
    WHERE g.artifact_id = p_artifact_id
       OR (g.bucket = p_bucket AND g.object_key = p_object_key)
  ) THEN
    RAISE EXCEPTION 'artifact % is retired: its bytes are being or have been collected', p_artifact_id
      USING ERRCODE = '55019';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.scene3d_reserve_upload(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_artifact_id uuid := (payload->>'artifact_id')::uuid;
  v_user_id uuid := (payload->>'user_id')::uuid;
  v_job_id uuid := nullif(payload->>'job_id', '')::uuid;
  v_revision_id uuid := (payload->>'revision_id')::uuid;
  v_kind text := payload->>'kind';
  v_bucket text := payload->>'bucket';
  v_object_key text := payload->>'object_key';
  v_expires_at timestamptz := (payload->>'expires_at')::timestamptz;
  v_collect_after timestamptz := (payload->>'collect_after')::timestamptz;
  v_existing public.scene3d_upload_intents%ROWTYPE;
  v_row public.scene3d_upload_intents%ROWTYPE;
BEGIN
  IF v_artifact_id IS NULL OR v_user_id IS NULL OR v_revision_id IS NULL
     OR v_kind IS NULL OR v_bucket IS NULL OR v_object_key IS NULL
     OR v_expires_at IS NULL OR v_collect_after IS NULL THEN
    RAISE EXCEPTION 'scene3d reservation payload is incomplete' USING ERRCODE = '55015';
  END IF;

  LOOP
    SELECT * INTO v_existing FROM public.scene3d_upload_intents
      WHERE artifact_id = v_artifact_id FOR UPDATE;
    IF FOUND THEN
      -- A re-grant may only ever extend the SAME reservation. A different job,
      -- owner, revision, kind or key is a different upload wearing a used id.
      IF (v_existing.user_id, v_existing.job_id, v_existing.revision_id,
          v_existing.kind, v_existing.bucket, v_existing.object_key)
         IS DISTINCT FROM (v_user_id, v_job_id, v_revision_id, v_kind, v_bucket, v_object_key) THEN
        RAISE EXCEPTION 'artifact % is already reserved for different bytes', v_artifact_id
          USING ERRCODE = '55021';
      END IF;
      UPDATE public.scene3d_upload_intents
      SET expires_at = greatest(expires_at, v_expires_at),
          collect_after = greatest(collect_after, v_collect_after)
      WHERE artifact_id = v_artifact_id
      RETURNING * INTO v_row;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'reservation for artifact % vanished while held', v_artifact_id
          USING ERRCODE = '55022';
      END IF;
      RETURN to_jsonb(v_row);
    END IF;

    -- Checked HERE, not before the loop. Under READ COMMITTED the statement
    -- above takes its own snapshot: if a sweep held this row and committed
    -- while we waited on it, its cleanup row is visible only to a statement
    -- that starts afterwards. Asking earlier would pass on a stale snapshot
    -- and revive an id a worker is already about to delete.
    PERFORM public.scene3d_assert_artifact_id_live(v_artifact_id, v_bucket, v_object_key);
    IF EXISTS (SELECT 1 FROM public.scene3d_artifacts a WHERE a.id = v_artifact_id) THEN
      RAISE EXCEPTION 'artifact % is already published and its bytes are immutable', v_artifact_id
        USING ERRCODE = '55020';
    END IF;

    BEGIN
      INSERT INTO public.scene3d_upload_intents
        (artifact_id, user_id, job_id, revision_id, kind, bucket, object_key, expires_at, collect_after)
      VALUES (v_artifact_id, v_user_id, v_job_id, v_revision_id, v_kind, v_bucket, v_object_key,
              v_expires_at, v_collect_after)
      RETURNING * INTO v_row;
      RETURN to_jsonb(v_row);
    EXCEPTION WHEN unique_violation THEN
      -- Somebody inserted between the read and the write; take the lock path.
      NULL;
    END;
  END LOOP;
END;
$$;

-- The receipt is written once, under the reservation's lock, and only for the
-- scope it was reserved under. A second read that finds different bytes is a
-- conflict rather than an overwrite: the first receipt is what publication
-- checks against.
CREATE OR REPLACE FUNCTION public.scene3d_record_upload_receipt(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_artifact_id uuid := (payload->>'artifact_id')::uuid;
  v_user_id uuid := (payload->>'user_id')::uuid;
  v_kind text := payload->>'kind';
  v_bucket text := payload->>'bucket';
  v_object_key text := payload->>'object_key';
  v_sha256 text := payload->>'sha256';
  v_byte_length bigint := (payload->>'byte_length')::bigint;
  v_etag text := payload->>'etag';
  v_row public.scene3d_upload_intents%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.scene3d_upload_intents
    WHERE artifact_id = v_artifact_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'artifact % has no upload reservation', v_artifact_id USING ERRCODE = '55023';
  END IF;
  IF (v_row.kind, v_row.bucket, v_row.object_key) IS DISTINCT FROM (v_kind, v_bucket, v_object_key) THEN
    RAISE EXCEPTION 'artifact % was verified outside the scope it was reserved for', v_artifact_id
      USING ERRCODE = '55021';
  END IF;

  IF v_row.receipt_sha256 IS NOT NULL THEN
    IF v_row.receipt_sha256 IS DISTINCT FROM v_sha256
       OR v_row.receipt_byte_length IS DISTINCT FROM v_byte_length THEN
      RAISE EXCEPTION 'artifact % changed after it was received', v_artifact_id USING ERRCODE = '55024';
    END IF;
    RETURN to_jsonb(v_row);
  END IF;

  UPDATE public.scene3d_upload_intents
  SET received_at = now(), receipt_sha256 = v_sha256,
      receipt_byte_length = v_byte_length, receipt_etag = v_etag
  WHERE artifact_id = v_artifact_id AND receipt_sha256 IS NULL
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'receipt for artifact % was written concurrently', v_artifact_id
      USING ERRCODE = '55024';
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;

-- Cleanup completion. The row stays as the id's tombstone.
CREATE OR REPLACE FUNCTION public.scene3d_complete_artifact_gc(p_artifact_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_done boolean;
BEGIN
  UPDATE public.scene3d_artifact_gc
  SET resolved_at = now(), resolution = 'deleted'
  WHERE artifact_id = p_artifact_id AND resolved_at IS NULL
  RETURNING true INTO v_done;
  RETURN coalesce(v_done, false);
END;
$$;

-- Reservations whose grant expired and whose grace period has passed. The
-- deletion trigger turns each into a cleanup task unless publication got there
-- first; SKIP LOCKED steps around an in-flight publication rather than fighting
-- it.
CREATE OR REPLACE FUNCTION public.scene3d_sweep_expired_upload_intents(max_rows integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_removed integer := 0;
BEGIN
  WITH doomed AS (
    SELECT i.artifact_id FROM public.scene3d_upload_intents i
    WHERE i.collect_after < now()
    ORDER BY i.collect_after
    LIMIT greatest(max_rows, 0)
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.scene3d_upload_intents i
  USING doomed d WHERE i.artifact_id = d.artifact_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END;
$$;

REVOKE ALL ON FUNCTION public.scene3d_publish_revision(jsonb),
  public.scene3d_sweep_expired_upload_intents(integer),
  public.scene3d_assert_artifact_id_live(uuid, text, text),
  public.scene3d_reserve_upload(jsonb),
  public.scene3d_record_upload_receipt(jsonb),
  public.scene3d_complete_artifact_gc(uuid),
  public.scene3d_sweep_expired_artifacts(integer),
  public.scene3d_claim_artifact_gc(integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scene3d_publish_revision(jsonb),
  public.scene3d_sweep_expired_upload_intents(integer),
  public.scene3d_assert_artifact_id_live(uuid, text, text),
  public.scene3d_reserve_upload(jsonb),
  public.scene3d_record_upload_receipt(jsonb),
  public.scene3d_complete_artifact_gc(uuid),
  public.scene3d_sweep_expired_artifacts(integer),
  public.scene3d_claim_artifact_gc(integer, interval) TO service_role;
