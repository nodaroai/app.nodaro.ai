-- 480_storage_key_and_pointer_ownership.sql
--
-- Rows that name storage keys are written by the server only, and a job (or a
-- pipeline asset) points only at its own user's pipeline and parent job
-- (decided 2026-10-06). The same class as 469 (app_runs) and 474 (jobs,
-- workflow_executions). The decisions round (decided 2026-10-07) adds
-- `characters` to the server-written tables, drops `share_workflow_assets`,
-- and holds a pipeline entity's asset pointers to its owner's assets; round 2
-- (decided 2026-10-07) adds the entity's last frame and its variants' images.
--
-- A row says where a file is, not whose it is. The storage reapers (free-tier
-- and canceled-user retention, the soft-deleted location sweep) and the
-- permanent deletes find the keys they delete in rows: `assets.r2_key`, and
-- the url columns of `locations`, `creatures` and `objects`. Until now the
-- browser roles kept INSERT, UPDATE and DELETE on all four tables, with owner
-- policies that checked `user_id` only — so a signed-in client could write its
-- own row naming ANY key, and a deleter acting for that client then deleted
-- another user's file.
--
-- Every write path was checked first, read-only: the editor and the
-- published-app runtime never write these tables (the three studios subscribe
-- to Realtime UPDATEs on locations, creatures and objects, which needs SELECT
-- only); studio.nodaro.ai, person, recast and the extension have no table
-- access; the cloud plugins write none of them. Every write is the backend's
-- service role. So the browser roles lose every write, as 469 and 474 did;
-- every SELECT policy stays.
--
-- What a grant cannot do — rows already written, and the API paths that still
-- store a url the caller names (a library save, an uploaded entity image) — is
-- handled in code: every deleter asks whose object a key is before deleting it
-- (backend/src/lib/key-ownership.ts). A key in another user's job key family
-- or upload namespace, or one another user's `assets` row holds, is never
-- deleted on this user's behalf.
--
-- The SECURITY DEFINER functions that edit these rows are part of the same
-- write surface: Postgres grants EXECUTE to PUBLIC by default and PostgREST
-- exposes every function in `public`, so they are locked to the backend here
-- (the lockdown 170 and 206 gave the append_* functions).

-- ---------------------------------------------------------------------------
-- Count first, before any lock: rows that already name another user's object.
--
-- They are counted, not changed (decided 2026-10-07). A planted row's
-- dangerous part is its key reaching a deleter, and every deleter now asks
-- whose object a key is at delete time (key-ownership.ts). That makes a row
-- inert when the object it names carries a claim: another user's job key
-- family, upload namespace, or an `assets` row of theirs. A row naming an
-- object nobody claims (an orphan no library holds) is NOT inert — a deleter
-- acting for the row's owner still deletes that object. Nulling keys would
-- cost something real: a library save of another user's output
-- (routes/library.ts) stores that user's key on purpose and looks the same in
-- the table, and the maker's permanent delete counts rows by `r2_key` to keep
-- an object another row still shows. The counts say whether the hole was used.
--
-- "Another user's object" mirrors key-ownership.ts: the key's stem (basename
-- without extension) is a job id or `<jobId>-<suffix>` of a job whose user is
-- someone else, the key sits under `uploads/[handoff/]<kind>/<userId>/` of
-- someone else, or another user's `assets` row names the same key (for
-- locations, creatures, objects and characters: the same url).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_assets INT;
  v_shared INT;
  v_rows   INT;
