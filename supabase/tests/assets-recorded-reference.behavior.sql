-- ============================================================================
-- Behavioral proof: `assets.recorded_reference` (migration 528).
--
-- A library row is proof of whose object it names only when a storing path
-- wrote it when it stored the bytes. A row that RECORDS a url someone named (a
-- library save, a pipeline entity's attached image, a generation's row for a
-- url its output repeated, a relayed output) never is. That used to be read
-- from columns that change after the fact (`pipeline_entity_id` is ON DELETE
-- SET NULL, admin promote/demote rewrite `upload_source`). 528 records it once,
-- at insert, and nothing may change it afterwards.
--
-- The classification cases are the golden table of
-- backend/src/lib/__tests__/key-ownership-proof.test.ts
-- ("recordedReferenceByShape — migration 528's classification, row by row"),
-- row for row, inserted the way the backend inserts (no flag given).
--
-- Own uuid range ...-0000005260xx.
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

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000526001', 'owner@recorded-reference.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000526002', 'other@recorded-reference.test', '{}', 'authenticated', 'authenticated');
INSERT INTO pipelines (id, user_id, root_node_id, pipeline_type, activation_mode, mode, input_prompt, target_duration_seconds, format) VALUES
  ('a0000000-0000-4000-8000-000000526001', '00000000-0000-4000-8000-000000526001', 'root', 'story_to_video', 'interactive', 'manual', 'story', 30, 'short_film');
INSERT INTO public.pipeline_entities (id, pipeline_id, entity_type, entity_key, metadata) VALUES
  ('b0000000-0000-4000-8000-000000526001', 'a0000000-0000-4000-8000-000000526001', 'character', 'hero', '{}');
-- J: the owner's generation (its outputs: images/<J>.png, images/<J>-<suffix>.png).
-- LJ: a job id with letters in it, for the case rows.
INSERT INTO jobs (id, user_id, job_type, status) VALUES
  ('f0000000-0000-4000-8000-000000526001', '00000000-0000-4000-8000-000000526001', 'generate-image', 'completed'),
  ('abcdef01-abcd-4abc-8abc-abcdefabcdef', '00000000-0000-4000-8000-000000526001', 'generate-image', 'completed');

