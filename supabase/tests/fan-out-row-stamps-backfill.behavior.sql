-- ============================================================================
-- Behavioral proof: migration 459 stamps the rows of a server fan-out run of
-- ANY node type recorded before rows carried their own identity, from the job
-- that made each row, and touches nothing else (decided 2026-10-05).
--
-- WHY THIS PROOF EXISTS. A data migration over stored JSON, whose join is a
-- string match on three keys. Ways it could be silently wrong, none visible in
-- the SQL text:
--   1. It pairs a row with the wrong job: a retry in the same slot whose URL is
--      not the row's (S2), or two jobs that both claim a row (S3).
--   2. It invents what a job never said: a clipKey on a render that had none,
--      or a quality other than the worker's rule (S1), or a render's quality
--      on another node type whose job happens to carry a `quality` (S4).
--   3. It misses a type: an image or video fan-out (S4), an empty `imageUrl`
--      beside the real `videoUrl` (S4), or a sync-HTTP fan-out such as Save to
--      Storage (S5), whose job rows the route creates itself: no
--      `workflow_execution_id`, no `iterationIndex`, only the `node_id` the
--      orchestrator stamps afterwards, and a `{ url, filename, type }` output.
--      Those rows are named by URL alone (exactly one completed job of the
--      execution's user for that node made it), never by position: a URL only
--      another user's job made, or two jobs made, stays `{}` (S6).
--   4. It rewrites node state it must not: a run still in flight (N1), a node
--      already stamped (N2), a one-row result (N3), a run with no matching job
--      at all (N5), or a text row that only looks like a match (N6).
--   5. A second run changes something (I1).
--   6. Its URL or stamp rule drifts from the server's load / save injection
--      (backend/src/lib/canvas-result-ids.ts): section X runs the SHARED
--      fixtures (fixtures/job-row-stamps.sql) that the backend test also reads.
--   7. Pass 3 (single takes, decided 2026-10-05): an Apply EDL run that
--      rendered ONE take (no fan-out, or a one-row one) takes the quality it
--      was ordered at, from the job its state names, by the same stamp
--      function (T1-T3); it never touches a take that already says, a job
--      whose URL or node is not the take's, a job of another run, another
--      node type, a run still in flight, or a fan-out the first two passes own (T4-T8, N1, S1).
--
-- HOW IT RUNS. Fixtures, then `\ir` of the REAL migration file (never a copy —
-- a copy drifts), then assertions, then the file again. Rolls back.
-- `\ir`, NOT `\i`: it resolves relative to THIS file, so the proof runs from
-- any cwd. IF THE MIGRATION IS RENUMBERED, both `\ir` lines must follow it.
--
-- Own uuid range ...-0000000e7xx.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/fan-out-row-stamps-backfill.behavior.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, actual jsonb, expected jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual::text, '<null>'), coalesce(expected::text, '<null>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000e7001', 'stamps@stamps.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e7002', 'other@stamps.test', '{}', 'authenticated', 'authenticated');
INSERT INTO projects (id, user_id, name) VALUES
  ('c0000000-0000-4000-8000-0000000e7001', '00000000-0000-4000-8000-0000000e7001', 'stamps project');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('d0000000-0000-4000-8000-0000000e7001', 'c0000000-0000-4000-8000-0000000e7001', '00000000-0000-4000-8000-0000000e7001', 'stamps wf');

