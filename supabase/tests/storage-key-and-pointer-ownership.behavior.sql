-- ============================================================================
-- Behavioral proof: the browser writes no row that names a storage key, and a
-- job (or a pipeline asset) points only at its own user's pipeline and parent
-- job (migration 480, decided 2026-10-06). The decisions round (decided
-- 2026-10-07) adds `characters`, the dropped `share_workflow_assets`, and a
-- pipeline entity's asset pointers; round 2 (decided 2026-10-07) adds the
-- entity's `last_frame_asset_id` and a variant's `asset_id`; round 3 (decided
-- 2026-10-07) the asset ids inside a scene's `metadata.scene_node_data`.
--
-- The storage reapers and permanent deletes take the keys they delete from
-- `assets`, `locations`, `creatures` and `objects` rows. Before 480 a
-- signed-in client could write its own row in any of them (and `characters`)
-- naming any key.
-- Grants, policies and triggers are not provable from SQL text, so this runs
-- the real privilege system.
--
-- Own uuid range ...-0000000e7401 upward.
-- Run against the migrated disposable database, never the shared cloud project.
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, actual text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual, '<null>'), coalesce(expected, '<null>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- A (victim) and B (attacker), each with a project, a pipeline and a job.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000e7401', 'victim@storage-owner.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e7402', 'attacker@storage-owner.test', '{}', 'authenticated', 'authenticated');
INSERT INTO projects (id, user_id, name) VALUES
  ('c0000000-0000-4000-8000-0000000e7401', '00000000-0000-4000-8000-0000000e7401', 'victim project'),
  ('c0000000-0000-4000-8000-0000000e7402', '00000000-0000-4000-8000-0000000e7402', 'attacker project');
INSERT INTO pipelines (id, user_id, root_node_id, pipeline_type, activation_mode, mode, input_prompt, target_duration_seconds, format) VALUES
  ('a0000000-0000-4000-8000-0000000e7401', '00000000-0000-4000-8000-0000000e7401', 'root', 'story_to_video', 'interactive', 'manual', 'victim story', 30, 'short_film'),
  ('a0000000-0000-4000-8000-0000000e7402', '00000000-0000-4000-8000-0000000e7402', 'root', 'story_to_video', 'interactive', 'manual', 'attacker story', 30, 'short_film'),
  ('a0000000-0000-4000-8000-0000000e7403', '00000000-0000-4000-8000-0000000e7401', 'root', 'story_to_video', 'interactive', 'manual', 'victim story 2', 30, 'short_film'),
  ('a0000000-0000-4000-8000-0000000e7404', '00000000-0000-4000-8000-0000000e7401', 'root', 'story_to_video', 'interactive', 'manual', 'victim story 3', 30, 'short_film');
INSERT INTO pipeline_entities (id, pipeline_id, entity_type, entity_key) VALUES
  ('b0000000-0000-4000-8000-0000000e7401', 'a0000000-0000-4000-8000-0000000e7401', 'character', 'hero'),
  ('b0000000-0000-4000-8000-0000000e7402', 'a0000000-0000-4000-8000-0000000e7402', 'character', 'thief'),
  ('b0000000-0000-4000-8000-0000000e7404', 'a0000000-0000-4000-8000-0000000e7404', 'character', 'villain');
INSERT INTO jobs (id, user_id, job_type, status, output_data) VALUES
  ('f0000000-0000-4000-8000-0000000e7401', '00000000-0000-4000-8000-0000000e7401', 'generate-image', 'completed',
   '{"imageUrl":"https://media.example/images/f0000000-0000-4000-8000-0000000e7401.png"}'),
  ('f0000000-0000-4000-8000-0000000e7402', '00000000-0000-4000-8000-0000000e7402', 'generate-image', 'completed', '{}');
INSERT INTO assets (id, user_id, type, filename, mime_type, size_bytes, r2_key, r2_url) VALUES
  ('a5000000-0000-4000-8000-0000000e7402', '00000000-0000-4000-8000-0000000e7402', 'image', 'own.png', 'image/png', 10,
   'uploads/images/own.png', 'https://media.example/uploads/images/own.png');
INSERT INTO locations (id, user_id, name) VALUES
  ('e1000000-0000-4000-8000-0000000e7402', '00000000-0000-4000-8000-0000000e7402', 'attacker location');
-- The victim's location, creature and object, each holding one generated
-- angle, and the victim's library asset the attacker names in a workflow.
INSERT INTO locations (id, user_id, name, angles) VALUES
  ('e1000000-0000-4000-8000-0000000e7401', '00000000-0000-4000-8000-0000000e7401', 'victim location',
   '[{"name":"front","url":"https://media.example/images/victim-angle.png"}]');
INSERT INTO creatures (id, user_id, name, angles) VALUES
  ('e2000000-0000-4000-8000-0000000e7401', '00000000-0000-4000-8000-0000000e7401', 'victim creature',
   '[{"name":"front","url":"https://media.example/images/victim-angle.png"}]');
INSERT INTO objects (id, user_id, name, angles) VALUES
  ('e3000000-0000-4000-8000-0000000e7401', '00000000-0000-4000-8000-0000000e7401', 'victim object',
   '[{"name":"front","url":"https://media.example/images/victim-angle.png"}]');
INSERT INTO assets (id, user_id, type, filename, mime_type, size_bytes, r2_key, r2_url) VALUES
  ('a5000000-0000-4000-8000-0000000e7401', '00000000-0000-4000-8000-0000000e7401', 'image', 'private.png', 'image/png', 10,
   'uploads/images/private.png', 'https://media.example/uploads/images/private.png');
INSERT INTO characters (id, project_id, user_id, name) VALUES
  ('e4000000-0000-4000-8000-0000000e7402', 'c0000000-0000-4000-8000-0000000e7402', '00000000-0000-4000-8000-0000000e7402', 'attacker character');
INSERT INTO workflows (id, user_id, project_id, name, nodes) VALUES
  ('d0000000-0000-4000-8000-0000000e7402', '00000000-0000-4000-8000-0000000e7402', 'c0000000-0000-4000-8000-0000000e7402',
   'attacker workflow', '[{"assetId":"a5000000-0000-4000-8000-0000000e7401"}]');

-- -------------------------------------------------------------- the browser
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e7402","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000e7402';

-- 1. THE HOLE: the attacker's own asset row, naming the victim's file, with a
--    size the reaper would also "free".
DO $$ BEGIN
  INSERT INTO public.assets (user_id, type, filename, mime_type, size_bytes, r2_key, r2_url)
  VALUES ('00000000-0000-4000-8000-0000000e7402', 'image', 'x.png', 'image/png', 1000000,
          'images/f0000000-0000-4000-8000-0000000e7401.png', 'https://media.example/images/f0000000-0000-4000-8000-0000000e7401.png');
  RAISE EXCEPTION 'ASSERT FAIL: a browser planted an asset row naming another user''s file';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot insert an asset row';