INSERT INTO assets (id, user_id, type, filename, mime_type, size_bytes, r2_key, r2_url, upload_source, job_id, pipeline_id, pipeline_entity_id, relay_job_id) VALUES
  -- a library save
  ('a5000000-0000-4000-8000-000000526001', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 0,
   'images/22222222-2222-4222-8222-222222222222.png', 'u', 'generated', NULL, NULL, NULL, NULL),
  -- a pipeline entity's attached image
  ('a5000000-0000-4000-8000-000000526002', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 10,
   'uploads/images/44444444-4444-4444-8444-444444444444.png', 'u', 'manual_upload', NULL, NULL, 'b0000000-0000-4000-8000-000000526001', NULL),
  -- a pipeline image row (pipeline pointer only)
  ('a5000000-0000-4000-8000-000000526003', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 10,
   'uploads/images/44444444-4444-4444-8444-444444444444.png', 'u', 'manual_upload', NULL, 'a0000000-0000-4000-8000-000000526001', NULL, NULL),
  -- an attach row whose entity is gone, naming an operator file
  ('a5000000-0000-4000-8000-000000526004', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 5000000000,
   'brand/makers/acme.svg', 'u', 'manual_upload', NULL, NULL, NULL, NULL),
  -- an upload (POST /v1/upload)
  ('a5000000-0000-4000-8000-000000526005', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 10,
   'uploads/images/44444444-4444-4444-8444-444444444444.png', 'u', 'manual_upload', NULL, NULL, NULL, NULL),
  -- a legacy-route upload key nobody's row stored
  ('a5000000-0000-4000-8000-000000526006', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 10,
   'uploads/44444444-4444-4444-8444-444444444444.png', 'u', 'manual_upload', NULL, NULL, NULL, NULL),
  -- a relayed output
  ('a5000000-0000-4000-8000-000000526007', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 10,
   'images/33333333-3333-4333-8333-333333333333.png', 'u', 'generated', 'f0000000-0000-4000-8000-000000526001', NULL, NULL, 'far-1'),
  -- a generation's own output
  ('a5000000-0000-4000-8000-000000526008', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 0,
   'images/f0000000-0000-4000-8000-000000526001.png', 'u', 'generated', 'f0000000-0000-4000-8000-000000526001', NULL, NULL, NULL),
  -- a generation's suffixed side file
  ('a5000000-0000-4000-8000-000000526009', '00000000-0000-4000-8000-000000526001', 'audio', 'x', 'audio/mpeg', 10,
   'audios/f0000000-0000-4000-8000-000000526001-vocals.mp3', 'u', 'generated', 'f0000000-0000-4000-8000-000000526001', NULL, NULL, NULL),
  -- a generation's row for an operator url its output repeated
  ('a5000000-0000-4000-8000-000000526010', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 10,
   'brand/makers/acme.svg', 'u', 'generated', 'f0000000-0000-4000-8000-000000526001', NULL, NULL, NULL),
  -- a generation's row for another job's output
  ('a5000000-0000-4000-8000-000000526011', '00000000-0000-4000-8000-000000526001', 'video', 'x', 'video/mp4', 10,
   'videos/22222222-2222-4222-8222-222222222222.mp4', 'u', 'generated', 'f0000000-0000-4000-8000-000000526001', NULL, NULL, NULL),
  -- a generation's row whose job was deleted (size recorded)
  ('a5000000-0000-4000-8000-000000526012', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 4096,
   'images/33333333-3333-4333-8333-333333333333.png', 'u', 'generated', NULL, NULL, NULL, NULL),
  -- MEDIUM 2: an orphaned generation row naming a UUID-named key outside the output folders
  ('a5000000-0000-4000-8000-000000526013', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 4096,
   'uploads/44444444-4444-4444-8444-444444444444.png', 'u', 'generated', NULL, NULL, NULL, NULL),
  -- a url saved off our storage
  ('a5000000-0000-4000-8000-000000526014', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 0,
   'https://example.com/cat.png', 'u', 'generated', NULL, NULL, NULL, NULL),
  -- a scraped video (filed under its job)
  ('a5000000-0000-4000-8000-000000526015', '00000000-0000-4000-8000-000000526001', 'video', 'x', 'video/mp4', 0,
   'videos/scrape-123-11111111.mp4', 'u', 'url_import', 'f0000000-0000-4000-8000-000000526001', NULL, NULL, NULL),
  -- a url import
  ('a5000000-0000-4000-8000-000000526016', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/jpeg', 10,
   'uploads/images/44444444-4444-4444-8444-444444444444.jpg', 'u', 'url_import', NULL, NULL, NULL, NULL),
  -- a social download
  ('a5000000-0000-4000-8000-000000526017', '00000000-0000-4000-8000-000000526001', 'video', 'x', 'video/mp4', 10,
   'videos/yt-44444444-4444-4444-8444-444444444444.mp4', 'u', 'social_download', NULL, NULL, NULL, NULL),
  -- a processed file
  ('a5000000-0000-4000-8000-000000526018', '00000000-0000-4000-8000-000000526001', 'video', 'x', 'video/mp4', 10,
   'uploads/video/44444444-4444-4444-8444-444444444444.mp4', 'u', 'media_process', NULL, NULL, NULL, NULL),
  -- a timeline export
  ('a5000000-0000-4000-8000-000000526019', '00000000-0000-4000-8000-000000526001', 'document', 'x', 'application/json', 10,
   'exports/00000000-0000-4000-8000-000000526001/timeline-44444444-4444-4444-8444-444444444444.json', 'u', 'job', NULL, NULL, NULL, NULL),
  -- a final merge (filed under its job and pipeline, no size)
  ('a5000000-0000-4000-8000-000000526020', '00000000-0000-4000-8000-000000526001', 'video', 'x', 'video/mp4', 0,
   'f0000000-0000-4000-8000-000000526001.mp4', 'u', 'job', 'f0000000-0000-4000-8000-000000526001', 'a0000000-0000-4000-8000-000000526001', NULL, NULL),
  -- a timeline export filed under its pipeline
  ('a5000000-0000-4000-8000-000000526021', '00000000-0000-4000-8000-000000526001', 'document', 'x', 'application/json', 10,
   'pipelines/a0000000-0000-4000-8000-000000526001/exports/timeline-44444444-4444-4444-8444-444444444444.json', 'u', 'job', NULL, 'a0000000-0000-4000-8000-000000526001', NULL, NULL),
  -- a generation's output later linked to a pipeline entity
  ('a5000000-0000-4000-8000-000000526022', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 10,
   'images/f0000000-0000-4000-8000-000000526001.png', 'u', 'generated', 'f0000000-0000-4000-8000-000000526001', NULL, 'b0000000-0000-4000-8000-000000526001', NULL),
  -- a data upload
  ('a5000000-0000-4000-8000-000000526023', '00000000-0000-4000-8000-000000526001', 'document', 'x', 'text/csv', 10,
   'uploads/datas/44444444-4444-4444-8444-444444444444.csv', 'u', 'manual_upload', NULL, NULL, NULL, NULL),
  -- an upload key spelled in upper case (the shape is case-blind)
  ('a5000000-0000-4000-8000-000000526024', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 10,
   'uploads/images/44444444-4444-4444-8444-444444444444.PNG', 'u', 'manual_upload', NULL, NULL, NULL, NULL),
  -- a generation's row naming its job id in upper case (the family is not)
  ('a5000000-0000-4000-8000-000000526025', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 10,
   'images/ABCDEF01-ABCD-4ABC-8ABC-ABCDEFABCDEF.png', 'u', 'generated', 'abcdef01-abcd-4abc-8abc-abcdefabcdef', NULL, NULL, NULL),
  -- an orphaned generation row, its output spelled in upper case
  ('a5000000-0000-4000-8000-000000526026', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 4096,
   'images/ABCDEF01-ABCD-4ABC-8ABC-ABCDEFABCDEF.png', 'u', 'generated', NULL, NULL, NULL, NULL),
  -- a row of unknown provenance (legacy api)
  ('a5000000-0000-4000-8000-000000526027', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 10,
   'images/33333333-3333-4333-8333-333333333333.png', 'u', 'api', NULL, NULL, NULL, NULL),
  -- a promoted row (library)
  ('a5000000-0000-4000-8000-000000526028', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 10,
   'uploads/images/44444444-4444-4444-8444-444444444444.png', 'u', 'library', NULL, NULL, NULL, NULL),
  -- a row with no upload_source
  ('a5000000-0000-4000-8000-000000526029', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 10,
   'uploads/images/44444444-4444-4444-8444-444444444444.png', 'u', NULL, NULL, NULL, NULL, NULL),
  -- a size-less row with no job, whatever its source
  ('a5000000-0000-4000-8000-000000526030', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 0,
   'uploads/images/44444444-4444-4444-8444-444444444444.png', 'u', 'url_import', NULL, NULL, NULL, NULL),
  -- a row naming no key
  ('a5000000-0000-4000-8000-000000526031', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 0,
   NULL, 'u', 'generated', NULL, NULL, NULL, NULL);

