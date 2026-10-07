-- ============================================================================
-- Behavioral proof: a scene's storage urls in `metadata.scene_node_data` name
-- only the pipeline owner's objects (migration 482, decided 2026-10-07).
--
-- 480 holds a scene's asset IDS to the owner's assets; 482 does the same for
-- the urls beside them, which are what the server downloads and forwards.
-- Whose object a url names is key-ownership.ts's rule asked of the url's path:
-- a job's key family or the upload namespace says who MADE it (and the maker
-- decides), otherwise another user's `assets` row naming it says it is HELD
-- by someone else. Only a url that changed is judged; an insert or a move
-- judges every url.
--
-- Own uuid range ...-0000000e7501 upward.
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

-- A (victim) and B (attacker, and the scenes' owner), each with a pipeline, a
-- generated image (a job whose key family is `images/<jobId>.png`), and a
-- plain library upload whose key names no maker.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000e7501', 'victim@scene-url.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e7502', 'attacker@scene-url.test', '{}', 'authenticated', 'authenticated');
INSERT INTO pipelines (id, user_id, root_node_id, pipeline_type, activation_mode, mode, input_prompt, target_duration_seconds, format) VALUES
  ('a0000000-0000-4000-8000-0000000e7501', '00000000-0000-4000-8000-0000000e7501', 'root', 'story_to_video', 'interactive', 'manual', 'victim story', 30, 'short_film'),
  ('a0000000-0000-4000-8000-0000000e7502', '00000000-0000-4000-8000-0000000e7502', 'root', 'story_to_video', 'interactive', 'manual', 'attacker story', 30, 'short_film');
INSERT INTO jobs (id, user_id, job_type, status) VALUES
  ('f0000000-0000-4000-8000-0000000e7501', '00000000-0000-4000-8000-0000000e7501', 'generate-image', 'completed'),
  ('f0000000-0000-4000-8000-0000000e7502', '00000000-0000-4000-8000-0000000e7502', 'generate-image', 'completed');
INSERT INTO assets (id, user_id, type, filename, mime_type, size_bytes, r2_key, r2_url) VALUES
  ('a5000000-0000-4000-8000-0000000e7501', '00000000-0000-4000-8000-0000000e7501', 'image', 'victim-plain.png', 'image/png', 1,
   'uploads/images/victim-plain.png', 'https://media.example/uploads/images/victim-plain.png'),
  ('a5000000-0000-4000-8000-0000000e7502', '00000000-0000-4000-8000-0000000e7502', 'image', 'thief-plain.png', 'image/png', 1,
   'uploads/images/thief-plain.png', 'https://media.example/uploads/images/thief-plain.png'),
  -- The victim saved the attacker's generated image to their library (a
  -- library save stores the maker's key on purpose): held by A, made by B.
  ('a5000000-0000-4000-8000-0000000e7503', '00000000-0000-4000-8000-0000000e7501', 'image', 'saved.png', 'image/png', 1,
   'images/f0000000-0000-4000-8000-0000000e7502.png', 'https://media.example/images/f0000000-0000-4000-8000-0000000e7502.png');
-- Review round (decided 2026-10-07): the victim's plain upload, which the
-- attacker saved to their own library a day later (a library save writes a
-- row for any url it is given); and a key two users claimed at the same time.
INSERT INTO assets (id, user_id, type, filename, mime_type, size_bytes, r2_key, r2_url, created_at) VALUES
  ('a5000000-0000-4000-8000-0000000e7504', '00000000-0000-4000-8000-0000000e7501', 'image', 'ref.png', 'image/png', 1,
   'uploads/images/victim-ref.png', 'https://media.example/uploads/images/victim-ref.png', '2026-10-01 10:00:00.000001+00'),
  ('a5000000-0000-4000-8000-0000000e7505', '00000000-0000-4000-8000-0000000e7502', 'image', 'ref.png', 'image/png', 1,
   'uploads/images/victim-ref.png', 'https://media.example/uploads/images/victim-ref.png', '2026-10-02 10:00:00+00'),
  ('a5000000-0000-4000-8000-0000000e7506', '00000000-0000-4000-8000-0000000e7501', 'image', 'tied.png', 'image/png', 1,
   'uploads/images/tied.png', 'https://media.example/uploads/images/tied.png', '2026-10-01 10:00:00+00'),
  ('a5000000-0000-4000-8000-0000000e7507', '00000000-0000-4000-8000-0000000e7502', 'image', 'tied.png', 'image/png', 1,
   'uploads/images/tied.png', 'https://media.example/uploads/images/tied.png', '2026-10-01 10:00:00+00');

-- 0. The browser roles cannot call the judgment (no oracle on whose a url is).
SELECT pg_temp.assert_eq('anon and authenticated cannot execute storage_url_is_foreign or the url helpers',
  (SELECT bool_or(has_function_privilege(r, f, 'EXECUTE'))::text
     FROM unnest(ARRAY['anon', 'authenticated']) AS r,
          unnest(ARRAY['public.storage_url_is_foreign(text, uuid)', 'public.scene_node_data_urls(jsonb)',
                       'public.storage_url_path(text)']) AS f),
  'false');
SELECT pg_temp.assert_eq('anon and authenticated cannot execute the review round''s url helpers',
  (SELECT bool_or(has_function_privilege(r, f, 'EXECUTE'))::text
     FROM unnest(ARRAY['anon', 'authenticated']) AS r,
          unnest(ARRAY['public.storage_url_normalize(text)', 'public.storage_url_ascii_decode(text)',
                       'public.storage_url_query_urls(text)']) AS f),
  'false');

SET LOCAL ROLE service_role;

-- 1. A new scene naming the victim's generated image is refused.
DO $$ BEGIN
  INSERT INTO public.pipeline_entities (pipeline_id, entity_type, entity_key, metadata)
  VALUES ('a0000000-0000-4000-8000-0000000e7502', 'scene', 'scene_01',
          '{"scene_node_data":{"shots":[{"shot_id":"s1","keyframe_url":"https://media.example/images/f0000000-0000-4000-8000-0000000e7501.png"}]}}');
  RAISE EXCEPTION 'ASSERT FAIL: a scene was inserted with a keyframe url naming another user''s object';
EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM NOT LIKE '%storage urls%' THEN RAISE; END IF;
  RAISE NOTICE 'ok  a scene inserted with a keyframe url naming another user''s generated image is refused';
END $$;

-- 2. The owner's scene: the owner's own generated image, the owner's upload
--    namespace, the owner's plain upload, an external url, and the owner's
--    image that the victim saved to their library (the maker decides).
INSERT INTO public.pipeline_entities (id, pipeline_id, entity_type, entity_key, metadata) VALUES
  ('b0000000-0000-4000-8000-0000000e7510', 'a0000000-0000-4000-8000-0000000e7502', 'scene', 'scene_02',
   '{"scene_node_data":{"scene_index":2,"shots":[
      {"shot_id":"s1","keyframe_url":"https://media.example/images/f0000000-0000-4000-8000-0000000e7502.png",
       "video_url":"https://media.example/videos/f0000000-0000-4000-8000-0000000e7502-clip.mp4"},
      {"shot_id":"s2","keyframe_url":"https://media.example/uploads/images/00000000-0000-4000-8000-0000000e7502/kf.png",
       "interpolation_keyframe_urls":["https://media.example/uploads/images/thief-plain.png","https://provider.example/out.png"]}],
     "composite_video_url":"https://provider.example/composite.mp4"}}');