END $$;

-- 2. Nor re-point its own row at someone else's key, nor delete one.
DO $$ BEGIN
  UPDATE public.assets SET r2_key = 'images/f0000000-0000-4000-8000-0000000e7401.png'
   WHERE id = 'a5000000-0000-4000-8000-0000000e7402';
  RAISE EXCEPTION 'ASSERT FAIL: a browser re-pointed its own asset row';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot update an asset row';
END $$;
DO $$ BEGIN
  DELETE FROM public.assets WHERE id = 'a5000000-0000-4000-8000-0000000e7402';
  RAISE EXCEPTION 'ASSERT FAIL: a browser deleted an asset row';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot delete an asset row';
END $$;

-- 3. The same for a location (its url columns are reaped), a creature and an object.
DO $$ BEGIN
  UPDATE public.locations SET source_image_url = 'https://media.example/images/f0000000-0000-4000-8000-0000000e7401.png'
   WHERE id = 'e1000000-0000-4000-8000-0000000e7402';
  RAISE EXCEPTION 'ASSERT FAIL: a browser wrote a url into its own location';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot write its own location';
END $$;
DO $$ BEGIN
  INSERT INTO public.locations (user_id, name, source_image_url)
  VALUES ('00000000-0000-4000-8000-0000000e7402', 'planted', 'https://media.example/images/f0000000-0000-4000-8000-0000000e7401.png');
  RAISE EXCEPTION 'ASSERT FAIL: a browser inserted a location';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot insert a location';
END $$;
DO $$ BEGIN
  INSERT INTO public.creatures (user_id, name) VALUES ('00000000-0000-4000-8000-0000000e7402', 'planted');
  RAISE EXCEPTION 'ASSERT FAIL: a browser inserted a creature';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot insert a creature';
END $$;
DO $$ BEGIN
  INSERT INTO public.objects (user_id, name) VALUES ('00000000-0000-4000-8000-0000000e7402', 'planted');
  RAISE EXCEPTION 'ASSERT FAIL: a browser inserted an object';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot insert an object';
END $$;

-- 3b. Nor through the SECURITY DEFINER row-edit functions (review round,
--     decided 2026-10-07). Each takes the owner as an argument, so a browser
--     that could call one would edit the VICTIM's row; and
--     share_workflow_assets marks every asset id in a named workflow shared,
--     with no owner check. Only the backend (service role) calls the first
--     three; nothing calls the fourth.
DO $$ BEGIN
  PERFORM public.remove_location_asset('e1000000-0000-4000-8000-0000000e7401', '00000000-0000-4000-8000-0000000e7401',
    'angles', 'https://media.example/images/victim-angle.png');
  RAISE EXCEPTION 'ASSERT FAIL: a browser stripped an entry from another user''s location';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot call remove_location_asset';
END $$;
DO $$ BEGIN
  PERFORM public.remove_creature_asset('e2000000-0000-4000-8000-0000000e7401', '00000000-0000-4000-8000-0000000e7401',
    'angles', 'https://media.example/images/victim-angle.png');
  RAISE EXCEPTION 'ASSERT FAIL: a browser stripped an entry from another user''s creature';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot call remove_creature_asset';
END $$;
DO $$ BEGIN
  PERFORM public.remove_object_asset('e3000000-0000-4000-8000-0000000e7401', '00000000-0000-4000-8000-0000000e7401',
    'angles', 'https://media.example/images/victim-angle.png');
  RAISE EXCEPTION 'ASSERT FAIL: a browser stripped an entry from another user''s object';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot call remove_object_asset';
END $$;
-- share_workflow_assets is gone (decided 2026-10-07), not just revoked.
SELECT pg_temp.assert_eq('share_workflow_assets no longer exists',
  (to_regprocedure('public.share_workflow_assets(uuid)') IS NULL)::text, 'true');

-- 3c. Nor a character (decided 2026-10-07): the same url columns, the same rule.
DO $$ BEGIN
  INSERT INTO public.characters (project_id, user_id, name, source_image_url)
  VALUES ('c0000000-0000-4000-8000-0000000e7402', '00000000-0000-4000-8000-0000000e7402', 'planted',
          'https://media.example/images/f0000000-0000-4000-8000-0000000e7401.png');
  RAISE EXCEPTION 'ASSERT FAIL: a browser inserted a character';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot insert a character';
END $$;
DO $$ BEGIN
  UPDATE public.characters SET source_image_url = 'https://media.example/images/f0000000-0000-4000-8000-0000000e7401.png'
   WHERE id = 'e4000000-0000-4000-8000-0000000e7402';
  RAISE EXCEPTION 'ASSERT FAIL: a browser wrote a url into its own character';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot update its own character';
END $$;
DO $$ BEGIN
  DELETE FROM public.characters WHERE id = 'e4000000-0000-4000-8000-0000000e7402';
  RAISE EXCEPTION 'ASSERT FAIL: a browser deleted a character';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot delete its own character';
END $$;

-- It still reads its own rows (the library, the studios and Realtime need SELECT only).
SELECT pg_temp.assert_eq('a browser still reads its own asset',
  (SELECT filename FROM public.assets WHERE id = 'a5000000-0000-4000-8000-0000000e7402'), 'own.png');
SELECT pg_temp.assert_eq('a browser still reads its own location',
  (SELECT name FROM public.locations WHERE id = 'e1000000-0000-4000-8000-0000000e7402'), 'attacker location');
SELECT pg_temp.assert_eq('a browser still reads its own character (the editor and Realtime need SELECT only)',
  (SELECT name FROM public.characters WHERE id = 'e4000000-0000-4000-8000-0000000e7402'), 'attacker character');
RESET ROLE;