DO $$
DECLARE
  expected jsonb := '{
    "a5000000-0000-4000-8000-000000526001": true,
    "a5000000-0000-4000-8000-000000526002": true,
    "a5000000-0000-4000-8000-000000526003": true,
    "a5000000-0000-4000-8000-000000526004": true,
    "a5000000-0000-4000-8000-000000526005": false,
    "a5000000-0000-4000-8000-000000526006": true,
    "a5000000-0000-4000-8000-000000526007": true,
    "a5000000-0000-4000-8000-000000526008": false,
    "a5000000-0000-4000-8000-000000526009": false,
    "a5000000-0000-4000-8000-000000526010": true,
    "a5000000-0000-4000-8000-000000526011": true,
    "a5000000-0000-4000-8000-000000526012": false,
    "a5000000-0000-4000-8000-000000526013": true,
    "a5000000-0000-4000-8000-000000526014": true,
    "a5000000-0000-4000-8000-000000526015": false,
    "a5000000-0000-4000-8000-000000526016": false,
    "a5000000-0000-4000-8000-000000526017": false,
    "a5000000-0000-4000-8000-000000526018": false,
    "a5000000-0000-4000-8000-000000526019": false,
    "a5000000-0000-4000-8000-000000526020": false,
    "a5000000-0000-4000-8000-000000526021": false,
    "a5000000-0000-4000-8000-000000526022": false,
    "a5000000-0000-4000-8000-000000526023": false,
    "a5000000-0000-4000-8000-000000526024": false,
    "a5000000-0000-4000-8000-000000526025": true,
    "a5000000-0000-4000-8000-000000526026": false,
    "a5000000-0000-4000-8000-000000526027": true,
    "a5000000-0000-4000-8000-000000526028": true,
    "a5000000-0000-4000-8000-000000526029": true,
    "a5000000-0000-4000-8000-000000526030": true,
    "a5000000-0000-4000-8000-000000526031": false
  }';
  k text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(expected) LOOP
    PERFORM pg_temp.assert_eq('insert classification ' || k,
      (SELECT recorded_reference::text FROM public.assets WHERE id = k::uuid), (expected ->> k));
  END LOOP;