-- E1 (completed): `render` ran per clip — row 0 a pre-A1b preview, row 1 a
-- render that wrote its own quality + clipKey, row 2 failed. `stamped` already
-- has stamps. `script` is a video fan-out, `images` an image fan-out whose jobs
-- carry thumbnails (and a `quality` that is not a render's), `store` and
-- `store2` Save to Storage fan-outs (sync-HTTP rows), `texts` an LLM fan-out. `single` has one row. `dupe` has two
-- completed jobs claiming its row 0.
-- E2 (running): the same shape as E1's render. E3 (completed): no job matches.
INSERT INTO workflow_executions (id, workflow_id, user_id, status, node_states) VALUES
  ('e0000000-0000-4000-8000-0000000e7001', 'd0000000-0000-4000-8000-0000000e7001', '00000000-0000-4000-8000-0000000e7001', 'completed', '{
     "render":  {"status": "completed", "jobId": "f0000000-0000-4000-8000-0000000e7010", "output": {"videoUrl": "https://m.test/r0.mp4", "listResults": ["https://m.test/r0.mp4", "https://m.test/r1.mp4", ""]}},
     "stamped": {"status": "completed", "output": {"listResults": ["https://m.test/s0.mp4", "https://m.test/s1.mp4"], "listResultStamps": [{"jobId": "keep"}, {}]}},
     "script":  {"status": "completed", "output": {"listResults": ["https://m.test/t0.mp4", "https://m.test/t1.mp4", "https://m.test/t2.mp4"]}},
     "single":  {"status": "completed", "output": {"listResults": ["https://m.test/one.mp4"]}},
     "dupe":    {"status": "completed", "output": {"listResults": ["https://m.test/d0.mp4", "https://m.test/d1.mp4"]}},
     "images":  {"status": "completed", "output": {"imageUrl": "https://m.test/i0.png", "listResults": ["https://m.test/i0.png", "https://m.test/i1.png"]}},
     "store":   {"status": "completed", "output": {"listResults": ["https://m.test/st0.mp4", "https://m.test/st1.png"]}},
     "store2":  {"status": "completed", "output": {"listResults": ["https://m.test/sa.mp4", "https://m.test/sb.mp4", "https://m.test/sc.mp4"]}},
     "texts":   {"status": "completed", "output": {"listResults": ["a line", "another line"]}}
   }'::jsonb),
  ('e0000000-0000-4000-8000-0000000e7002', 'd0000000-0000-4000-8000-0000000e7001', '00000000-0000-4000-8000-0000000e7001', 'running', '{
     "render": {"status": "running", "output": {"listResults": ["https://m.test/x0.mp4", "https://m.test/x1.mp4"]}},
     "take":   {"status": "completed", "jobId": "f0000000-0000-4000-8000-0000000e7060", "output": {"videoUrl": "https://m.test/rt.mp4"}}
   }'::jsonb),
  ('e0000000-0000-4000-8000-0000000e7003', 'd0000000-0000-4000-8000-0000000e7001', '00000000-0000-4000-8000-0000000e7001', 'failed', '{
     "render": {"status": "completed", "output": {"listResults": ["https://m.test/y0.mp4", "https://m.test/y1.mp4"]}}
   }'::jsonb);

INSERT INTO jobs (id, user_id, job_type, status, workflow_execution_id, input_data, output_data) VALUES
  -- E1 render row 0: pre-A1b preview (no quality on the output, proxy on the payload).
  ('f0000000-0000-4000-8000-0000000e7010', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "apply-edl", "node_id": "render", "iterationIndex": 0, "quality": "proxy"}',
   '{"videoUrl": "https://m.test/r0.mp4", "thumbnailUrl": "https://m.test/r0.jpg"}'),
  -- E1 render row 1: the worker's own stamps.
  ('f0000000-0000-4000-8000-0000000e7011', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "apply-edl", "node_id": "render", "iterationIndex": 1, "quality": "proxy"}',
   '{"videoUrl": "https://m.test/r1.mp4", "quality": "final", "clipKey": "2000-3000"}'),
  -- E1 render row 1 again: an earlier attempt in the same slot, another URL (S2).
  ('f0000000-0000-4000-8000-0000000e7012', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "apply-edl", "node_id": "render", "iterationIndex": 1}',
   '{"videoUrl": "https://m.test/r1-old.mp4"}'),
  -- E1 render row 2: failed.
  ('f0000000-0000-4000-8000-0000000e7013', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'failed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "apply-edl", "node_id": "render", "iterationIndex": 2}', NULL),
  -- E1 stamped: a job that would match, on a node already stamped (N2).
  ('f0000000-0000-4000-8000-0000000e7014', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "apply-edl", "node_id": "stamped", "iterationIndex": 0}', '{"videoUrl": "https://m.test/s0.mp4"}'),
  -- E1 script: a video fan-out — row 0 named; row 1's job wrote an empty
  -- imageUrl beside its videoUrl; row 2's job has another URL.
  ('f0000000-0000-4000-8000-0000000e7015', '00000000-0000-4000-8000-0000000e7001', 'generate-video', 'completed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "generate-video", "node_id": "script", "iterationIndex": 0}', '{"videoUrl": "https://m.test/t0.mp4"}'),
  ('f0000000-0000-4000-8000-0000000e7044', '00000000-0000-4000-8000-0000000e7001', 'generate-video', 'completed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "generate-video", "node_id": "script", "iterationIndex": 1}', '{"imageUrl": "", "videoUrl": "https://m.test/t1.mp4"}'),
  ('f0000000-0000-4000-8000-0000000e7040', '00000000-0000-4000-8000-0000000e7001', 'generate-video', 'completed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "generate-video", "node_id": "script", "iterationIndex": 2}', '{"videoUrl": "https://m.test/t2-other.mp4"}'),
  -- E1 images: an image fan-out with thumbnails; its payload has a quality (S4).
  ('f0000000-0000-4000-8000-0000000e7041', '00000000-0000-4000-8000-0000000e7001', 'generate-image', 'completed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "generate-image", "node_id": "images", "iterationIndex": 0, "quality": "high"}',
   '{"imageUrl": "https://m.test/i0.png", "thumbnailUrl": "https://m.test/i0-t.png", "quality": "high"}'),
  ('f0000000-0000-4000-8000-0000000e7042', '00000000-0000-4000-8000-0000000e7001', 'generate-image', 'completed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "generate-image", "node_id": "images", "iterationIndex": 1}',
   '{"imageUrl": "https://m.test/i1.png", "imageUrls": ["https://m.test/i1.png", "https://m.test/i1b.png"]}'),
  -- E1 store: Save to Storage, as production writes it (S5). The route
  -- inserts the row itself (no workflow_execution_id, no iterationIndex), the
  -- orchestrator then stamps only input_data.node_id, and the output is
  -- { url, filename, type }. Rows are listed out of slot order on purpose.
  ('f0000000-0000-4000-8000-0000000e7043', '00000000-0000-4000-8000-0000000e7001', 'save-to-storage', 'completed', NULL,
   '{"type": "save-to-storage", "mediaUrl": "https://up.test/b.png", "mediaType": "image", "node_id": "store"}',
   '{"url": "https://m.test/st1.png", "filename": null, "type": "image"}'),
  ('f0000000-0000-4000-8000-0000000e7046', '00000000-0000-4000-8000-0000000e7001', 'save-to-storage', 'completed', NULL,
   '{"type": "save-to-storage", "mediaUrl": "https://up.test/a.mp4", "mediaType": "video", "node_id": "store"}',
   '{"url": "https://m.test/st0.mp4", "filename": "a.mp4", "type": "video"}'),
  -- E1 store2 (S6): row 0 named; row 1's URL only ANOTHER user's job for a
  -- node with the same id made; row 2's URL two of this user's jobs made.
  ('f0000000-0000-4000-8000-0000000e7047', '00000000-0000-4000-8000-0000000e7001', 'save-to-storage', 'completed', NULL,
   '{"type": "save-to-storage", "mediaUrl": "https://up.test/a.mp4", "mediaType": "video", "node_id": "store2"}',
   '{"url": "https://m.test/sa.mp4", "filename": null, "type": "video"}'),
  ('f0000000-0000-4000-8000-0000000e7048', '00000000-0000-4000-8000-0000000e7002', 'save-to-storage', 'completed', NULL,
   '{"type": "save-to-storage", "mediaUrl": "https://up.test/b.mp4", "mediaType": "video", "node_id": "store2"}',
   '{"url": "https://m.test/sb.mp4", "filename": null, "type": "video"}'),
  ('f0000000-0000-4000-8000-0000000e7049', '00000000-0000-4000-8000-0000000e7001', 'save-to-storage', 'completed', NULL,
   '{"type": "save-to-storage", "mediaUrl": "https://up.test/c.mp4", "mediaType": "video", "node_id": "store2"}',
   '{"url": "https://m.test/sc.mp4", "filename": null, "type": "video"}'),
  ('f0000000-0000-4000-8000-0000000e704a', '00000000-0000-4000-8000-0000000e7001', 'save-to-storage', 'completed', NULL,
   '{"type": "save-to-storage", "mediaUrl": "https://up.test/c.mp4", "mediaType": "video", "node_id": "store2"}',
   '{"url": "https://m.test/sc.mp4", "filename": null, "type": "video"}'),
  -- E1 texts: an LLM fan-out whose text equals the row (N6) — text rows are never named.
  ('f0000000-0000-4000-8000-0000000e7045', '00000000-0000-4000-8000-0000000e7001', 'llm-chat', 'completed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "llm-chat", "node_id": "texts", "iterationIndex": 0}', '{"text": "a line"}'),
  -- E1 single: one row (N3).
  ('f0000000-0000-4000-8000-0000000e7016', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "apply-edl", "node_id": "single", "iterationIndex": 0}', '{"videoUrl": "https://m.test/one.mp4"}'),
  -- E1 dupe: two jobs claim row 0 (S3); row 1 is an audio render.
  ('f0000000-0000-4000-8000-0000000e7017', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "apply-edl", "node_id": "dupe", "iterationIndex": 0}', '{"videoUrl": "https://m.test/d0.mp4"}'),
  ('f0000000-0000-4000-8000-0000000e7018', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "apply-edl", "node_id": "dupe", "iterationIndex": 0}', '{"videoUrl": "https://m.test/d0.mp4"}'),
  ('f0000000-0000-4000-8000-0000000e7019', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7001',
   '{"type": "apply-edl", "node_id": "dupe", "iterationIndex": 1, "quality": "final"}', '{"audioUrl": "https://m.test/d1.mp4"}'),
  -- E2: a run still in flight (N1).
  ('f0000000-0000-4000-8000-0000000e7020', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7002',
   '{"type": "apply-edl", "node_id": "render", "iterationIndex": 0}', '{"videoUrl": "https://m.test/x0.mp4"}'),
  -- E3: its only job's URL is no row's (N5).
  ('f0000000-0000-4000-8000-0000000e7030', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7003',
   '{"type": "apply-edl", "node_id": "render", "iterationIndex": 0}', '{"videoUrl": "https://m.test/elsewhere.mp4"}'),
  -- E2 take: a single take in a run still in flight (N1).
  ('f0000000-0000-4000-8000-0000000e7060', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7002',
   '{"type": "apply-edl", "node_id": "take", "quality": "proxy"}', '{"videoUrl": "https://m.test/rt.mp4"}');

