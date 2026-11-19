-- ============================================================================
-- Behavioral proof: migration 679 names a song's Library file after the take
-- it is, from the job that made it, and touches nothing else.
--
-- WHY THIS PROOF EXISTS. A data migration over stored JSON whose join is a
-- string match on a file's address. Ways it could be silently wrong, none
-- visible in the SQL text:
--   1. It misses a take: the second take (`-v1`, filed only when saved from
--      the canvas, so with no `job_id`) (A2), or a file whose job's history is
--      gone (A3).
--   2. It names the wrong file: another user's file at the same address (B1),
--      an image or video (B2), a file that already has a name (B3).
--   3. It writes what a job never said: a blank or missing title (B4), a job
--      that did not complete (B5), a title past 200 characters (A4: kept to
--      200, trimmed).
--   4. It stamps every file as edited (`assets_updated_at`): the files keep the
--      `metadata.updated_at` they had (C1), and the trigger is on again after
--      (C2).
--   5. A second run changes something (I1).
--
-- HOW IT RUNS. Fixtures, then `\ir` of the REAL migration file (never a copy),
-- then assertions, then the file again. Rolls back. IF THE MIGRATION IS
-- RENUMBERED, both `\ir` lines must follow it.
--
-- Own uuid range ...-0000000f79xx.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/asset-song-names.behavior.sql
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

CREATE FUNCTION pg_temp.name_of(asset uuid) RETURNS text
LANGUAGE sql AS $$ SELECT metadata->>'name' FROM public.assets WHERE id = asset $$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000f7901', 'songs@songs.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f7902', 'other@songs.test', '{}', 'authenticated', 'authenticated');

-- J1: a finished Suno job with two takes. J2: a finished job whose second take
-- has a blank title and whose first has a very long one, padded. J3: a job
-- still running. J4: another user's job naming an address the first user also
-- has a file at.
INSERT INTO public.jobs (id, user_id, job_type, status, created_at, output_data) VALUES
  ('f0000000-0000-4000-8000-0000000f7911', '00000000-0000-4000-8000-0000000f7901', 'suno-generate', 'completed', now() - interval '2 days', jsonb_build_object(
     'audioUrl', 'https://m.test/audios/j1.wav', 'sunoTitle', 'I Found My Love in Portofino',
     'sunoTracks', jsonb_build_array(
       jsonb_build_object('id', 's1', 'title', 'I Found My Love in Portofino', 'audioUrl', 'https://m.test/audios/j1.wav'),
       jsonb_build_object('id', 's2', 'title', 'A Portofino ho trovato l''amore', 'audioUrl', 'https://m.test/audios/j1-v1.wav')))),
  ('f0000000-0000-4000-8000-0000000f7912', '00000000-0000-4000-8000-0000000f7901', 'suno-generate', 'completed', now() - interval '1 day', jsonb_build_object(
     'sunoTracks', jsonb_build_array(
       jsonb_build_object('id', 's3', 'title', '  ' || repeat('x', 250) || '  ', 'audioUrl', 'https://m.test/audios/j2.wav'),
       jsonb_build_object('id', 's4', 'title', '   ', 'audioUrl', 'https://m.test/audios/j2-v1.wav'),
       jsonb_build_object('id', 's5', 'audioUrl', 'https://m.test/audios/j2-v2.wav')))),
  ('f0000000-0000-4000-8000-0000000f7913', '00000000-0000-4000-8000-0000000f7901', 'suno-generate', 'processing', now(), jsonb_build_object(
     'sunoTracks', jsonb_build_array(jsonb_build_object('id', 's6', 'title', 'Not yet', 'audioUrl', 'https://m.test/audios/j3.wav')))),
  ('f0000000-0000-4000-8000-0000000f7914', '00000000-0000-4000-8000-0000000f7902', 'suno-generate', 'completed', now(), jsonb_build_object(
     'sunoTracks', jsonb_build_array(jsonb_build_object('id', 's7', 'title', 'Someone else''s song', 'audioUrl', 'https://m.test/audios/shared.wav'))));