DO $$
DECLARE t text; r text; p text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assets', 'locations', 'creatures', 'objects', 'characters'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH p IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
        PERFORM pg_temp.assert_eq(format('%s holds no %s on %s', r, p, t),
          has_table_privilege(r, 'public.' || t, p)::text, 'false');
      END LOOP;
    END LOOP;
    PERFORM pg_temp.assert_eq(format('authenticated still reads %s', t),
      has_table_privilege('authenticated', 'public.' || t, 'SELECT')::text, 'true');
    -- characters keeps its one FOR ALL policy: it also serves SELECT, and
    -- without the grants it admits no write.
    CONTINUE WHEN t = 'characters';
    PERFORM pg_temp.assert_eq(format('no write policy on %s is left', t),
      (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = t
         AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL') AND permissive = 'PERMISSIVE'), '0');
  END LOOP;
END $$;

DO $$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.remove_location_asset(uuid, uuid, text, text)',
    'public.remove_creature_asset(uuid, uuid, text, text)',
    'public.remove_object_asset(uuid, uuid, text, text)'
  ] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      PERFORM pg_temp.assert_eq(format('%s cannot execute %s', r, f), has_function_privilege(r, f, 'EXECUTE')::text, 'false');
    END LOOP;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.remove_location_asset(uuid, uuid, text, text)',
    'public.remove_creature_asset(uuid, uuid, text, text)',
    'public.remove_object_asset(uuid, uuid, text, text)'
  ] LOOP
    PERFORM pg_temp.assert_eq(format('the backend (service_role) still executes %s', f),
      has_function_privilege('service_role', f, 'EXECUTE')::text, 'true');
  END LOOP;
  PERFORM pg_temp.assert_eq('the victim''s asset was not shared',
    (SELECT is_shared::text FROM public.assets WHERE id = 'a5000000-0000-4000-8000-0000000e7401'), 'false');
  PERFORM pg_temp.assert_eq('the victim''s location keeps its angle',
    (SELECT jsonb_array_length(angles)::text FROM public.locations WHERE id = 'e1000000-0000-4000-8000-0000000e7401'), '1');
END $$;

-- ---------------------------------------------------------- the service role
SET LOCAL ROLE service_role;

-- 4. The normal cases still work: a pipeline job of the pipeline's owner, a
--    child of the same user's job, an asset of the owner's own pipeline entity.
INSERT INTO public.jobs (id, user_id, job_type, status, pipeline_id, parent_job_id) VALUES
  ('f0000000-0000-4000-8000-0000000e7410', '00000000-0000-4000-8000-0000000e7401', 'image-to-video', 'pending',
   'a0000000-0000-4000-8000-0000000e7401', 'f0000000-0000-4000-8000-0000000e7401');
INSERT INTO public.assets (id, user_id, type, filename, mime_type, size_bytes, r2_key, pipeline_entity_id) VALUES
  ('a5000000-0000-4000-8000-0000000e7410', '00000000-0000-4000-8000-0000000e7401', 'image', 'hero.png', 'image/png', 1,
   'images/f0000000-0000-4000-8000-0000000e7401.png', 'b0000000-0000-4000-8000-0000000e7401');
SELECT pg_temp.assert_eq('the denorm trigger still derives the asset''s pipeline',
  (SELECT pipeline_id::text FROM public.assets WHERE id = 'a5000000-0000-4000-8000-0000000e7410'),
  'a0000000-0000-4000-8000-0000000e7401');
-- Moving the job to the owner's other pipeline is allowed.
UPDATE public.jobs SET pipeline_id = 'a0000000-0000-4000-8000-0000000e7403'
 WHERE id = 'f0000000-0000-4000-8000-0000000e7410';

-- 5. The invariant binds the service role too.
DO $$ BEGIN
  INSERT INTO public.jobs (user_id, job_type, status, pipeline_id)
  VALUES ('00000000-0000-4000-8000-0000000e7402', 'image-to-video', 'completed', 'a0000000-0000-4000-8000-0000000e7401');
  RAISE EXCEPTION 'ASSERT FAIL: a job was inserted naming another user''s pipeline';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a job naming another user''s pipeline is refused';
END $$;
DO $$ BEGIN
  INSERT INTO public.jobs (user_id, job_type, status, parent_job_id)
  VALUES ('00000000-0000-4000-8000-0000000e7402', 'render-video', 'pending', 'f0000000-0000-4000-8000-0000000e7401');
  RAISE EXCEPTION 'ASSERT FAIL: a job was inserted as the child of another user''s job';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a child of another user''s job is refused';
END $$;
DO $$ BEGIN
  UPDATE public.jobs SET pipeline_id = 'a0000000-0000-4000-8000-0000000e7402'
   WHERE id = 'f0000000-0000-4000-8000-0000000e7410';
  RAISE EXCEPTION 'ASSERT FAIL: a job was re-pointed at another user''s pipeline';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  re-pointing a job at another user''s pipeline is refused';
END $$;
DO $$ BEGIN
  UPDATE public.jobs SET user_id = '00000000-0000-4000-8000-0000000e7402'
   WHERE id = 'f0000000-0000-4000-8000-0000000e7410';
  RAISE EXCEPTION 'ASSERT FAIL: a pipeline job was handed to another user';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  handing a pipeline job to another user is refused';
END $$;
DO $$ BEGIN
  INSERT INTO public.assets (user_id, type, filename, mime_type, size_bytes, pipeline_entity_id)
  VALUES ('00000000-0000-4000-8000-0000000e7402', 'image', 'x.png', 'image/png', 1, 'b0000000-0000-4000-8000-0000000e7401');
  RAISE EXCEPTION 'ASSERT FAIL: an asset was attached to another user''s pipeline entity';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  an asset of another user''s pipeline entity is refused';
END $$;

-- 5b. A pipeline entity's asset pointers name only the pipeline owner's
--     assets (decided 2026-10-07), for the service role too.
DO $$ BEGIN
  UPDATE public.pipeline_entities SET main_asset_id = 'a5000000-0000-4000-8000-0000000e7401'
   WHERE id = 'b0000000-0000-4000-8000-0000000e7402';
  RAISE EXCEPTION 'ASSERT FAIL: an entity''s main image was pointed at another user''s asset';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  an entity''s main_asset_id naming another user''s asset is refused';
END $$;
DO $$ BEGIN
  INSERT INTO public.pipeline_entities (pipeline_id, entity_type, entity_key, main_asset_id)
  VALUES ('a0000000-0000-4000-8000-0000000e7402', 'object', 'loot', 'a5000000-0000-4000-8000-0000000e7401');
  RAISE EXCEPTION 'ASSERT FAIL: an entity was inserted naming another user''s asset';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  an entity inserted naming another user''s asset is refused';
END $$;
DO $$ BEGIN
  UPDATE public.pipeline_entities
     SET metadata = jsonb_build_object('last_attempted_asset_id', 'a5000000-0000-4000-8000-0000000e7401')
   WHERE id = 'b0000000-0000-4000-8000-0000000e7402';
  RAISE EXCEPTION 'ASSERT FAIL: an entity''s last attempt was pointed at another user''s asset';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a last_attempted_asset_id naming another user''s asset is refused';