BEGIN
  WITH k AS (
    SELECT a.user_id,
           a.r2_key,
           regexp_replace(regexp_replace(a.r2_key, '^.*/', ''), '^(.+)\.[^.]*$', '\1') AS stem
    FROM public.assets a
  ), c AS (
    SELECT k.user_id,
           k.r2_key,
           CASE
             WHEN left(k.stem, 36) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  AND (length(k.stem) = 36 OR substr(k.stem, 37, 1) = '-')
             THEN left(k.stem, 36)::uuid
           END AS job_id,
           substring(k.r2_key from '^uploads/(?:handoff/)?[^/]+/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/') AS ns_owner
    FROM k
  )
  SELECT COUNT(*) INTO v_assets
  FROM c
  WHERE (c.ns_owner IS NOT NULL AND lower(c.ns_owner) <> c.user_id::text)
     OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = c.job_id AND j.user_id <> c.user_id);

  RAISE NOTICE 'assets rows naming another user''s object (kept; the deleters no longer delete such a key for the row owner): %', v_assets;

  -- A key two or more users' rows name. Which row is the maker's cannot be
  -- told for a key with no job family or namespace (a plain upload), so this
  -- counts every such row, the maker's included; a library save of another
  -- user's output is one too. Uncorrelated, so it is hashed once rather than
  -- probed per row (`assets.r2_key` has no index of its own until 481).
  SELECT COUNT(*) INTO v_shared
  FROM public.assets a
  WHERE a.r2_key IN (
    SELECT o.r2_key FROM public.assets o
    WHERE o.r2_key IS NOT NULL
    GROUP BY o.r2_key
    HAVING count(DISTINCT o.user_id) > 1
  );

  RAISE NOTICE 'assets rows whose key another user''s row also names (kept; the deleters keep such a key for every holder): %', v_shared;

  WITH r AS (
    SELECT l.user_id, to_jsonb(l)::text AS body FROM public.locations l
    UNION ALL SELECT c.user_id, to_jsonb(c)::text FROM public.creatures c
    UNION ALL SELECT o.user_id, to_jsonb(o)::text FROM public.objects o
    UNION ALL SELECT ch.user_id, to_jsonb(ch)::text FROM public.characters ch
  ), numbered AS (
    SELECT row_number() OVER () AS n, r.user_id, r.body FROM r
  ), family AS (
    SELECT DISTINCT nb.n
    FROM numbered nb
    CROSS JOIN LATERAL regexp_matches(nb.body, '/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:-[^/".\s]*)?\.[A-Za-z0-9]+', 'g') AS m(hit)
    JOIN public.jobs j ON j.id = m.hit[1]::uuid
    WHERE j.user_id <> nb.user_id
  ), namespace AS (
    SELECT DISTINCT nb.n
    FROM numbered nb
    CROSS JOIN LATERAL regexp_matches(nb.body, 'uploads/(?:handoff/)?[^/"]+/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/', 'g') AS m(hit)
    WHERE lower(m.hit[1]) <> nb.user_id::text
  ), held AS (
    -- Every quoted url in the row, matched against the urls of other users'
    -- library rows (`assets.r2_url` is the public url `r2_key` is served at).
    -- Like the shared-key count above, this cannot tell the maker's row from
    -- a copy: a row naming its own upload that another user saved counts too.
    SELECT DISTINCT nb.n
    FROM numbered nb
    CROSS JOIN LATERAL regexp_matches(nb.body, '"(https?://[^"]+)"', 'g') AS m(hit)
    JOIN public.assets o ON o.r2_url = m.hit[1]
    WHERE o.user_id <> nb.user_id
  )
  SELECT COUNT(*) INTO v_rows FROM (SELECT n FROM family UNION SELECT n FROM namespace UNION SELECT n FROM held) x;

  RAISE NOTICE 'location, creature, object and character rows naming another user''s object (kept; the deleters no longer delete such a key for the row owner): %', v_rows;
END $$;

-- ---------------------------------------------------------------------------
-- The browser roles write none of the four tables, nor `characters`.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can insert assets with restrictions" ON public.assets;
DROP POLICY IF EXISTS "Users can update own assets or admins can update library" ON public.assets;
DROP POLICY IF EXISTS "Users can delete own assets or admins can delete library" ON public.assets;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.assets FROM anon, authenticated;

DROP POLICY IF EXISTS locations_insert ON public.locations;
DROP POLICY IF EXISTS locations_update ON public.locations;
DROP POLICY IF EXISTS locations_delete ON public.locations;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.locations FROM anon, authenticated;