SELECT pg_temp.assert_eq('a scene naming its owner''s objects and an external url is accepted',
  (SELECT metadata#>>'{scene_node_data,shots,0,keyframe_url}' FROM public.pipeline_entities
    WHERE id = 'b0000000-0000-4000-8000-0000000e7510'),
  'https://media.example/images/f0000000-0000-4000-8000-0000000e7502.png');

-- 3. Every url slot, and every spelling of another user's object, refuses it.
--    The asset refs carry the owner's own asset id, so only the url is judged.
DO $$
DECLARE
  v_patch   jsonb;
  v_refused int := 0;
  v_tried   int := 0;
BEGIN
  FOR v_patch IN SELECT p FROM jsonb_array_elements('[
    {"shots":[{"shot_id":"s1","keyframe_url":"https://media.example/images/f0000000-0000-4000-8000-0000000e7501.png"}]},
    {"shots":[{"shot_id":"s1","video_url":"https://media.example/videos/f0000000-0000-4000-8000-0000000e7501.mp4"}]},
    {"shots":[{"shot_id":"s1","last_frame_url":"https://media.example/images/f0000000-0000-4000-8000-0000000e7501-last.png"}]},
    {"shots":[{"shot_id":"s1","audio_url":"https://media.example/audios/f0000000-0000-4000-8000-0000000e7501.mp3"}]},
    {"shots":[{"shot_id":"s1","lipsynced_url":"https://media.example/videos/f0000000-0000-4000-8000-0000000e7501.mp4"}]},
    {"shots":[{"shot_id":"s1","bridged_frame_url":"https://media.example/images/f0000000-0000-4000-8000-0000000e7501.png"}]},
    {"shots":[{"shot_id":"s1","interpolation_keyframe_urls":["https://provider.example/a.png","https://media.example/images/f0000000-0000-4000-8000-0000000e7501.png"]}]},
    {"composite_video_url":"https://media.example/videos/f0000000-0000-4000-8000-0000000e7501.mp4"},
    {"scene_anchor_keyframe":{"asset_id":"a5000000-0000-4000-8000-0000000e7502","url":"https://media.example/images/f0000000-0000-4000-8000-0000000e7501.png"}},
    {"generated_keyframes":[{"asset_id":"a5000000-0000-4000-8000-0000000e7502","url":"https://media.example/images/f0000000-0000-4000-8000-0000000e7501.png"}]},
    {"generated_clips":[{"asset_id":"a5000000-0000-4000-8000-0000000e7502","url":"https://media.example/videos/f0000000-0000-4000-8000-0000000e7501.mp4"}]},
    {"composite_video":{"asset_id":"a5000000-0000-4000-8000-0000000e7502","url":"https://media.example/videos/f0000000-0000-4000-8000-0000000e7501.mp4"}},
    {"last_frame":{"asset_id":"a5000000-0000-4000-8000-0000000e7502","url":"https://media.example/images/f0000000-0000-4000-8000-0000000e7501.png"}},
    {"scene_audio_track":{"asset_id":"a5000000-0000-4000-8000-0000000e7502","url":"https://media.example/audios/f0000000-0000-4000-8000-0000000e7501.mp3"}},
    {"composite_video_url":"https://media.example/uploads/images/00000000-0000-4000-8000-0000000e7501/private.png"},
    {"composite_video_url":"https://media.example/uploads/handoff/videos/00000000-0000-4000-8000-0000000e7501/clip.mp4"},
    {"composite_video_url":"https://media.example/uploads/images/victim-plain.png"},
    {"composite_video_url":"https://pub-0000.r2.dev/uploads/images/victim-plain.png"},
    {"composite_video_url":"https://media.example/bucket-prefix/uploads/images/victim-plain.png"},
    {"composite_video_url":"http://media.example/images/F0000000-0000-4000-8000-0000000E7501.png?v=2#x"},
    {"composite_video_url":"https://media.example/images/%66%30000000-0000-4000-8000-0000000e7501.png"},
    {"composite_video_url":"https://media.example/uploads/images/victim%2Dplain.png"}
  ]'::jsonb) AS t(p)
  LOOP
    v_tried := v_tried + 1;
    BEGIN
      UPDATE public.pipeline_entities
         SET metadata = jsonb_set(metadata, '{scene_node_data}', (metadata->'scene_node_data') || v_patch)
       WHERE id = 'b0000000-0000-4000-8000-0000000e7510';
      RAISE EXCEPTION 'ASSERT FAIL: a scene took another user''s object through %', v_patch;
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%storage urls%' THEN RAISE; END IF;
      v_refused := v_refused + 1;
    END;
  END LOOP;
  PERFORM pg_temp.assert_eq('every scene url slot and spelling refuses another user''s object (made by or held by them)',
    v_refused::text, v_tried::text);