END $$;
DO $$ BEGIN
  UPDATE public.pipeline_entities SET metadata = '{"last_attempted_asset_id":"not-a-uuid"}'
   WHERE id = 'b0000000-0000-4000-8000-0000000e7402';
  RAISE EXCEPTION 'ASSERT FAIL: a last_attempted_asset_id that names no asset was stored';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a last_attempted_asset_id that is not a uuid is refused';
END $$;
-- The owner's own assets pass, and deleting the asset clears the pointer.
INSERT INTO public.assets (id, user_id, type, filename, mime_type, size_bytes, r2_key) VALUES
  ('a5000000-0000-4000-8000-0000000e7430', '00000000-0000-4000-8000-0000000e7402', 'image', 'thief.png', 'image/png', 1,
   'images/thief.png');
UPDATE public.pipeline_entities
   SET main_asset_id = 'a5000000-0000-4000-8000-0000000e7430',
       metadata = '{"last_attempted_asset_id":"a5000000-0000-4000-8000-0000000e7430","name":"Thief"}'
 WHERE id = 'b0000000-0000-4000-8000-0000000e7402';
SELECT pg_temp.assert_eq('the owner''s own asset is accepted as main image and last attempt',
  (SELECT main_asset_id::text || ' ' || (metadata->>'last_attempted_asset_id')
     FROM public.pipeline_entities WHERE id = 'b0000000-0000-4000-8000-0000000e7402'),
  'a5000000-0000-4000-8000-0000000e7430 a5000000-0000-4000-8000-0000000e7430');
DELETE FROM public.assets WHERE id = 'a5000000-0000-4000-8000-0000000e7430';
SELECT pg_temp.assert_eq('deleting the asset clears main_asset_id (121''s SET NULL passes the trigger)',
  (SELECT coalesce(main_asset_id::text, 'null') FROM public.pipeline_entities WHERE id = 'b0000000-0000-4000-8000-0000000e7402'), 'null');
UPDATE public.pipeline_entities SET status = 'approved', metadata = metadata || '{"note":"kept"}'
 WHERE id = 'b0000000-0000-4000-8000-0000000e7402';
SELECT pg_temp.assert_eq('a metadata write that keeps the same last attempt is not judged again',
  (SELECT metadata->>'note' FROM public.pipeline_entities WHERE id = 'b0000000-0000-4000-8000-0000000e7402'), 'kept');

-- 5c. The entity's last frame and its variants' images (round 2, decided
--     2026-10-07): the same rule, for the service role too.
DO $$ BEGIN
  UPDATE public.pipeline_entities SET last_frame_asset_id = 'a5000000-0000-4000-8000-0000000e7401'
   WHERE id = 'b0000000-0000-4000-8000-0000000e7402';
  RAISE EXCEPTION 'ASSERT FAIL: an entity''s last frame was pointed at another user''s asset';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  an entity''s last_frame_asset_id naming another user''s asset is refused';
END $$;
DO $$ BEGIN
  INSERT INTO public.pipeline_entities (pipeline_id, entity_type, entity_key, last_frame_asset_id)
  VALUES ('a0000000-0000-4000-8000-0000000e7402', 'scene', 'scene_01', 'a5000000-0000-4000-8000-0000000e7401');
  RAISE EXCEPTION 'ASSERT FAIL: an entity was inserted with another user''s asset as its last frame';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  an entity inserted with another user''s last frame is refused';
END $$;
DO $$ BEGIN
  INSERT INTO public.pipeline_entity_variants (entity_id, variant_key, asset_id, status)
  VALUES ('b0000000-0000-4000-8000-0000000e7402', 'angle_profile', 'a5000000-0000-4000-8000-0000000e7401', 'approved');
  RAISE EXCEPTION 'ASSERT FAIL: a variant was inserted naming another user''s asset';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a variant naming another user''s asset is refused';
END $$;
-- The owner's own asset passes as last frame and as a variant image.
INSERT INTO public.assets (id, user_id, type, filename, mime_type, size_bytes, r2_key) VALUES
  ('a5000000-0000-4000-8000-0000000e7431', '00000000-0000-4000-8000-0000000e7402', 'image', 'thief-frame.png', 'image/png', 1,
   'images/thief-frame.png');
UPDATE public.pipeline_entities SET last_frame_asset_id = 'a5000000-0000-4000-8000-0000000e7431'
 WHERE id = 'b0000000-0000-4000-8000-0000000e7402';
INSERT INTO public.pipeline_entity_variants (id, entity_id, variant_key, status) VALUES
  ('b1000000-0000-4000-8000-0000000e7431', 'b0000000-0000-4000-8000-0000000e7402', 'angle_profile', 'pending');
UPDATE public.pipeline_entity_variants SET asset_id = 'a5000000-0000-4000-8000-0000000e7431', status = 'approved'
 WHERE id = 'b1000000-0000-4000-8000-0000000e7431';
SELECT pg_temp.assert_eq('the owner''s own asset is accepted as last frame and as a variant image',
  (SELECT e.last_frame_asset_id::text || ' ' || v.asset_id::text
     FROM public.pipeline_entities e JOIN public.pipeline_entity_variants v ON v.entity_id = e.id
    WHERE e.id = 'b0000000-0000-4000-8000-0000000e7402'),
  'a5000000-0000-4000-8000-0000000e7431 a5000000-0000-4000-8000-0000000e7431');
DO $$ BEGIN
  UPDATE public.pipeline_entity_variants SET asset_id = 'a5000000-0000-4000-8000-0000000e7401'
   WHERE id = 'b1000000-0000-4000-8000-0000000e7431';
  RAISE EXCEPTION 'ASSERT FAIL: a variant was re-pointed at another user''s asset';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  re-pointing a variant at another user''s asset is refused';
END $$;
DO $$ BEGIN
  -- The attacker's image moved onto the victim's entity.
  UPDATE public.pipeline_entity_variants SET entity_id = 'b0000000-0000-4000-8000-0000000e7401'
   WHERE id = 'b1000000-0000-4000-8000-0000000e7431';
  RAISE EXCEPTION 'ASSERT FAIL: a variant was moved to an entity whose owner does not own its asset';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  moving a variant to another user''s entity is refused';
END $$;
UPDATE public.pipeline_entity_variants SET asset_id = asset_id, status = 'rejected'
 WHERE id = 'b1000000-0000-4000-8000-0000000e7431';
SELECT pg_temp.assert_eq('a variant write that keeps its asset passes',
  (SELECT status FROM public.pipeline_entity_variants WHERE id = 'b1000000-0000-4000-8000-0000000e7431'), 'rejected');