END $$;

-- A writer may set the flag itself; the classification can only add to it.
INSERT INTO assets (id, user_id, type, filename, mime_type, size_bytes, r2_key, r2_url, upload_source, recorded_reference) VALUES
  ('a5000000-0000-4000-8000-000000526040', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 10,
   'uploads/images/66666666-6666-4666-8666-666666666666.png', 'u', 'manual_upload', true),
  ('a5000000-0000-4000-8000-000000526041', '00000000-0000-4000-8000-000000526001', 'image', 'x', 'image/png', 0,
   'images/22222222-2222-4222-8222-222222222222.png', 'u', 'generated', false);
SELECT pg_temp.assert_eq('a writer''s own true is kept',
  (SELECT recorded_reference::text FROM public.assets WHERE id = 'a5000000-0000-4000-8000-000000526040'), 'true');
SELECT pg_temp.assert_eq('a writer''s false cannot hide a recorded reference',
  (SELECT recorded_reference::text FROM public.assets WHERE id = 'a5000000-0000-4000-8000-000000526041'), 'true');

DO $$
BEGIN
  -- HIGH: deleting the entity NULLs the attached image's pointer; the flag stays.
  DELETE FROM public.pipeline_entities WHERE id = 'b0000000-0000-4000-8000-000000526001';
  PERFORM pg_temp.assert_eq('the entity pointer was cleared',
    (SELECT (pipeline_entity_id IS NULL)::text FROM public.assets WHERE id = 'a5000000-0000-4000-8000-000000526002'), 'true');
  PERFORM pg_temp.assert_eq('the attached image is still a recorded reference once its entity is gone',
    (SELECT recorded_reference::text FROM public.assets WHERE id = 'a5000000-0000-4000-8000-000000526002'), 'true');
  -- ...and deleting the pipeline clears the pipeline pointers; the flags stay.
  DELETE FROM public.pipelines WHERE id = 'a0000000-0000-4000-8000-000000526001';
  PERFORM pg_temp.assert_eq('the pipeline pointer was cleared',
    (SELECT (pipeline_id IS NULL)::text FROM public.assets WHERE id = 'a5000000-0000-4000-8000-000000526003'), 'true');
  PERFORM pg_temp.assert_eq('the pipeline image is still a recorded reference once its pipeline is gone',
    (SELECT recorded_reference::text FROM public.assets WHERE id = 'a5000000-0000-4000-8000-000000526003'), 'true');
  PERFORM pg_temp.assert_eq('the final merge is still an origin once its pipeline is gone',
    (SELECT recorded_reference::text FROM public.assets WHERE id = 'a5000000-0000-4000-8000-000000526020'), 'false');

  -- Deleting a job NULLs its rows' job_id; an echo row stays a reference.
  DELETE FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-000000526001';
  PERFORM pg_temp.assert_eq('the echo row is still a recorded reference once its job is gone',
    (SELECT recorded_reference::text FROM public.assets WHERE id = 'a5000000-0000-4000-8000-000000526010'), 'true');

  -- Admin promote/demote rewrite upload_source; the flag does not move.
  UPDATE public.assets SET upload_source = 'manual_upload' WHERE id = 'a5000000-0000-4000-8000-000000526001';
  PERFORM pg_temp.assert_eq('rewriting upload_source leaves the flag',
    (SELECT recorded_reference::text FROM public.assets WHERE id = 'a5000000-0000-4000-8000-000000526001'), 'true');

  -- Nobody, the service role included, may clear or set the flag after insert.
  BEGIN
    UPDATE public.assets SET recorded_reference = false WHERE id = 'a5000000-0000-4000-8000-000000526001';
    RAISE EXCEPTION 'ASSERT FAIL: the flag was cleared after insert';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  the flag cannot be cleared after insert';
  END;
  BEGIN
    UPDATE public.assets SET recorded_reference = true WHERE id = 'a5000000-0000-4000-8000-000000526005';
    RAISE EXCEPTION 'ASSERT FAIL: the flag was set after insert';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  the flag cannot be set after insert';
  END;

  -- A row's key can be cleared (the reapers do) but never pointed elsewhere.
  BEGIN
    UPDATE public.assets SET r2_key = 'brand/makers/acme.svg' WHERE id = 'a5000000-0000-4000-8000-000000526005';
    RAISE EXCEPTION 'ASSERT FAIL: a row was re-pointed at another key';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  a row cannot be re-pointed at another key';
  END;
  BEGIN
    UPDATE public.assets SET r2_key = 'brand/makers/acme.svg' WHERE id = 'a5000000-0000-4000-8000-000000526031';
    RAISE EXCEPTION 'ASSERT FAIL: a keyless row was given a key';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  a keyless row cannot be given a key';
  END;
  UPDATE public.assets SET r2_key = NULL, r2_url = NULL WHERE id = 'a5000000-0000-4000-8000-000000526005';
  PERFORM pg_temp.assert_eq('a row''s key can be cleared',
    (SELECT (r2_key IS NULL)::text FROM public.assets WHERE id = 'a5000000-0000-4000-8000-000000526005'), 'true');

  -- ...and a row never changes hands.
  BEGIN
    UPDATE public.assets SET user_id = '00000000-0000-4000-8000-000000526002' WHERE id = 'a5000000-0000-4000-8000-000000526008';
    RAISE EXCEPTION 'ASSERT FAIL: a row changed hands';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  a row never changes hands';
  END;

  -- Ordinary updates still work.
  UPDATE public.assets SET in_library = true WHERE id = 'a5000000-0000-4000-8000-000000526008';
  PERFORM pg_temp.assert_eq('an ordinary update passes',
    (SELECT in_library::text FROM public.assets WHERE id = 'a5000000-0000-4000-8000-000000526008'), 'true');
END $$;

-- The browser roles still write nothing (480), and cannot call the classifier.
DO $$
BEGIN
  PERFORM pg_temp.assert_eq('authenticated cannot execute the classifier',
    has_function_privilege('authenticated', 'public.asset_recorded_reference_by_shape(text, uuid, bigint, uuid, uuid, text, text)', 'EXECUTE')::text, 'false');
  PERFORM pg_temp.assert_eq('anon cannot execute the classifier',
    has_function_privilege('anon', 'public.asset_recorded_reference_by_shape(text, uuid, bigint, uuid, uuid, text, text)', 'EXECUTE')::text, 'false');
  PERFORM pg_temp.assert_eq('the service role can',
    has_function_privilege('service_role', 'public.asset_recorded_reference_by_shape(text, uuid, bigint, uuid, uuid, text, text)', 'EXECUTE')::text, 'true');
  PERFORM pg_temp.assert_eq('authenticated still cannot update assets',
    has_table_privilege('authenticated', 'public.assets', 'UPDATE')::text, 'false');
  RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED';
END $$;

ROLLBACK;