END $$;
SELECT pg_temp.assert_eq('the refused writes left the scene as it was',
  (SELECT metadata#>>'{scene_node_data,composite_video_url}' FROM public.pipeline_entities
    WHERE id = 'b0000000-0000-4000-8000-0000000e7510'),
  'https://provider.example/composite.mp4');

-- 4. The owner's own objects pass in the same slots.
UPDATE public.pipeline_entities
   SET metadata = jsonb_set(metadata, '{scene_node_data}', (metadata->'scene_node_data') ||
     '{"composite_video_url":"https://media.example/videos/f0000000-0000-4000-8000-0000000e7502-composite.mp4",
       "last_frame":{"asset_id":"a5000000-0000-4000-8000-0000000e7502","url":"https://media.example/uploads/images/thief-plain.png"}}')
 WHERE id = 'b0000000-0000-4000-8000-0000000e7510';
SELECT pg_temp.assert_eq('the owner''s own objects are accepted in the scene''s url slots',
  (SELECT metadata#>>'{scene_node_data,last_frame,url}' FROM public.pipeline_entities
    WHERE id = 'b0000000-0000-4000-8000-0000000e7510'),
  'https://media.example/uploads/images/thief-plain.png');

-- 5. Moving the scene into the victim's pipeline judges every url it carries:
--    the attacker's generated image is not the victim's. (A scene with urls
--    only, so the ids' own check cannot be what refuses it.)
INSERT INTO public.pipeline_entities (id, pipeline_id, entity_type, entity_key, metadata) VALUES
  ('b0000000-0000-4000-8000-0000000e7511', 'a0000000-0000-4000-8000-0000000e7502', 'scene', 'scene_03',
   '{"scene_node_data":{"scene_index":3,"shots":[
      {"shot_id":"s1","keyframe_url":"https://media.example/images/f0000000-0000-4000-8000-0000000e7502.png"}]}}');