-- Moving an ENTITY to another pipeline carries its variants with it (review
-- round, decided 2026-10-07). An entity with no pointers of its own, whose
-- variant names its owner's image, moved into another user's pipeline: the
-- variant row is untouched, so only the entity's trigger can see it.
INSERT INTO public.pipeline_entities (id, pipeline_id, entity_type, entity_key) VALUES
  ('b0000000-0000-4000-8000-0000000e7432', 'a0000000-0000-4000-8000-0000000e7402', 'character', 'drifter');
INSERT INTO public.pipeline_entity_variants (id, entity_id, variant_key, asset_id, status) VALUES
  ('b1000000-0000-4000-8000-0000000e7432', 'b0000000-0000-4000-8000-0000000e7432', 'angle_profile',
   'a5000000-0000-4000-8000-0000000e7431', 'approved');
DO $$ BEGIN
  UPDATE public.pipeline_entities SET pipeline_id = 'a0000000-0000-4000-8000-0000000e7401'
   WHERE id = 'b0000000-0000-4000-8000-0000000e7432';
  RAISE EXCEPTION 'ASSERT FAIL: an entity was moved into another user''s pipeline with its variant still naming its old owner''s asset';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  moving an entity whose variant names its owner''s asset into another user''s pipeline is refused';
END $$;
SELECT pg_temp.assert_eq('the refused move leaves the entity in its own pipeline',
  (SELECT pipeline_id::text FROM public.pipeline_entities WHERE id = 'b0000000-0000-4000-8000-0000000e7432'),
  'a0000000-0000-4000-8000-0000000e7402');
-- Once the variant's image is gone (121's SET NULL), nothing pins the entity.
UPDATE public.pipeline_entity_variants SET asset_id = NULL WHERE id = 'b1000000-0000-4000-8000-0000000e7432';
UPDATE public.pipeline_entities SET pipeline_id = 'a0000000-0000-4000-8000-0000000e7401'
 WHERE id = 'b0000000-0000-4000-8000-0000000e7432';
SELECT pg_temp.assert_eq('an entity whose variants name no image moves',
  (SELECT pipeline_id::text FROM public.pipeline_entities WHERE id = 'b0000000-0000-4000-8000-0000000e7432'),
  'a0000000-0000-4000-8000-0000000e7401');
DELETE FROM public.pipeline_entities WHERE id = 'b0000000-0000-4000-8000-0000000e7432';
-- The owner's own move, between two of their pipelines, keeps its variants.
INSERT INTO public.pipeline_entities (id, pipeline_id, entity_type, entity_key) VALUES
  ('b0000000-0000-4000-8000-0000000e7433', 'a0000000-0000-4000-8000-0000000e7401', 'character', 'wanderer');
INSERT INTO public.pipeline_entity_variants (id, entity_id, variant_key, asset_id, status) VALUES
  ('b1000000-0000-4000-8000-0000000e7433', 'b0000000-0000-4000-8000-0000000e7433', 'angle_profile',
   'a5000000-0000-4000-8000-0000000e7401', 'approved');
UPDATE public.pipeline_entities SET pipeline_id = 'a0000000-0000-4000-8000-0000000e7403'
 WHERE id = 'b0000000-0000-4000-8000-0000000e7433';
SELECT pg_temp.assert_eq('moving an entity to its owner''s other pipeline keeps its variant',
  (SELECT e.pipeline_id::text || ' ' || v.asset_id::text
     FROM public.pipeline_entities e JOIN public.pipeline_entity_variants v ON v.entity_id = e.id
    WHERE e.id = 'b0000000-0000-4000-8000-0000000e7433'),
  'a0000000-0000-4000-8000-0000000e7403 a5000000-0000-4000-8000-0000000e7401');
DELETE FROM public.pipeline_entities WHERE id = 'b0000000-0000-4000-8000-0000000e7433';
DELETE FROM public.assets WHERE id = 'a5000000-0000-4000-8000-0000000e7431';
SELECT pg_temp.assert_eq('deleting the asset clears the last frame and the variant image (121''s SET NULL passes both triggers)',
  (SELECT coalesce(e.last_frame_asset_id::text, 'null') || ' ' || coalesce(v.asset_id::text, 'null')
     FROM public.pipeline_entities e JOIN public.pipeline_entity_variants v ON v.entity_id = e.id
    WHERE e.id = 'b0000000-0000-4000-8000-0000000e7402'),
  'null null');
DELETE FROM public.pipeline_entity_variants WHERE id = 'b1000000-0000-4000-8000-0000000e7431';

-- 5d. A scene's pointers inside `metadata.scene_node_data` (round 3, decided
--     2026-10-07): every key named `asset_id` or ending in `_asset_id`, in the
--     shots and in the scene's own asset refs, names only the pipeline owner's
--     assets. Only a uuid-shaped value names an asset; only a pointer that
--     changed is judged.
INSERT INTO public.assets (id, user_id, type, filename, mime_type, size_bytes, r2_key) VALUES
  ('a5000000-0000-4000-8000-0000000e7440', '00000000-0000-4000-8000-0000000e7402', 'image', 'thief-keyframe.png', 'image/png', 1,
   'images/thief-keyframe.png'),
  ('a5000000-0000-4000-8000-0000000e7441', '00000000-0000-4000-8000-0000000e7402', 'video', 'thief-shot.mp4', 'video/mp4', 1,
   'videos/thief-shot.mp4');
DO $$ BEGIN
  INSERT INTO public.pipeline_entities (pipeline_id, entity_type, entity_key, metadata)
  VALUES ('a0000000-0000-4000-8000-0000000e7402', 'scene', 'scene_01',
          '{"scene_node_data":{"shots":[{"shot_id":"s1","keyframe_asset_id":"a5000000-0000-4000-8000-0000000e7401"}]}}');
  RAISE EXCEPTION 'ASSERT FAIL: a scene was inserted with a shot naming another user''s asset';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a scene inserted with a shot keyframe naming another user''s asset is refused';
END $$;
-- The owner's scene, naming the owner's own assets (one in upper case) and a
-- value that is not a uuid (names no asset, so it pins nothing).
INSERT INTO public.pipeline_entities (id, pipeline_id, entity_type, entity_key, metadata) VALUES
  ('b0000000-0000-4000-8000-0000000e7440', 'a0000000-0000-4000-8000-0000000e7402', 'scene', 'scene_02',
   '{"entity_type":"scene","scene_node_data":{"scene_index":2,"shots":[
      {"shot_id":"s1","keyframe_asset_id":"a5000000-0000-4000-8000-0000000e7440","video_asset_id":"A5000000-0000-4000-8000-0000000E7441"},
      {"shot_id":"s2","keyframe_asset_id":"pending"}],
     "generated_clips":[{"asset_id":"a5000000-0000-4000-8000-0000000e7441","url":"https://media.example/videos/thief-shot.mp4"}]}}');