-- E4 (completed): Apply EDL runs that rendered ONE take (pass 3). The state
-- names its job (`jobId`); the take is the state's `videoUrl` / `audioUrl`.
--   proxy     ordered at proxy, before renders were labelled          (T1)
--   final     ordered with no quality on the payload: the final       (T2)
--   audio     an audio-only render ordered at proxy                   (T2)
--   onerow    a fan-out of ONE row (its primary is that row)          (T3)
--   said      the output already carries the worker's quality         (T4)
--   elsewhere the named job made another URL                          (T5)
--   othernode the named job ran for another node                      (T6)
--   otherrun  the named job belongs to another execution              (T7)
--   video     another node type whose payload carries a `quality`    (T8)
INSERT INTO workflow_executions (id, workflow_id, user_id, status, node_states) VALUES
  ('e0000000-0000-4000-8000-0000000e7004', 'd0000000-0000-4000-8000-0000000e7001', '00000000-0000-4000-8000-0000000e7001', 'completed', '{
     "proxy":     {"status": "completed", "jobId": "f0000000-0000-4000-8000-0000000e7050", "output": {"videoUrl": "https://m.test/p.mp4", "thumbnailUrl": "https://m.test/p.jpg", "json": {"words": []}}},
     "final":     {"status": "completed", "jobId": "f0000000-0000-4000-8000-0000000e7051", "output": {"videoUrl": "https://m.test/f.mp4"}},
     "audio":     {"status": "completed", "jobId": "f0000000-0000-4000-8000-0000000e7052", "output": {"audioUrl": "https://m.test/a.m4a"}},
     "onerow":    {"status": "completed", "jobId": "f0000000-0000-4000-8000-0000000e7053", "output": {"videoUrl": "https://m.test/o.mp4", "listResults": ["https://m.test/o.mp4"]}},
     "said":      {"status": "completed", "jobId": "f0000000-0000-4000-8000-0000000e7054", "output": {"videoUrl": "https://m.test/s.mp4", "quality": "final"}},
     "elsewhere": {"status": "completed", "jobId": "f0000000-0000-4000-8000-0000000e7055", "output": {"videoUrl": "https://m.test/e.mp4"}},
     "othernode": {"status": "completed", "jobId": "f0000000-0000-4000-8000-0000000e7056", "output": {"videoUrl": "https://m.test/n.mp4"}},
     "otherrun":  {"status": "completed", "jobId": "f0000000-0000-4000-8000-0000000e7057", "output": {"videoUrl": "https://m.test/r.mp4"}},
     "video":     {"status": "completed", "jobId": "f0000000-0000-4000-8000-0000000e7058", "output": {"videoUrl": "https://m.test/v.mp4"}}
   }'::jsonb);