DO $$ BEGIN
  UPDATE public.pipeline_entities SET pipeline_id = 'a0000000-0000-4000-8000-0000000e7501'
   WHERE id = 'b0000000-0000-4000-8000-0000000e7511';
  RAISE EXCEPTION 'ASSERT FAIL: a scene was moved into another user''s pipeline still naming its old owner''s objects';
EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM NOT LIKE '%storage urls%' THEN RAISE; END IF;
  RAISE NOTICE 'ok  moving a scene whose urls name its owner''s objects into another user''s pipeline is refused';
END $$;

-- 6. Review round (decided 2026-10-07). Each case failed before the fix.
-- 6a. A maker-less key belongs to its earliest claimant: another user saving
--     the owner's upload later does not take it from the owner, and gains
--     nothing for themselves. A tie cannot be told apart, so it is foreign.
SELECT pg_temp.assert_eq('the owner''s upload stays the owner''s after another user saves it to their library',
  public.storage_url_is_foreign('https://media.example/uploads/images/victim-ref.png', '00000000-0000-4000-8000-0000000e7501')::text,
  'false');
SELECT pg_temp.assert_eq('the later claimant of a maker-less key gains nothing (still foreign to them)',
  public.storage_url_is_foreign('https://media.example/uploads/images/victim-ref.png', '00000000-0000-4000-8000-0000000e7502')::text,
  'true');
SELECT pg_temp.assert_eq('two claims made at the same instant are foreign to either user',
  (public.storage_url_is_foreign('https://media.example/uploads/images/tied.png', '00000000-0000-4000-8000-0000000e7501')
   AND public.storage_url_is_foreign('https://media.example/uploads/images/tied.png', '00000000-0000-4000-8000-0000000e7502'))::text,
  'true');
INSERT INTO public.pipeline_entities (id, pipeline_id, entity_type, entity_key, metadata) VALUES
  ('b0000000-0000-4000-8000-0000000e7530', 'a0000000-0000-4000-8000-0000000e7501', 'scene', 'scene_06',
   '{"scene_node_data":{"scene_index":6,"scene_anchor_keyframe":{"url":"https://media.example/uploads/images/victim-ref.png"}}}');
SELECT pg_temp.assert_eq('the owner''s scene naming their own upload, which another user also saved, is accepted',
  (SELECT metadata#>>'{scene_node_data,scene_anchor_keyframe,url}' FROM public.pipeline_entities
    WHERE id = 'b0000000-0000-4000-8000-0000000e7530'),
  'https://media.example/uploads/images/victim-ref.png');

-- 6b. Our own proxy routes (and any `url` query parameter, on any host) are
--     judged by the url they carry; 6c. tab, newline and backslash spellings
--     are read as a browser reads them. Every one names the victim's image.
DO $$
DECLARE
  v_url     text;
  v_refused int := 0;
  v_tried   int := 0;