INSERT INTO public.assets (id, user_id, type, filename, mime_type, size_bytes, r2_key, r2_url, upload_source, job_id, metadata) VALUES
  -- A1: the first take, filed by the worker.
  ('a0000000-0000-4000-8000-0000000f7921', '00000000-0000-4000-8000-0000000f7901', 'audio', 'j1.wav', 'audio/mpeg', 10, 'audios/j1.wav', 'https://m.test/audios/j1.wav', 'generated', 'f0000000-0000-4000-8000-0000000f7911', '{"updated_at": "2026-01-02T00:00:00Z"}'),
  -- A2: the second take, saved from the canvas: no job.
  ('a0000000-0000-4000-8000-0000000f7922', '00000000-0000-4000-8000-0000000f7901', 'audio', 'j1-v1.wav', 'audio/mpeg', 0, 'audios/j1-v1.wav', 'https://m.test/audios/j1-v1.wav', 'generated', NULL, '{}'),
  -- A4: a title past 200 characters, padded.
  ('a0000000-0000-4000-8000-0000000f7924', '00000000-0000-4000-8000-0000000f7901', 'audio', 'j2.wav', 'audio/mpeg', 10, 'audios/j2.wav', 'https://m.test/audios/j2.wav', 'generated', 'f0000000-0000-4000-8000-0000000f7912', '{}'),
  -- B1: the first user's own file at the address only the other user's job names.
  ('a0000000-0000-4000-8000-0000000f7931', '00000000-0000-4000-8000-0000000f7901', 'audio', 'shared.wav', 'audio/mpeg', 10, 'audios/shared.wav', 'https://m.test/audios/shared.wav', 'manual_upload', NULL, '{}'),
  -- B2: a video at a take's address.
  ('a0000000-0000-4000-8000-0000000f7932', '00000000-0000-4000-8000-0000000f7901', 'video', 'j1.wav', 'video/mp4', 10, 'videos/j1.wav', 'https://m.test/audios/j1.wav', 'generated', NULL, '{}'),
  -- B3: a take already named.
  ('a0000000-0000-4000-8000-0000000f7933', '00000000-0000-4000-8000-0000000f7901', 'audio', 'j1-v1.wav', 'audio/mpeg', 0, 'audios/j1-v1-copy.wav', 'https://m.test/audios/j1-v1.wav', 'generated', NULL, '{"name": "My own name"}'),
  -- B4: a blank title, and a take with none.
  ('a0000000-0000-4000-8000-0000000f7934', '00000000-0000-4000-8000-0000000f7901', 'audio', 'j2-v1.wav', 'audio/mpeg', 0, 'audios/j2-v1.wav', 'https://m.test/audios/j2-v1.wav', 'generated', NULL, '{}'),
  ('a0000000-0000-4000-8000-0000000f7935', '00000000-0000-4000-8000-0000000f7901', 'audio', 'j2-v2.wav', 'audio/mpeg', 0, 'audios/j2-v2.wav', 'https://m.test/audios/j2-v2.wav', 'generated', NULL, '{}'),
  -- B5: a take of a job still running.
  ('a0000000-0000-4000-8000-0000000f7936', '00000000-0000-4000-8000-0000000f7901', 'audio', 'j3.wav', 'audio/mpeg', 0, 'audios/j3.wav', 'https://m.test/audios/j3.wav', 'generated', NULL, '{}');

-- A3: the first take's job history deleted after it was filed (job_id NULLed): still named by its address.
INSERT INTO public.assets (id, user_id, type, filename, mime_type, size_bytes, r2_key, r2_url, upload_source, job_id, metadata) VALUES
  ('a0000000-0000-4000-8000-0000000f7923', '00000000-0000-4000-8000-0000000f7901', 'audio', 'j1.wav', 'audio/mpeg', 0, 'audios/j1-again.wav', 'https://m.test/audios/j1.wav', 'generated', NULL, '{}');

\ir ../migrations/679_asset_song_names.sql

SELECT pg_temp.assert_eq('A1 the first take is named', pg_temp.name_of('a0000000-0000-4000-8000-0000000f7921'), 'I Found My Love in Portofino');
SELECT pg_temp.assert_eq('A2 the second take, saved with no job, is named', pg_temp.name_of('a0000000-0000-4000-8000-0000000f7922'), 'A Portofino ho trovato l''amore');
SELECT pg_temp.assert_eq('A3 a file whose job history is gone is named', pg_temp.name_of('a0000000-0000-4000-8000-0000000f7923'), 'I Found My Love in Portofino');
SELECT pg_temp.assert_eq('A4 a long title is trimmed and kept to 200', pg_temp.name_of('a0000000-0000-4000-8000-0000000f7924'), repeat('x', 200));
SELECT pg_temp.assert_eq('B1 another user''s job never names this user''s file', pg_temp.name_of('a0000000-0000-4000-8000-0000000f7931'), NULL);
SELECT pg_temp.assert_eq('B2 a video is never named', pg_temp.name_of('a0000000-0000-4000-8000-0000000f7932'), NULL);
SELECT pg_temp.assert_eq('B3 a file already named keeps its name', pg_temp.name_of('a0000000-0000-4000-8000-0000000f7933'), 'My own name');
SELECT pg_temp.assert_eq('B4 a blank title names nothing', pg_temp.name_of('a0000000-0000-4000-8000-0000000f7934'), NULL);
SELECT pg_temp.assert_eq('B4 a take with no title names nothing', pg_temp.name_of('a0000000-0000-4000-8000-0000000f7935'), NULL);
SELECT pg_temp.assert_eq('B5 a job still running names nothing', pg_temp.name_of('a0000000-0000-4000-8000-0000000f7936'), NULL);
SELECT pg_temp.assert_eq('C1 a named file keeps the updated_at it had',
  (SELECT metadata->>'updated_at' FROM public.assets WHERE id = 'a0000000-0000-4000-8000-0000000f7921'), '2026-01-02T00:00:00Z');
SELECT pg_temp.assert_eq('C1 a file named with no updated_at gets none',
  (SELECT metadata->>'updated_at' FROM public.assets WHERE id = 'a0000000-0000-4000-8000-0000000f7922'), NULL);
SELECT pg_temp.assert_eq('C2 the updated_at trigger is on again',
  (SELECT tgenabled::text FROM pg_trigger WHERE tgname = 'assets_updated_at' AND tgrelid = 'public.assets'::regclass), 'O');

-- I1: a second run changes nothing.
CREATE TEMP TABLE before_rerun AS SELECT id, metadata FROM public.assets WHERE user_id IN ('00000000-0000-4000-8000-0000000f7901', '00000000-0000-4000-8000-0000000f7902');
\ir ../migrations/679_asset_song_names.sql
SELECT pg_temp.assert_eq('I1 a second run changes nothing',
  (SELECT count(*)::text FROM public.assets a JOIN before_rerun b USING (id) WHERE a.metadata IS DISTINCT FROM b.metadata), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