INSERT INTO jobs (id, user_id, job_type, status, workflow_execution_id, input_data, output_data) VALUES
  ('f0000000-0000-4000-8000-0000000e7050', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7004',
   '{"type": "apply-edl", "node_id": "proxy", "quality": "proxy"}', '{"videoUrl": "https://m.test/p.mp4", "thumbnailUrl": "https://m.test/p.jpg"}'),
  ('f0000000-0000-4000-8000-0000000e7051', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7004',
   '{"type": "apply-edl", "node_id": "final"}', '{"videoUrl": "https://m.test/f.mp4"}'),
  ('f0000000-0000-4000-8000-0000000e7052', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7004',
   '{"type": "apply-edl", "node_id": "audio", "quality": "proxy"}', '{"audioUrl": "https://m.test/a.m4a"}'),
  ('f0000000-0000-4000-8000-0000000e7053', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7004',
   '{"type": "apply-edl", "node_id": "onerow", "iterationIndex": 0, "quality": "proxy"}', '{"videoUrl": "https://m.test/o.mp4"}'),
  ('f0000000-0000-4000-8000-0000000e7054', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7004',
   '{"type": "apply-edl", "node_id": "said", "quality": "proxy"}', '{"videoUrl": "https://m.test/s.mp4", "quality": "final"}'),
  ('f0000000-0000-4000-8000-0000000e7055', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7004',
   '{"type": "apply-edl", "node_id": "elsewhere", "quality": "proxy"}', '{"videoUrl": "https://m.test/e-other.mp4"}'),
  ('f0000000-0000-4000-8000-0000000e7056', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7004',
   '{"type": "apply-edl", "node_id": "not-othernode", "quality": "proxy"}', '{"videoUrl": "https://m.test/n.mp4"}'),
  ('f0000000-0000-4000-8000-0000000e7057', '00000000-0000-4000-8000-0000000e7001', 'apply-edl', 'completed', 'e0000000-0000-4000-8000-0000000e7003',
   '{"type": "apply-edl", "node_id": "otherrun", "quality": "proxy"}', '{"videoUrl": "https://m.test/r.mp4"}'),
  ('f0000000-0000-4000-8000-0000000e7058', '00000000-0000-4000-8000-0000000e7001', 'generate-video', 'completed', 'e0000000-0000-4000-8000-0000000e7004',
   '{"type": "generate-video", "node_id": "video", "quality": "proxy"}', '{"videoUrl": "https://m.test/v.mp4"}');