BEGIN
  FOR v_url IN SELECT u FROM unnest(ARRAY[
    'https://api.example/v1/download?url=https%3A%2F%2Fmedia.example%2Fimages%2Ff0000000-0000-4000-8000-0000000e7501.png',
    'https://app.example/api/v1/image-proxy?url=https%3A%2F%2Fmedia.example%2Fimages%2Ff0000000-0000-4000-8000-0000000e7501.png',
    'https://api.example/v1/download?x=1&%75rl=https%3A%2F%2Fmedia.example%2Fimages%2Ff0000000-0000-4000-8000-0000000e7501.png#f',
    'https://api.example/v1/image-proxy?url=' || 'https%3A%2F%2Fapi.example%2Fv1%2Fdownload%3Furl%3Dhttps%253A%252F%252Fmedia.example%252Fimages%252Ff0000000-0000-4000-8000-0000000e7501.png',
    'https://media.example/images/f0000000' || chr(9) || '-0000-4000-8000-0000000e7501.png',
    'https://media.example/images/f0000000-0000-4000-8000-0000000e7501' || chr(10) || '.png',
    'https://media.example/images' || chr(92) || 'f0000000-0000-4000-8000-0000000e7501.png',
    ' https://media.example/images/f0000000-0000-4000-8000-0000000e7501' || chr(13) || chr(31),
    'https://media.example/uploads' || chr(92) || 'images' || chr(92) || 'victim-plain.png'
  ]) AS t(u)
  LOOP
    v_tried := v_tried + 1;
    IF public.storage_url_is_foreign(v_url, '00000000-0000-4000-8000-0000000e7502') THEN
      v_refused := v_refused + 1;
    ELSE
      RAISE EXCEPTION 'ASSERT FAIL: % was not judged foreign', v_url;
    END IF;
    BEGIN
      UPDATE public.pipeline_entities
         SET metadata = jsonb_set(metadata, '{scene_node_data,composite_video_url}', to_jsonb(v_url))
       WHERE id = 'b0000000-0000-4000-8000-0000000e7510';
      RAISE EXCEPTION 'ASSERT FAIL: a scene took another user''s object through %', v_url;
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%storage urls%' THEN RAISE; END IF;
    END;
  END LOOP;
  PERFORM pg_temp.assert_eq('a proxy url, a url= parameter, and tab/newline/backslash spellings of another user''s object are refused',
    v_refused::text, v_tried::text);
END $$;
SELECT pg_temp.assert_eq('a proxy url carrying the owner''s own object, or an external url, passes',
  (public.storage_url_is_foreign('https://api.example/v1/download?url=https%3A%2F%2Fmedia.example%2Fimages%2Ff0000000-0000-4000-8000-0000000e7502.png', '00000000-0000-4000-8000-0000000e7502')
   OR public.storage_url_is_foreign('https://api.example/v1/image-proxy?url=https%3A%2F%2Fprovider.example%2Fa.png&urls=https%3A%2F%2Fmedia.example%2Fimages%2Ff0000000-0000-4000-8000-0000000e7501.png', '00000000-0000-4000-8000-0000000e7502'))::text,
  'false');

-- 6d. The trigger's url reading. The SAME table is asserted against the
--     backend's port (storageUrlPathAnyHost / storageUrlQueryUrls in
--     backend/src/lib/key-ownership.ts, scene-url-ownership.test.ts), so the
--     write-side pre-checks and this trigger cannot drift apart.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('https://cdn.example/images/a.png', 'images/a.png'),
    ('https://cdn.example/images' || chr(92) || 'b.png', 'images/b.png'),
    ('https://cdn.example/images/ab' || chr(9) || '-c' || chr(10) || 'd' || chr(13) || '.png', 'images/ab-cd.png'),
    ('  https://cdn.example/x.png' || chr(10) || ' ', 'x.png'),
    (chr(1) || 'https://cdn.example/y.png' || chr(31), 'y.png'),
    ('http://cdn.example/a/%66oo.png?v=1#x', 'a/foo.png'),
    ('https://cdn.example//a.png', 'a.png'),
    ('https://bad host/a/b.png', 'a/b.png'),
    ('https:/cdn.example/a.png', 'https:/cdn.example/a.png'),
    ('https://cdn.example/a%2Fb.png', 'a/b.png'),
    ('https://cdn.example/a%E2%82%AC.png', 'a%E2%82%AC.png'),
    ('https:' || chr(92) || chr(92) || 'cdn.example' || chr(92) || 'images' || chr(92) || 'c.png', 'images/c.png'),
    ('https://cdn.example/a%5Cb.png', 'a' || chr(92) || 'b.png')
  ) AS g(url, path)
  LOOP
    PERFORM pg_temp.assert_eq('storage_url_path ' || quote_literal(r.url), public.storage_url_path(r.url), r.path);
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('https://api.example/v1/download?url=https%3A%2F%2Fcdn.example%2Fimages%2Fa.png', '["https://cdn.example/images/a.png"]'),
    ('https://api.example/v1/image-proxy?x=1&%75rl=https%3A%2F%2Fcdn.example%2Fb.png#url=nope', '["https://cdn.example/b.png"]'),
    ('https://api.example/p?url=a+b&url=c', '["a b", "c"]'),
    ('https://api.example/p?urls=x&curl=y&url', '[""]'),
    ('https://api.example/p' || chr(9) || '?u' || chr(10) || 'rl=z', '["z"]'),
    ('https://api.example/p#?url=z', '[]')
  ) AS g(url, inner_urls)
  LOOP
    PERFORM pg_temp.assert_eq('storage_url_query_urls ' || quote_literal(r.url),
      (SELECT coalesce(jsonb_agg(q.u), '[]'::jsonb)::text FROM public.storage_url_query_urls(r.url) AS q(u)),
      r.inner_urls::jsonb::text);
  END LOOP;