SELECT pg_temp.assert_eq('a scene naming its owner''s assets (and a non-uuid value) is accepted',
  (SELECT metadata#>>'{scene_node_data,shots,0,keyframe_asset_id}' FROM public.pipeline_entities
    WHERE id = 'b0000000-0000-4000-8000-0000000e7440'),
  'a5000000-0000-4000-8000-0000000e7440');
-- Every slot that can carry an asset id refuses another user's: the five shot
-- pointers, the flat composite id, and the six asset refs. Upper case too.
DO $$
DECLARE
  v_patch   jsonb;
  v_refused int := 0;
  v_tried   int := 0;
BEGIN
  FOR v_patch IN SELECT p FROM jsonb_array_elements('[
    {"shots":[{"shot_id":"s1","keyframe_asset_id":"a5000000-0000-4000-8000-0000000e7401"},{"shot_id":"s2"}]},
    {"shots":[{"shot_id":"s1"},{"shot_id":"s2","video_asset_id":"a5000000-0000-4000-8000-0000000e7401"}]},
    {"shots":[{"shot_id":"s1","last_frame_asset_id":"a5000000-0000-4000-8000-0000000e7401"}]},
    {"shots":[{"shot_id":"s1","audio_asset_id":"a5000000-0000-4000-8000-0000000e7401"}]},
    {"shots":[{"shot_id":"s1","lipsynced_asset_id":"a5000000-0000-4000-8000-0000000e7401"}]},
    {"composite_video_asset_id":"a5000000-0000-4000-8000-0000000e7401"},
    {"composite_video_asset_id":"A5000000-0000-4000-8000-0000000E7401"},
    {"scene_anchor_keyframe":{"asset_id":"a5000000-0000-4000-8000-0000000e7401","url":"https://media.example/x.png"}},
    {"generated_keyframes":[{"asset_id":"a5000000-0000-4000-8000-0000000e7401","url":"https://media.example/x.png"}]},
    {"generated_clips":[{"asset_id":"a5000000-0000-4000-8000-0000000e7441","url":"u"},{"asset_id":"a5000000-0000-4000-8000-0000000e7401","url":"u"}]},
    {"composite_video":{"asset_id":"a5000000-0000-4000-8000-0000000e7401","url":"https://media.example/x.mp4"}},
    {"last_frame":{"asset_id":"a5000000-0000-4000-8000-0000000e7401","url":"https://media.example/x.png"}},
    {"scene_audio_track":{"asset_id":"a5000000-0000-4000-8000-0000000e7401","url":"https://media.example/x.mp3"}}
  ]'::jsonb) AS t(p)
  LOOP
    v_tried := v_tried + 1;
    BEGIN
      UPDATE public.pipeline_entities
         SET metadata = jsonb_set(metadata, '{scene_node_data}', (metadata->'scene_node_data') || v_patch)
       WHERE id = 'b0000000-0000-4000-8000-0000000e7440';
      RAISE EXCEPTION 'ASSERT FAIL: a scene took another user''s asset through %', v_patch;
    EXCEPTION WHEN insufficient_privilege THEN
      v_refused := v_refused + 1;
    END;
  END LOOP;
  PERFORM pg_temp.assert_eq('every scene_node_data slot refuses another user''s asset (shots, flat id, asset refs, any case)',
    v_refused::text, v_tried::text);
END $$;
SELECT pg_temp.assert_eq('the refused writes left the scene as it was',
  (SELECT metadata#>>'{scene_node_data,shots,0,keyframe_asset_id}' FROM public.pipeline_entities
    WHERE id = 'b0000000-0000-4000-8000-0000000e7440'),
  'a5000000-0000-4000-8000-0000000e7440');
-- The owner's own assets pass in the same slots.
UPDATE public.pipeline_entities
   SET metadata = jsonb_set(metadata, '{scene_node_data}', (metadata->'scene_node_data') ||
     '{"composite_video_asset_id":"a5000000-0000-4000-8000-0000000e7441",
       "last_frame":{"asset_id":"a5000000-0000-4000-8000-0000000e7440","url":"https://media.example/images/thief-keyframe.png"}}')
 WHERE id = 'b0000000-0000-4000-8000-0000000e7440';