-- X: the SHARED stamp fixtures (fixtures/job-row-stamps.sql) — the same list
-- the server's load / save injection is tested on, so the migration's URL and
-- stamp rule and the TypeScript one cannot drift apart. One execution, one
-- two-row node per case: row 0 holds the case's URL, row 1 a URL no job made.
-- Pass 2 names row 0 by URL; a case whose job did not make that URL stays
-- unstamped.
\ir fixtures/job-row-stamps.sql
INSERT INTO jobs (id, user_id, job_type, status, input_data, output_data)
SELECT (c->>'id')::uuid, '00000000-0000-4000-8000-0000000e7001', c->>'job_type', 'completed',
  (c->'input_data') || jsonb_build_object('node_id', 'stampfx-' || (c->>'name')), c->'output_data'
FROM job_row_stamp_cases;
INSERT INTO workflow_executions (id, workflow_id, user_id, status, node_states)
SELECT 'e0000000-0000-4000-8000-0000000e7090', 'd0000000-0000-4000-8000-0000000e7001', '00000000-0000-4000-8000-0000000e7001', 'completed',
  jsonb_object_agg('stampfx-' || (c->>'name'), jsonb_build_object('status', 'completed', 'output', jsonb_build_object(
    'listResults', jsonb_build_array(c->>'listUrl', 'https://m.test/stampfx-none.mp4'))))
FROM job_row_stamp_cases;

CREATE TEMP TABLE before_states AS SELECT id, node_states FROM workflow_executions
  WHERE id::text LIKE 'e0000000-0000-4000-8000-0000000e70%';