END $$;
RESET ROLE;

-- ------------------------------------------------- rows planted before 482
-- The attacker's scene naming the victim's image, written the way it could
-- be before 482 (triggers off: the old world). Re-applying 482 counts it and
-- changes nothing; a write that keeps the planted url passes, a new foreign
-- url beside it is refused, and replacing it with the owner's own passes.
ALTER TABLE public.pipeline_entities DISABLE TRIGGER trg_pipeline_entities_asset_owner;
INSERT INTO public.pipeline_entities (id, pipeline_id, entity_type, entity_key, metadata) VALUES
  ('b0000000-0000-4000-8000-0000000e7520', 'a0000000-0000-4000-8000-0000000e7502', 'scene', 'scene_05',
   '{"scene_node_data":{"scene_index":5,"shots":[
      {"shot_id":"s1","keyframe_url":"https://media.example/images/f0000000-0000-4000-8000-0000000e7501.png"},
      {"shot_id":"s2"}]}}');
ALTER TABLE public.pipeline_entities ENABLE TRIGGER trg_pipeline_entities_asset_owner;

\ir ../migrations/482_scene_url_ownership.sql

SET LOCAL ROLE service_role;
DO $$ BEGIN
  PERFORM pg_temp.assert_eq('a planted scene url stays in its row (counted, not changed)',
    (SELECT metadata#>>'{scene_node_data,shots,0,keyframe_url}' FROM public.pipeline_entities
      WHERE id = 'b0000000-0000-4000-8000-0000000e7520'),
    'https://media.example/images/f0000000-0000-4000-8000-0000000e7501.png');
  UPDATE public.pipeline_entities
     SET metadata = jsonb_set(metadata, '{scene_node_data,shots}', jsonb_build_array(
           (metadata#>'{scene_node_data,shots,1}') || '{"motion_prompt":"slow push in"}',
           metadata#>'{scene_node_data,shots,0}'))
   WHERE id = 'b0000000-0000-4000-8000-0000000e7520';
  PERFORM pg_temp.assert_eq('a planted scene still takes a write that keeps its url and reorders its shots',
    (SELECT (metadata#>>'{scene_node_data,shots,0,motion_prompt}') || ' ' || (metadata#>>'{scene_node_data,shots,1,keyframe_url}')
       FROM public.pipeline_entities WHERE id = 'b0000000-0000-4000-8000-0000000e7520'),
    'slow push in https://media.example/images/f0000000-0000-4000-8000-0000000e7501.png');
  BEGIN
    UPDATE public.pipeline_entities
       SET metadata = jsonb_set(metadata, '{scene_node_data,shots,0,video_url}',
                                '"https://media.example/videos/f0000000-0000-4000-8000-0000000e7501.mp4"')
     WHERE id = 'b0000000-0000-4000-8000-0000000e7520';
    RAISE EXCEPTION 'ASSERT FAIL: a planted scene took a second foreign url';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%storage urls%' THEN RAISE; END IF;
    RAISE NOTICE 'ok  a planted scene still refuses a new url naming another user''s object';
  END;
  UPDATE public.pipeline_entities
     SET metadata = jsonb_set(metadata, '{scene_node_data,shots,1,keyframe_url}',
                              '"https://media.example/images/f0000000-0000-4000-8000-0000000e7502.png"')
   WHERE id = 'b0000000-0000-4000-8000-0000000e7520';
  PERFORM pg_temp.assert_eq('replacing a planted scene url with the owner''s own passes',
    (SELECT metadata#>>'{scene_node_data,shots,1,keyframe_url}' FROM public.pipeline_entities
      WHERE id = 'b0000000-0000-4000-8000-0000000e7520'),
    'https://media.example/images/f0000000-0000-4000-8000-0000000e7502.png');
  RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED';
END $$;

ROLLBACK;