SELECT pg_temp.assert_eq('the owner''s own assets are accepted in the scene''s slots',
  (SELECT (metadata#>>'{scene_node_data,composite_video_asset_id}') || ' ' || (metadata#>>'{scene_node_data,last_frame,asset_id}')
     FROM public.pipeline_entities WHERE id = 'b0000000-0000-4000-8000-0000000e7440'),
  'a5000000-0000-4000-8000-0000000e7441 a5000000-0000-4000-8000-0000000e7440');
-- Moving the scene into another user's pipeline judges every pointer it carries.
DO $$ BEGIN
  UPDATE public.pipeline_entities SET pipeline_id = 'a0000000-0000-4000-8000-0000000e7401'
   WHERE id = 'b0000000-0000-4000-8000-0000000e7440';
  RAISE EXCEPTION 'ASSERT FAIL: a scene was moved into another user''s pipeline still naming its old owner''s assets';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  moving a scene whose shots name its owner''s assets into another user''s pipeline is refused';
END $$;
-- A pointer that does not change is not judged again: the clip's asset is
-- deleted (a JSON pointer has no SET NULL), and a later write that keeps the
-- now-dangling id, reorders the shots and edits a plan field still passes.
DELETE FROM public.assets WHERE id = 'a5000000-0000-4000-8000-0000000e7441';
UPDATE public.pipeline_entities
   SET status = 'approved',
       metadata = jsonb_set(metadata, '{scene_node_data,shots}', jsonb_build_array(
         (metadata#>'{scene_node_data,shots,1}') || '{"motion_prompt":"slow push in"}',
         metadata#>'{scene_node_data,shots,0}'))
 WHERE id = 'b0000000-0000-4000-8000-0000000e7440';
SELECT pg_temp.assert_eq('a scene write that keeps its pointers (one now dangling) and reorders its shots passes',
  (SELECT (metadata#>>'{scene_node_data,shots,1,video_asset_id}') || ' ' || (metadata#>>'{scene_node_data,shots,0,motion_prompt}')
     FROM public.pipeline_entities WHERE id = 'b0000000-0000-4000-8000-0000000e7440'),
  'A5000000-0000-4000-8000-0000000E7441 slow push in');
DELETE FROM public.pipeline_entities WHERE id = 'b0000000-0000-4000-8000-0000000e7440';

-- 6. Deleting a pipeline detaches its jobs and assets (121's ON DELETE SET
--    NULL), which the triggers let through. The pipeline here has an
--    entity-linked asset, so the delete runs BOTH referential actions on
--    that asset: `assets.pipeline_id` SET NULL and, through the entity's
--    cascade, `assets.pipeline_entity_id` SET NULL. The owner trigger must
--    pass whichever runs first (it checks only a pointer that changed).
INSERT INTO public.jobs (id, user_id, job_type, status, pipeline_id) VALUES
  ('f0000000-0000-4000-8000-0000000e7411', '00000000-0000-4000-8000-0000000e7401', 'image-to-video', 'pending',
   'a0000000-0000-4000-8000-0000000e7404');
INSERT INTO public.assets (id, user_id, type, filename, mime_type, size_bytes, r2_key, pipeline_entity_id) VALUES
  ('a5000000-0000-4000-8000-0000000e7411', '00000000-0000-4000-8000-0000000e7401', 'image', 'villain.png', 'image/png', 1,
   'images/villain.png', 'b0000000-0000-4000-8000-0000000e7404');
DELETE FROM public.pipelines WHERE id = 'a0000000-0000-4000-8000-0000000e7404';
SELECT pg_temp.assert_eq('deleting the pipeline detaches its job',
  (SELECT coalesce(pipeline_id::text, 'null') FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-0000000e7411'), 'null');
SELECT pg_temp.assert_eq('deleting the pipeline detaches its entity-linked asset from pipeline and entity',
  (SELECT coalesce(pipeline_id::text, 'null') || ' ' || coalesce(pipeline_entity_id::text, 'null')
     FROM public.assets WHERE id = 'a5000000-0000-4000-8000-0000000e7411'), 'null null');
DELETE FROM public.pipelines WHERE id = 'a0000000-0000-4000-8000-0000000e7403';
SELECT pg_temp.assert_eq('deleting the job''s other pipeline detaches it too',
  (SELECT coalesce(pipeline_id::text, 'null') FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-0000000e7410'), 'null');
RESET ROLE;

-- ------------------------------------------------- rows planted before 480
-- Plant them the way an earlier client could (triggers off: the old world),
-- next to legitimate ones, then re-apply 480: the planted pointers are
-- detached, the legitimate ones kept, and the migration runs twice cleanly.
ALTER TABLE public.jobs DISABLE TRIGGER trg_jobs_pointer_owner;
ALTER TABLE public.assets DISABLE TRIGGER trg_assets_pipeline_owner;
ALTER TABLE public.pipeline_entities DISABLE TRIGGER trg_pipeline_entities_asset_owner;
ALTER TABLE public.pipeline_entity_variants DISABLE TRIGGER trg_pipeline_entity_variants_asset_owner;
INSERT INTO public.jobs (id, user_id, job_type, status, pipeline_id, parent_job_id) VALUES
  ('f0000000-0000-4000-8000-0000000e7420', '00000000-0000-4000-8000-0000000e7402', 'image-to-video', 'completed',
   'a0000000-0000-4000-8000-0000000e7401', NULL),
  ('f0000000-0000-4000-8000-0000000e7421', '00000000-0000-4000-8000-0000000e7402', 'render-video', 'completed',
   NULL, 'f0000000-0000-4000-8000-0000000e7401'),
  ('f0000000-0000-4000-8000-0000000e7422', '00000000-0000-4000-8000-0000000e7401', 'image-to-video', 'completed',
   'a0000000-0000-4000-8000-0000000e7401', 'f0000000-0000-4000-8000-0000000e7401');
INSERT INTO public.assets (id, user_id, type, filename, mime_type, size_bytes, r2_key, pipeline_entity_id) VALUES
  ('a5000000-0000-4000-8000-0000000e7420', '00000000-0000-4000-8000-0000000e7402', 'image', 'planted.png', 'image/png', 1,
   'images/f0000000-0000-4000-8000-0000000e7401.png', 'b0000000-0000-4000-8000-0000000e7401');
-- A location row naming the victim's file, as a pre-480 client could write it.
UPDATE public.locations SET source_image_url = 'https://media.example/images/f0000000-0000-4000-8000-0000000e7401.png'
 WHERE id = 'e1000000-0000-4000-8000-0000000e7402';
-- The attacker's entity naming the victim's private asset as its main image
-- and its last attempt.
UPDATE public.pipeline_entities
   SET main_asset_id = 'a5000000-0000-4000-8000-0000000e7401',
       last_frame_asset_id = 'a5000000-0000-4000-8000-0000000e7401',
       metadata = '{"last_attempted_asset_id":"a5000000-0000-4000-8000-0000000e7401"}'
 WHERE id = 'b0000000-0000-4000-8000-0000000e7402';
-- And a variant of it naming the same asset.
INSERT INTO public.pipeline_entity_variants (id, entity_id, variant_key, asset_id, status) VALUES
  ('b1000000-0000-4000-8000-0000000e7420', 'b0000000-0000-4000-8000-0000000e7402', 'expression_smiling',
   'a5000000-0000-4000-8000-0000000e7401', 'approved');
-- And the attacker's scene whose shot names the victim's private asset.
INSERT INTO public.pipeline_entities (id, pipeline_id, entity_type, entity_key, metadata) VALUES
  ('b0000000-0000-4000-8000-0000000e7450', 'a0000000-0000-4000-8000-0000000e7402', 'scene', 'scene_05',
   '{"scene_node_data":{"scene_index":5,"shots":[{"shot_id":"s1","keyframe_asset_id":"a5000000-0000-4000-8000-0000000e7401"},{"shot_id":"s2"}]}}');
ALTER TABLE public.jobs ENABLE TRIGGER trg_jobs_pointer_owner;
ALTER TABLE public.assets ENABLE TRIGGER trg_assets_pipeline_owner;
ALTER TABLE public.pipeline_entities ENABLE TRIGGER trg_pipeline_entities_asset_owner;
ALTER TABLE public.pipeline_entity_variants ENABLE TRIGGER trg_pipeline_entity_variants_asset_owner;

\ir ../migrations/480_storage_key_and_pointer_ownership.sql

DO $$ BEGIN
  PERFORM pg_temp.assert_eq('the planted pipeline pointer is detached',
    (SELECT coalesce(pipeline_id::text, 'null') FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-0000000e7420'), 'null');
  PERFORM pg_temp.assert_eq('the planted parent pointer is detached',
    (SELECT coalesce(parent_job_id::text, 'null') FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-0000000e7421'), 'null');
  PERFORM pg_temp.assert_eq('the planted rows themselves stay (their user''s own jobs)',
    (SELECT count(*)::text FROM public.jobs WHERE id IN ('f0000000-0000-4000-8000-0000000e7420', 'f0000000-0000-4000-8000-0000000e7421')), '2');
  PERFORM pg_temp.assert_eq('the owner''s job keeps its pipeline and parent',
    (SELECT pipeline_id::text || ' ' || parent_job_id::text FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-0000000e7422'),
    'a0000000-0000-4000-8000-0000000e7401 f0000000-0000-4000-8000-0000000e7401');
  PERFORM pg_temp.assert_eq('the planted asset leaves the victim''s pipeline and entity',
    (SELECT coalesce(pipeline_id::text, 'null') || ' ' || coalesce(pipeline_entity_id::text, 'null')
       FROM public.assets WHERE id = 'a5000000-0000-4000-8000-0000000e7420'), 'null null');
  PERFORM pg_temp.assert_eq('the owner''s asset keeps its entity',
    (SELECT pipeline_entity_id::text FROM public.assets WHERE id = 'a5000000-0000-4000-8000-0000000e7410'),
    'b0000000-0000-4000-8000-0000000e7401');
  PERFORM pg_temp.assert_eq('the victim''s pipeline now has only its owner''s jobs',
    (SELECT count(*)::text FROM public.jobs j JOIN public.pipelines p ON p.id = j.pipeline_id
      WHERE p.id = 'a0000000-0000-4000-8000-0000000e7401' AND j.user_id <> p.user_id), '0');
  PERFORM pg_temp.assert_eq('a planted key stays in its row (counted, inert: the deleters ask whose it is)',
    (SELECT r2_key FROM public.assets WHERE id = 'a5000000-0000-4000-8000-0000000e7420'),
    'images/f0000000-0000-4000-8000-0000000e7401.png');
  PERFORM pg_temp.assert_eq('a planted entity pointer stays in its row (counted, not changed: every read asks for the owner''s asset)',
    (SELECT main_asset_id::text || ' ' || (metadata->>'last_attempted_asset_id')
       FROM public.pipeline_entities WHERE id = 'b0000000-0000-4000-8000-0000000e7402'),
    'a5000000-0000-4000-8000-0000000e7401 a5000000-0000-4000-8000-0000000e7401');
  -- The row stays writable where it does not change a pointer.
  UPDATE public.pipeline_entities SET status = 'failed', metadata = metadata || '{"note":"later write"}'
   WHERE id = 'b0000000-0000-4000-8000-0000000e7402';
  PERFORM pg_temp.assert_eq('a planted entity still takes a write that keeps its pointers',
    (SELECT status || ' ' || (metadata->>'note') FROM public.pipeline_entities WHERE id = 'b0000000-0000-4000-8000-0000000e7402'),
    'failed later write');
  PERFORM pg_temp.assert_eq('a planted last frame and variant image stay in their rows (counted, not changed)',
    (SELECT e.last_frame_asset_id::text || ' ' || v.asset_id::text
       FROM public.pipeline_entities e JOIN public.pipeline_entity_variants v ON v.entity_id = e.id
      WHERE e.id = 'b0000000-0000-4000-8000-0000000e7402' AND v.id = 'b1000000-0000-4000-8000-0000000e7420'),
    'a5000000-0000-4000-8000-0000000e7401 a5000000-0000-4000-8000-0000000e7401');
  UPDATE public.pipeline_entity_variants SET asset_id = asset_id, status = 'rejected'
   WHERE id = 'b1000000-0000-4000-8000-0000000e7420';
  PERFORM pg_temp.assert_eq('a planted variant still takes a write that keeps its asset',
    (SELECT status FROM public.pipeline_entity_variants WHERE id = 'b1000000-0000-4000-8000-0000000e7420'), 'rejected');
  -- The planted scene (round 3): its shot pointer stays, a write that keeps it
  -- passes, a NEW foreign pointer beside it is still refused, and replacing it
  -- with the owner's own asset passes.
  PERFORM pg_temp.assert_eq('a planted scene pointer stays in its row (counted, not changed)',
    (SELECT metadata#>>'{scene_node_data,shots,0,keyframe_asset_id}' FROM public.pipeline_entities
      WHERE id = 'b0000000-0000-4000-8000-0000000e7450'),
    'a5000000-0000-4000-8000-0000000e7401');
  UPDATE public.pipeline_entities
     SET metadata = jsonb_set(metadata, '{scene_node_data,shots,1,cut_decision}', '{"in_offset_sec":0.2}')
   WHERE id = 'b0000000-0000-4000-8000-0000000e7450';
  PERFORM pg_temp.assert_eq('a planted scene still takes a write that keeps its pointers',
    (SELECT metadata#>>'{scene_node_data,shots,1,cut_decision,in_offset_sec}' FROM public.pipeline_entities
      WHERE id = 'b0000000-0000-4000-8000-0000000e7450'),
    '0.2');
  INSERT INTO public.assets (id, user_id, type, filename, mime_type, size_bytes, r2_key) VALUES
    ('a5000000-0000-4000-8000-0000000e7442', '00000000-0000-4000-8000-0000000e7401', 'video', 'victim.mp4', 'video/mp4', 1,
     'videos/victim.mp4'),
    ('a5000000-0000-4000-8000-0000000e7443', '00000000-0000-4000-8000-0000000e7402', 'image', 'thief-own.png', 'image/png', 1,
     'images/thief-own.png');
  BEGIN
    UPDATE public.pipeline_entities
       SET metadata = jsonb_set(metadata, '{scene_node_data,shots,1,video_asset_id}', '"a5000000-0000-4000-8000-0000000e7442"')
     WHERE id = 'b0000000-0000-4000-8000-0000000e7450';
    RAISE EXCEPTION 'ASSERT FAIL: a planted scene took a second foreign pointer';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  a planted scene still refuses a new pointer at another user''s asset';
  END;
  UPDATE public.pipeline_entities
     SET metadata = jsonb_set(metadata, '{scene_node_data,shots,0,keyframe_asset_id}', '"a5000000-0000-4000-8000-0000000e7443"')
   WHERE id = 'b0000000-0000-4000-8000-0000000e7450';
  PERFORM pg_temp.assert_eq('replacing a planted scene pointer with the owner''s own asset passes',
    (SELECT metadata#>>'{scene_node_data,shots,0,keyframe_asset_id}' FROM public.pipeline_entities
      WHERE id = 'b0000000-0000-4000-8000-0000000e7450'),
    'a5000000-0000-4000-8000-0000000e7443');
  RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED';
END $$;

ROLLBACK;