\ir ../migrations/459_fan_out_row_stamps_backfill.sql

DO $$
DECLARE
  e1 jsonb := (SELECT node_states FROM workflow_executions WHERE id = 'e0000000-0000-4000-8000-0000000e7001');
  b1 jsonb := (SELECT node_states FROM before_states WHERE id = 'e0000000-0000-4000-8000-0000000e7001');
BEGIN
  -- S1: each row stamped from its own job; a failed row stays {}; quality by the
  -- worker's rule; no clipKey invented.
  PERFORM pg_temp.assert_eq('S1 render rows stamped from their own jobs',
    e1 -> 'render' -> 'output' -> 'listResultStamps',
    '[{"jobId": "f0000000-0000-4000-8000-0000000e7010", "thumbnailUrl": "https://m.test/r0.jpg", "quality": "proxy"},
      {"jobId": "f0000000-0000-4000-8000-0000000e7011", "quality": "final", "clipKey": "2000-3000"},
      {}]'::jsonb);
  PERFORM pg_temp.assert_eq('S1 the rest of the render output is kept',
    (e1 -> 'render' -> 'output') - 'listResultStamps', b1 -> 'render' -> 'output');
  -- S3: a row two jobs claim is not named; the audio row is.
  PERFORM pg_temp.assert_eq('S3 an ambiguous row stays {}',
    e1 -> 'dupe' -> 'output' -> 'listResultStamps',
    '[{}, {"jobId": "f0000000-0000-4000-8000-0000000e7019", "quality": "final"}]'::jsonb);
  PERFORM pg_temp.assert_eq('N2 an already stamped node is untouched', e1 -> 'stamped', b1 -> 'stamped');
  PERFORM pg_temp.assert_eq('N3 a one-row node is untouched', e1 -> 'single', b1 -> 'single');
  -- S4: every fanned-out type is stamped — job id and thumbnail, never a quality.
  PERFORM pg_temp.assert_eq('S4 a video fan-out is stamped (an empty imageUrl is absent); a row whose job made another URL stays {}',
    e1 -> 'script' -> 'output' -> 'listResultStamps',
    '[{"jobId": "f0000000-0000-4000-8000-0000000e7015"}, {"jobId": "f0000000-0000-4000-8000-0000000e7044"}, {}]'::jsonb);
  PERFORM pg_temp.assert_eq('S4 an image fan-out gets job ids and thumbnails, no quality',
    e1 -> 'images' -> 'output' -> 'listResultStamps',
    '[{"jobId": "f0000000-0000-4000-8000-0000000e7041", "thumbnailUrl": "https://m.test/i0-t.png"},
      {"jobId": "f0000000-0000-4000-8000-0000000e7042"}]'::jsonb);
  PERFORM pg_temp.assert_eq('S4 the rest of the image output is kept',
    (e1 -> 'images' -> 'output') - 'listResultStamps', b1 -> 'images' -> 'output');
  -- S5: a sync-HTTP fan-out (no execution id, no slot) named by its typed url.
  PERFORM pg_temp.assert_eq('S5 save-to-storage rows named by URL, not by position',
    e1 -> 'store' -> 'output' -> 'listResultStamps',
    '[{"jobId": "f0000000-0000-4000-8000-0000000e7046"}, {"jobId": "f0000000-0000-4000-8000-0000000e7043"}]'::jsonb);
  PERFORM pg_temp.assert_eq('S5 the rest of the save-to-storage output is kept',
    (e1 -> 'store' -> 'output') - 'listResultStamps', b1 -> 'store' -> 'output');
  -- S6: only the execution's user's jobs count, and only a URL exactly one made.
  PERFORM pg_temp.assert_eq('S6 another user''s job and an ambiguous URL leave their rows {}',
    e1 -> 'store2' -> 'output' -> 'listResultStamps',
    '[{"jobId": "f0000000-0000-4000-8000-0000000e7047"}, {}, {}]'::jsonb);
  PERFORM pg_temp.assert_eq('N6 a text fan-out is untouched', e1 -> 'texts', b1 -> 'texts');
  PERFORM pg_temp.assert_eq('N1 a running execution is untouched',
    (SELECT node_states FROM workflow_executions WHERE id = 'e0000000-0000-4000-8000-0000000e7002'),
    (SELECT node_states FROM before_states WHERE id = 'e0000000-0000-4000-8000-0000000e7002'));
  PERFORM pg_temp.assert_eq('N5 a run with no matching job is untouched',
    (SELECT node_states FROM workflow_executions WHERE id = 'e0000000-0000-4000-8000-0000000e7003'),
    (SELECT node_states FROM before_states WHERE id = 'e0000000-0000-4000-8000-0000000e7003'));