DROP POLICY IF EXISTS creatures_insert ON public.creatures;
DROP POLICY IF EXISTS creatures_update ON public.creatures;
DROP POLICY IF EXISTS creatures_delete ON public.creatures;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.creatures FROM anon, authenticated;

DROP POLICY IF EXISTS objects_insert ON public.objects;
DROP POLICY IF EXISTS objects_update ON public.objects;
DROP POLICY IF EXISTS objects_delete ON public.objects;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.objects FROM anon, authenticated;

-- `characters` has the same row shape: url columns (`source_image_url`, the
-- angle, expression and pose arrays) a client could set to any key. No deleter
-- harvests them today, but the rows are server-written all the same (decided
-- 2026-10-07). Checked read-only first: the editor only SELECTs one row
-- (character-node.tsx reads the LoRA fields) and subscribes to Realtime
-- UPDATEs (SELECT only); studio.nodaro.ai, person, recast, voice and the
-- extension have no table access; the cloud plugins write through the
-- backend's service role. Its one policy (032's "Users can CRUD own characters
-- via project", FOR ALL) also serves SELECT, so it stays; without the grants
-- it admits no write. The definer functions that edit characters were locked
-- to the backend in 200, 207 and 226.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.characters FROM anon, authenticated;

-- The row-edit functions. Each takes the row's owner as an ARGUMENT, so a
-- browser able to call one edits any user's location, creature or object;
-- the backend's service role is the only caller.
REVOKE EXECUTE ON FUNCTION public.remove_location_asset(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.remove_location_asset(uuid, uuid, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.remove_creature_asset(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.remove_creature_asset(uuid, uuid, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.remove_object_asset(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.remove_object_asset(uuid, uuid, text, text) TO service_role;

-- share_workflow_assets (022) sets `assets.is_shared` on every asset id in
-- the named workflow, with no owner check, and 020's SELECT policy then shows
-- that row (r2_url included) to every user. Nothing calls it: not the
-- backend, the editor, studio, the extension, the cloud plugins or another
-- migration (checked 2026-10-07). Dropped (decided 2026-10-07).
DROP FUNCTION IF EXISTS public.share_workflow_assets(uuid);

-- ---------------------------------------------------------------------------
-- Job pointers to pipelines and parent jobs, and an asset's pipeline pointer.
--
-- 474 took job writes from the browser; these pointers were browser-written
-- before it (and assets' until this migration). The server reads them with the
-- service role: a pipeline's progress from its jobs, a failed entity's image
-- from its assets. Every legitimate writer stamps the owner's own user — a
-- pipeline's jobs and assets are written as `pipelines.user_id`, a child job
-- copies its parent's user — so a mismatch is never ours. Count, then detach:
-- the pointer goes, the row stays as its user's own.
--
-- `jobs.workflow_id` is NOT in this set: an app run's job carries the runner's
-- user and the creator's workflow, and a node route stamps the workflow its
-- request names, so a cross-user pointer there is legitimate. Every read of
-- jobs by workflow_id filters the reader's user instead.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_pipeline INT;
  v_parent   INT;
  v_assets   INT;
BEGIN
  SELECT COUNT(*) INTO v_pipeline
  FROM public.jobs j JOIN public.pipelines p ON p.id = j.pipeline_id
  WHERE j.user_id IS DISTINCT FROM p.user_id;

  SELECT COUNT(*) INTO v_parent
  FROM public.jobs j JOIN public.jobs parent ON parent.id = j.parent_job_id
  WHERE j.user_id IS DISTINCT FROM parent.user_id;

  SELECT COUNT(*) INTO v_assets
  FROM public.assets a JOIN public.pipelines p ON p.id = a.pipeline_id
  WHERE a.user_id IS DISTINCT FROM p.user_id;

  RAISE NOTICE 'jobs pointing at another user''s pipeline: % (detached below)', v_pipeline;
  RAISE NOTICE 'jobs pointing at another user''s parent job: % (detached below)', v_parent;
  RAISE NOTICE 'assets pointing at another user''s pipeline: % (detached below)', v_assets;
END $$;

UPDATE public.jobs j
SET pipeline_id = NULL
FROM public.pipelines p
WHERE p.id = j.pipeline_id AND j.user_id IS DISTINCT FROM p.user_id;

UPDATE public.jobs j
SET parent_job_id = NULL
FROM public.jobs parent
WHERE parent.id = j.parent_job_id AND j.user_id IS DISTINCT FROM parent.user_id;

-- pipeline_entity_id goes with it: 121's denorm trigger derives pipeline_id
-- from the entity, so an entity of the same foreign pipeline would put it back.
UPDATE public.assets a
SET pipeline_id = NULL, pipeline_entity_id = NULL
FROM public.pipelines p
WHERE p.id = a.pipeline_id AND a.user_id IS DISTINCT FROM p.user_id;

-- ---------------------------------------------------------------------------
-- The invariant, for every writer — the service role included. Deleting a
-- pipeline sets these pointers to NULL (121), which passes; deleting a parent
-- job deletes its children (001), which is not an UPDATE.
--
-- An UPDATE is checked only when it changes a pointer or the user. Deleting a
-- pipeline runs two referential actions on an entity-linked asset —
-- `pipeline_id` SET NULL and, through the entity's cascade,
-- `pipeline_entity_id` SET NULL — in an order fixed by constraint creation.
-- Were the entity's to run first, the row would still carry the deleted
-- pipeline's id, and an unconditional check would refuse the pipeline (and
-- account) delete. A pointer that did not change was checked when written.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.jobs_pointer_owner_check()
RETURNS TRIGGER AS $$
DECLARE
  v_user_changed boolean := TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id;
BEGIN
  IF NEW.pipeline_id IS NOT NULL
     AND (v_user_changed OR NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id)
     AND NOT EXISTS (
    SELECT 1 FROM public.pipelines p
    WHERE p.id = NEW.pipeline_id AND p.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'jobs.pipeline_id must name a pipeline its user owns'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.parent_job_id IS NOT NULL
     AND (v_user_changed OR NEW.parent_job_id IS DISTINCT FROM OLD.parent_job_id)
     AND NOT EXISTS (
    SELECT 1 FROM public.jobs parent
    WHERE parent.id = NEW.parent_job_id AND parent.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'jobs.parent_job_id must name a job of the same user'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION public.jobs_pointer_owner_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jobs_pointer_owner ON public.jobs;
CREATE TRIGGER trg_jobs_pointer_owner
  BEFORE INSERT OR UPDATE OF pipeline_id, parent_job_id, user_id ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.jobs_pointer_owner_check();

-- Runs after 121's `assets_pipeline_denorm` (triggers fire in name order), so
-- it sees the pipeline_id derived from pipeline_entity_id.
CREATE OR REPLACE FUNCTION public.assets_pipeline_owner_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.pipeline_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id
          OR NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id)
     AND NOT EXISTS (
    SELECT 1 FROM public.pipelines p
    WHERE p.id = NEW.pipeline_id AND p.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'assets.pipeline_id must name a pipeline its user owns'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION public.assets_pipeline_owner_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_assets_pipeline_owner ON public.assets;
CREATE TRIGGER trg_assets_pipeline_owner
  BEFORE INSERT OR UPDATE OF pipeline_id, pipeline_entity_id, user_id ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.assets_pipeline_owner_check();

-- ---------------------------------------------------------------------------
-- A pipeline entity's asset pointers (decided 2026-10-07).
--
-- `pipeline_entities.main_asset_id` and `metadata.last_attempted_asset_id`
-- name an `assets` row by id. The server reads them with the service role and
-- turns them into a reference image, a canvas node's picture, an entity
-- card's URL, or (force-approve) the entity's adopted main image. Every
-- legitimate writer stores an asset the pipeline's owner made: a stage's own
-- generation, the critic loop's own attempt, the asset row the upload attach
-- inserts for the caller, a branch's copy of the same user's pipeline. Browser
-- roles cannot write the table in practice (since 359 they cannot read
-- `pipelines`, which its owner policy asks).
--
-- Round 2 (decided 2026-10-07) adds the same pointer class's other two
-- members: `pipeline_entities.last_frame_asset_id` (a scene's last extracted
-- frame, copied into a branch) and `pipeline_entity_variants.asset_id` (a
-- character's or location's variant image, fed to keyframe generation as an
-- identity reference and shown on the entity card). Their writers store the
-- frame the pipeline's own extract made and the variant its own generation
-- made, both as the pipeline's owner.
--
-- Round 3 (decided 2026-10-07) adds the asset ids a scene keeps inside
-- `metadata.scene_node_data`: each shot's `keyframe_asset_id`,
-- `video_asset_id`, `last_frame_asset_id`, `audio_asset_id` and
-- `lipsynced_asset_id`, the scene's `composite_video_asset_id`, and the
-- `asset_id` of its asset refs (`scene_anchor_keyframe`,
-- `generated_keyframes[]`, `generated_clips[]`, `composite_video`,
-- `last_frame`, `scene_audio_track`). The rule is by key, not by list: any key
-- named `asset_id` or ending in `_asset_id`, at any depth, so a field the
-- schema adds later is covered too. Only a uuid-shaped value names an asset;
-- anything else is ignored. Their writers are Stage 5's Scene Director (an
-- LLM, whose output the trigger now bounds), a seeded pipeline (the caller's
-- scene data), Stage 6 and 7 and the per-shot routes (assets their own
-- generation just made, as the pipeline's owner), and a branch (a copy).
--
-- Rows written before this migration are counted, not changed (decided
-- 2026-10-07): every read now asks for the owner's asset
-- (backend/src/lib/pipeline-asset-ownership.ts), so such a pointer resolves to
-- nothing; and clearing `main_asset_id` would fire 132's cascade-staleness
-- trigger on every entity that depends on it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_main      INT;
  v_attempt   INT;
  v_lastframe INT;
  v_variant   INT;
  v_scene     INT;
BEGIN
  SELECT COUNT(*) INTO v_main
  FROM public.pipeline_entities e
  JOIN public.pipelines p ON p.id = e.pipeline_id
  JOIN public.assets a ON a.id = e.main_asset_id
  WHERE a.user_id IS DISTINCT FROM p.user_id;

  SELECT COUNT(*) INTO v_attempt
  FROM public.pipeline_entities e
  JOIN public.pipelines p ON p.id = e.pipeline_id
  JOIN public.assets a ON a.id::text = e.metadata->>'last_attempted_asset_id'
  WHERE a.user_id IS DISTINCT FROM p.user_id;

  SELECT COUNT(*) INTO v_lastframe
  FROM public.pipeline_entities e
  JOIN public.pipelines p ON p.id = e.pipeline_id
  JOIN public.assets a ON a.id = e.last_frame_asset_id
  WHERE a.user_id IS DISTINCT FROM p.user_id;

  SELECT COUNT(*) INTO v_variant
  FROM public.pipeline_entity_variants v
  JOIN public.pipeline_entities e ON e.id = v.entity_id
  JOIN public.pipelines p ON p.id = e.pipeline_id
  JOIN public.assets a ON a.id = v.asset_id
  WHERE a.user_id IS DISTINCT FROM p.user_id;

  -- A scene counts once however many of its pointers are foreign. The cast is
  -- guarded by CASE so a value that is not a uuid never reaches it.
  SELECT COUNT(*) INTO v_scene
  FROM public.pipeline_entities e
  JOIN public.pipelines p ON p.id = e.pipeline_id
  WHERE e.metadata ? 'scene_node_data'
    AND EXISTS (
      SELECT 1
      FROM jsonb_path_query(
             e.metadata->'scene_node_data',
             'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "(^|_)asset_id$" && @.value.type() == "string").value'
           ) AS ptr(v)
      JOIN public.assets a
        ON a.id = CASE WHEN ptr.v #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       THEN (ptr.v #>> '{}')::uuid END
      WHERE a.user_id IS DISTINCT FROM p.user_id
    );

  RAISE NOTICE 'pipeline entities whose main_asset_id names another user''s asset (kept; every read asks for the owner''s asset): %', v_main;
  RAISE NOTICE 'pipeline entities whose last_attempted_asset_id names another user''s asset (kept; every read asks for the owner''s asset): %', v_attempt;
  RAISE NOTICE 'pipeline entities whose last_frame_asset_id names another user''s asset (kept; every read asks for the owner''s asset): %', v_lastframe;
  RAISE NOTICE 'pipeline entity variants whose asset_id names another user''s asset (kept; every read asks for the owner''s asset): %', v_variant;
  RAISE NOTICE 'scene entities whose scene_node_data names another user''s asset (kept; no read resolves those ids to a url or a file): %', v_scene;
END $$;

-- The invariant, for every writer — the service role included. Like the two
-- triggers above it checks only a pointer that changed (or a move to another
-- pipeline, which also judges the entity's variants' images): deleting an asset sets `main_asset_id` / `last_frame_asset_id`
-- NULL (121), which passes, and a metadata write that keeps the same
-- `last_attempted_asset_id` is not judged again. A `last_attempted_asset_id`
-- that is not a uuid names no asset and is refused (the two columns are uuid
-- typed, so they can hold nothing else).
CREATE OR REPLACE FUNCTION public.pipeline_entities_asset_owner_check()
RETURNS TRIGGER AS $$
DECLARE
  v_moved       boolean := TG_OP = 'INSERT' OR NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id;
  v_attempt     text := NEW.metadata->>'last_attempted_asset_id';
  v_old_attempt text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.metadata->>'last_attempted_asset_id' END;
  v_scene       jsonb := NEW.metadata->'scene_node_data';
  v_old_scene   jsonb := CASE WHEN TG_OP = 'UPDATE' THEN OLD.metadata->'scene_node_data' END;
  v_owner       uuid;
BEGIN
  SELECT p.user_id INTO v_owner FROM public.pipelines p WHERE p.id = NEW.pipeline_id;

  IF NEW.main_asset_id IS NOT NULL
     AND (v_moved OR NEW.main_asset_id IS DISTINCT FROM OLD.main_asset_id)
     AND NOT EXISTS (
    SELECT 1 FROM public.assets a
    WHERE a.id = NEW.main_asset_id AND a.user_id = v_owner
  ) THEN
    RAISE EXCEPTION 'pipeline_entities.main_asset_id must name an asset of the pipeline''s owner'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.last_frame_asset_id IS NOT NULL
     AND (v_moved OR NEW.last_frame_asset_id IS DISTINCT FROM OLD.last_frame_asset_id)
     AND NOT EXISTS (
    SELECT 1 FROM public.assets a
    WHERE a.id = NEW.last_frame_asset_id AND a.user_id = v_owner
  ) THEN
    RAISE EXCEPTION 'pipeline_entities.last_frame_asset_id must name an asset of the pipeline''s owner'
      USING ERRCODE = '42501';
  END IF;

  IF v_attempt IS NOT NULL
     AND (v_moved OR v_attempt IS DISTINCT FROM v_old_attempt)
     AND (v_attempt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          OR NOT EXISTS (
            SELECT 1 FROM public.assets a
            WHERE a.id = v_attempt::uuid AND a.user_id = v_owner
          )) THEN
    RAISE EXCEPTION 'pipeline_entities.metadata.last_attempted_asset_id must name an asset of the pipeline''s owner'
      USING ERRCODE = '42501';
  END IF;

  -- A scene's asset ids in `metadata.scene_node_data` (round 3, decided
  -- 2026-10-07): every key named `asset_id` or ending in `_asset_id`, at any
  -- depth. Only a uuid-shaped value names an asset; anything else is skipped.
  -- What changed is judged by value, not by position: an id the row already
  -- held (anywhere in its scene data) is not judged again, so reordering the
  -- shots, or keeping an id whose asset was since deleted (a JSON pointer has
  -- no SET NULL), passes; an insert or a move judges every id.
  IF v_scene IS NOT NULL
     AND (v_moved OR v_scene IS DISTINCT FROM v_old_scene)
     AND EXISTS (
    SELECT 1
    FROM (
      SELECT CASE WHEN q.v #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  THEN (q.v #>> '{}')::uuid END AS id
      FROM jsonb_path_query(
             v_scene,
             'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "(^|_)asset_id$" && @.value.type() == "string").value'
           ) AS q(v)
      EXCEPT
      SELECT CASE WHEN q.v #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  THEN (q.v #>> '{}')::uuid END
      FROM jsonb_path_query(
             CASE WHEN v_moved THEN NULL ELSE v_old_scene END,
             'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "(^|_)asset_id$" && @.value.type() == "string").value'
           ) AS q(v)
    ) AS changed
    LEFT JOIN public.assets a ON a.id = changed.id AND a.user_id = v_owner
    WHERE changed.id IS NOT NULL AND a.id IS NULL
  ) THEN
    RAISE EXCEPTION 'pipeline_entities.metadata.scene_node_data must name only assets of the pipeline''s owner'
      USING ERRCODE = '42501';
  END IF;

  -- A move carries the entity's variants with it, and their rows do not
  -- change, so the variant trigger below never sees it: their images are
  -- judged here, against the new pipeline's owner (review round, decided
  -- 2026-10-07). A variant with no image pins nothing.
  IF TG_OP = 'UPDATE' AND NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id
     AND EXISTS (
    SELECT 1 FROM public.pipeline_entity_variants v
    LEFT JOIN public.assets a ON a.id = v.asset_id AND a.user_id = v_owner
    WHERE v.entity_id = NEW.id AND v.asset_id IS NOT NULL AND a.id IS NULL
  ) THEN
    RAISE EXCEPTION 'pipeline_entity_variants.asset_id must name an asset of the pipeline''s owner (the entity moved to another pipeline)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION public.pipeline_entities_asset_owner_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pipeline_entities_asset_owner ON public.pipeline_entities;
CREATE TRIGGER trg_pipeline_entities_asset_owner
  BEFORE INSERT OR UPDATE OF main_asset_id, last_frame_asset_id, metadata, pipeline_id ON public.pipeline_entities
  FOR EACH ROW
  EXECUTE FUNCTION public.pipeline_entities_asset_owner_check();

-- A variant's image (round 2, decided 2026-10-07). The owner is the pipeline's,
-- through the variant's entity. Checked on insert, on a new asset, and on a
-- move to another entity (whose pipeline may be another user's). The entity's
-- own move to another pipeline leaves this row unchanged, so the entity's
-- trigger above judges its variants then. Deleting the
-- asset sets `asset_id` NULL (121), which passes; deleting the entity or the
-- pipeline deletes the variant, which is not an UPDATE.
CREATE OR REPLACE FUNCTION public.pipeline_entity_variants_asset_owner_check()
RETURNS TRIGGER AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF NEW.asset_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
          OR NEW.asset_id IS DISTINCT FROM OLD.asset_id) THEN
    SELECT p.user_id INTO v_owner
    FROM public.pipeline_entities e
    JOIN public.pipelines p ON p.id = e.pipeline_id
    WHERE e.id = NEW.entity_id;

    IF NOT EXISTS (
      SELECT 1 FROM public.assets a
      WHERE a.id = NEW.asset_id AND a.user_id = v_owner
    ) THEN
      RAISE EXCEPTION 'pipeline_entity_variants.asset_id must name an asset of the pipeline''s owner'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION public.pipeline_entity_variants_asset_owner_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pipeline_entity_variants_asset_owner ON public.pipeline_entity_variants;
CREATE TRIGGER trg_pipeline_entity_variants_asset_owner
  BEFORE INSERT OR UPDATE OF asset_id, entity_id ON public.pipeline_entity_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.pipeline_entity_variants_asset_owner_check();