END $$;

DO $$
DECLARE
  e4 jsonb := (SELECT node_states FROM workflow_executions WHERE id = 'e0000000-0000-4000-8000-0000000e7004');
  b4 jsonb := (SELECT node_states FROM before_states WHERE id = 'e0000000-0000-4000-8000-0000000e7004');
BEGIN
  -- T1-T3: a single take takes the quality it was ordered at, and nothing
  -- else changes (no row stamps, no invented clipKey, the rest kept).
  PERFORM pg_temp.assert_eq('T1 a single proxy take is labelled a Preview, the rest of its state kept',
    e4 -> 'proxy', jsonb_set(b4 -> 'proxy', '{output,quality}', '"proxy"'));
  PERFORM pg_temp.assert_eq('T2 a take ordered with no quality is the final',
    e4 -> 'final', jsonb_set(b4 -> 'final', '{output,quality}', '"final"'));
  PERFORM pg_temp.assert_eq('T2 an audio-only take ordered at proxy is a Preview',
    e4 -> 'audio', jsonb_set(b4 -> 'audio', '{output,quality}', '"proxy"'));
  PERFORM pg_temp.assert_eq('T3 a one-row fan-out labels its take, no row stamps added',
    e4 -> 'onerow', jsonb_set(b4 -> 'onerow', '{output,quality}', '"proxy"'));
  PERFORM pg_temp.assert_eq('T4 a take that already says its quality is untouched', e4 -> 'said', b4 -> 'said');
  PERFORM pg_temp.assert_eq('T5 a job that made another URL names nothing', e4 -> 'elsewhere', b4 -> 'elsewhere');
  PERFORM pg_temp.assert_eq('T6 a job of another node names nothing', e4 -> 'othernode', b4 -> 'othernode');
  PERFORM pg_temp.assert_eq('T7 a job of another run names nothing', e4 -> 'otherrun', b4 -> 'otherrun');
  PERFORM pg_temp.assert_eq('T8 another node type never gets a render quality', e4 -> 'video', b4 -> 'video');
  -- A fan-out the first two passes own keeps no top-level quality, even
  -- when its state names the job of row 0 (asserted in S1: only its stamps
  -- were added); a run still in flight is untouched (asserted in N1).
END $$;

DO $$
DECLARE
  fx jsonb := (SELECT node_states FROM workflow_executions WHERE id = 'e0000000-0000-4000-8000-0000000e7090');
  k record;
  n int := 0;
BEGIN
  FOR k IN SELECT c FROM job_row_stamp_cases ORDER BY c->>'name' LOOP
    PERFORM pg_temp.assert_eq('X shared fixture ' || (k.c->>'name'),
      fx -> ('stampfx-' || (k.c->>'name')) -> 'output' -> 'listResultStamps',
      CASE WHEN jsonb_typeof(k.c->'stamp') = 'object'
        THEN jsonb_build_array((k.c->'stamp') || jsonb_build_object('jobId', k.c->>'id'), '{}'::jsonb) END);
    n := n + 1;
  END LOOP;
  IF n < 10 THEN
    RAISE EXCEPTION 'ASSERT FAIL [X]: only % shared fixture cases ran', n;
  END IF;
  RAISE NOTICE 'ok  X % shared fixture cases', n;
END $$;

CREATE TEMP TABLE after_first AS SELECT id, node_states FROM workflow_executions
  WHERE id::text LIKE 'e0000000-0000-4000-8000-0000000e70%';

\ir ../migrations/459_fan_out_row_stamps_backfill.sql

DO $$
BEGIN
  PERFORM pg_temp.assert_eq('I1 a second run changes nothing',
    (SELECT jsonb_object_agg(id::text, node_states) FROM workflow_executions WHERE id::text LIKE 'e0000000-0000-4000-8000-0000000e70%'),
    (SELECT jsonb_object_agg(id::text, node_states) FROM after_first));
  RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED';
END $$;

ROLLBACK;
