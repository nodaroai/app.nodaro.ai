-- ============================================================================
-- Behavioral proof: the restore of the MCP conversation markers (migration 613)
-- rebuilds exactly the records an editor save erased, and nothing else.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000002949 and ...-000000002950).
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/mcp-conversation-markers-restore.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/t.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_true(label text, value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT FAIL: %', label; END IF;
 RAISE NOTICE 'ok  %', label;
END $$;
CREATE FUNCTION pg_temp.conv(p_id uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT settings->'mcpConversation' FROM public.workflows WHERE id = p_id
$$;
CREATE FUNCTION pg_temp.hub(p_id uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT settings->'mcpHub' FROM public.workflows WHERE id = p_id
$$;
CREATE FUNCTION pg_temp.version_of(p_id uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT version FROM public.workflows WHERE id = p_id
$$;

INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role) VALUES
 ('00000000-0000-4000-8000-000000002949','restore-markers@test.invalid','{}','authenticated','authenticated'),
 ('00000000-0000-4000-8000-000000002950','restore-markers-other@test.invalid','{}','authenticated','authenticated');
INSERT INTO public.projects(id,user_id,name) VALUES
 ('c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949','mcp'),
 ('c0000000-0000-4000-8000-000000002950','00000000-0000-4000-8000-000000002950','mcp');

-- The month's hub, intact.
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges,settings) VALUES
 ('a0000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'MCP Conversations · 2026-11','[]','[]','{"mcpHub":{"month":"2026-11"}}');

-- 1. A conversation flow saved from the editor: the record is gone, the editor's
--    keys are there, and its nodes still carry the assistant's provenance — stored
--    out of time order, the later step first, and one node with none.
INSERT INTO public.workflows(id,project_id,user_id,parent_workflow_id,name,nodes,edges,settings) VALUES
 ('b1000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'a0000000-0000-4000-8000-000000002949','a knight on a hill',
  '[{"id":"n2","data":{"mcpProvenance":{"client":"claude-code","clientName":"Claude Code (nodaro)","at":"2026-11-09T18:58:00.000Z","jobId":"j2","outputKey":"videoUrl"}}},
    {"id":"up","data":{"label":"Upload"}},
    {"id":"n1","data":{"mcpProvenance":{"client":"claude-code","clientName":"Claude Code (nodaro)","at":"2026-11-09T18:56:00.000Z","jobId":"j1","outputKey":"imageUrl","userRequest":"a knight on a hill"}}}]',
  '[]',
  '{"characterDefinitions":[],"flowPromptTemplates":{},"presentationSettings":{"runTarget":"workflow"},"viewport":{"x":1,"y":2,"zoom":1}}');

-- 2. A conversation flow never opened in the editor: its record is intact and must not move.
INSERT INTO public.workflows(id,project_id,user_id,parent_workflow_id,name,nodes,edges,settings) VALUES
 ('b2000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'a0000000-0000-4000-8000-000000002949','intact',
  '[{"id":"n1","data":{"mcpProvenance":{"client":"chatgpt","clientName":"ChatGPT","at":"2026-11-09T10:00:00.000Z","jobId":"j3"}}}]',
  '[]',
  '{"mcpConversation":{"client":"chatgpt","clientName":"ChatGPT","key":"k1","startedAt":"2026-11-09T10:00:00.000Z","lastActivityAt":"2026-11-09T10:00:00.000Z","steps":1}}');

-- 3. A copy made with "copy to project": provenance on its nodes, no hub parent — a plain flow, left alone.
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges,settings) VALUES
 ('b3000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'a knight on a hill (Copy)',
  '[{"id":"n1","data":{"mcpProvenance":{"client":"claude-code","clientName":"Claude Code (nodaro)","at":"2026-11-09T18:56:00.000Z","jobId":"j1"}}}]',
  '[]','{"viewport":null}');

-- 4. A child of a plain workflow (a sub-workflow), with provenance on a node: its parent is no hub, left alone.
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges,settings) VALUES
 ('b4000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'Parent','[]','[]','{}');
INSERT INTO public.workflows(id,project_id,user_id,parent_workflow_id,name,nodes,edges,settings) VALUES
 ('b5000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'b4000000-0000-4000-8000-000000002949','Sub',
  '[{"id":"n1","data":{"mcpProvenance":{"client":"claude-code","clientName":"Claude Code (nodaro)","at":"2026-11-09T18:56:00.000Z","jobId":"j9"}}}]',
  '[]','{}');

-- 5. A conversation flow under the hub whose nodes carry no provenance at all (the assistant's step
--    never landed): nothing to rebuild from, left alone.
INSERT INTO public.workflows(id,project_id,user_id,parent_workflow_id,name,nodes,edges,settings) VALUES
 ('b6000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'a0000000-0000-4000-8000-000000002949','empty','[{"id":"x","data":{}}]','[]','{"viewport":null}');

-- 6. A hub that lost its month marker, with two conversations under it: one whose record is intact,
--    and one — a later part, named so — whose record is gone too. Both the hub and that part are
--    rebuilt in ONE run (a migration runs once on an install): the hub first, then what hangs under it.
--    Beside them, a row that only looks like a hub (the name, no children), left alone.
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges,settings) VALUES
 ('a1000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'MCP Conversations · 2026-10','[]','[]','{"viewport":{"x":0,"y":0,"zoom":1}}');
INSERT INTO public.workflows(id,project_id,user_id,parent_workflow_id,name,nodes,edges,settings) VALUES
 ('b7000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'a1000000-0000-4000-8000-000000002949','october',
  '[{"id":"n1","data":{"mcpProvenance":{"client":"claude","clientName":"Claude","at":"2026-10-20T09:00:00.000Z","jobId":"j4"}}}]',
  '[]','{"mcpConversation":{"client":"claude","clientName":"Claude","key":null,"startedAt":"2026-10-20T09:00:00.000Z","lastActivityAt":"2026-10-20T09:00:00.000Z","steps":1}}');
INSERT INTO public.workflows(id,project_id,user_id,parent_workflow_id,name,nodes,edges,settings) VALUES
 ('b8000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'a1000000-0000-4000-8000-000000002949','october · Part 2',
  '[{"id":"n1","data":{"mcpProvenance":{"client":"claude","clientName":"Claude","at":"2026-10-21T09:00:00.000Z","jobId":"j5"}}}]',
  '[]','{"viewport":null}');
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges,settings) VALUES
 ('a2000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'MCP Conversations · 2026-09','[]','[]','{}');

-- 7. Rows the compatible-writer guard protects (migration 398): a plain write to one is refused
--    with production_capability_required, so a repair that touched one would fail the whole file.
--    A Studio production renamed like a hub, with a child under it; and a conversation under the
--    intact hub whose node is bound to a Studio frame. Both must be skipped, untouched.
--    (Inserted the way the Studio codec writes: as service_role, the compatible-writer flag on.
--    `postgres` is no superuser here, as in production, so the repair itself runs as a plain writer.)
SET LOCAL ROLE service_role;
SELECT set_config('nodaro.compatible_workflow_write','on',true);
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges,settings) VALUES
 ('d1000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'MCP Conversations · 2026-08','[{"id":"k","data":{"keyframeId":"k"}}]','[]','{"studio":{"keyframes":[]}}');
INSERT INTO public.workflows(id,project_id,user_id,parent_workflow_id,name,nodes,edges,settings) VALUES
 ('d2000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'a0000000-0000-4000-8000-000000002949','bound to a frame',
  '[{"id":"n1","data":{"keyframeId":"k","mcpProvenance":{"client":"claude-code","clientName":"Claude Code (nodaro)","at":"2026-11-09T19:00:00.000Z","jobId":"j6"}}}]',
  '[]','{"viewport":null}');
SELECT set_config('nodaro.compatible_workflow_write','',true);
RESET ROLE;
INSERT INTO public.workflows(id,project_id,user_id,parent_workflow_id,name,nodes,edges,settings) VALUES
 ('b9000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'd1000000-0000-4000-8000-000000002949','under the production','[]','[]','{}');

-- 8. A hub and its conversations are one user's, in one project. Another user's row that points
--    its parent at this user's hub-looking row does not make it a hub; another user's row under
--    this user's hub gets no record.
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges,settings) VALUES
 ('a3000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'MCP Conversations · 2026-07','[]','[]','{}');
INSERT INTO public.workflows(id,project_id,user_id,parent_workflow_id,name,nodes,edges,settings) VALUES
 ('b1000000-0000-4000-8000-000000002950','c0000000-0000-4000-8000-000000002950','00000000-0000-4000-8000-000000002950',
  'a3000000-0000-4000-8000-000000002949','a stranger''s child','[]','[]','{}');
INSERT INTO public.workflows(id,project_id,user_id,parent_workflow_id,name,nodes,edges,settings) VALUES
 ('b2000000-0000-4000-8000-000000002950','c0000000-0000-4000-8000-000000002950','00000000-0000-4000-8000-000000002950',
  'a0000000-0000-4000-8000-000000002949','a stranger under the hub',
  '[{"id":"n1","data":{"mcpProvenance":{"client":"claude-code","clientName":"Claude Code (nodaro)","at":"2026-11-09T19:00:00.000Z","jobId":"j7"}}}]',
  '[]','{}');

-- 9. A hub-looking name whose month is no month, with a child: left alone.
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges,settings) VALUES
 ('a4000000-0000-4000-8000-000000002949','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'MCP Conversations · 2026-13','[]','[]','{}');
INSERT INTO public.workflows(id,project_id,user_id,parent_workflow_id,name,nodes,edges,settings) VALUES
 ('b3000000-0000-4000-8000-000000002950','c0000000-0000-4000-8000-000000002949','00000000-0000-4000-8000-000000002949',
  'a4000000-0000-4000-8000-000000002949','thirteenth month','[]','[]','{}');

-- The migration runs as a plain writer: the compatible-writer flag must be OFF here, or a repair
-- that touched a guarded row would pass under this superuser and only fail in production.
SELECT pg_temp.assert_true('the compatible-writer flag is off before the repair runs',
  current_setting('nodaro.compatible_workflow_write', true) IS DISTINCT FROM 'on');

-- Apply the REAL migration file (not a copy — a copy would drift from it).
\ir ../migrations/613_restore_mcp_conversation_markers.sql

SELECT pg_temp.assert_true('the erased record is rebuilt: client and its name from the first step',
  pg_temp.conv('b1000000-0000-4000-8000-000000002949')->>'client' = 'claude-code'
  AND pg_temp.conv('b1000000-0000-4000-8000-000000002949')->>'clientName' = 'Claude Code (nodaro)');
SELECT pg_temp.assert_true('startedAt is the earliest step and lastActivityAt the latest, whatever order the nodes are stored in',
  pg_temp.conv('b1000000-0000-4000-8000-000000002949')->>'startedAt' = '2026-11-09T18:56:00.000Z'
  AND pg_temp.conv('b1000000-0000-4000-8000-000000002949')->>'lastActivityAt' = '2026-11-09T18:58:00.000Z');
SELECT pg_temp.assert_true('steps counts the nodes with provenance only',
  (pg_temp.conv('b1000000-0000-4000-8000-000000002949')->>'steps')::int = 2);
SELECT pg_temp.assert_true('firstRequest is the first step''s request; the key is null; the row is marked restored; no part',
  pg_temp.conv('b1000000-0000-4000-8000-000000002949')->>'firstRequest' = 'a knight on a hill'
  AND pg_temp.conv('b1000000-0000-4000-8000-000000002949') ? 'key'
  AND jsonb_typeof(pg_temp.conv('b1000000-0000-4000-8000-000000002949')->'key') = 'null'
  AND pg_temp.conv('b1000000-0000-4000-8000-000000002949')->'restored' = 'true'::jsonb
  AND NOT (pg_temp.conv('b1000000-0000-4000-8000-000000002949') ? 'part'));
SELECT pg_temp.assert_true('the editor''s keys stay exactly as stored beside the rebuilt record',
  (SELECT settings->'viewport' = '{"x":1,"y":2,"zoom":1}'::jsonb AND settings->'presentationSettings' = '{"runTarget":"workflow"}'::jsonb
     FROM public.workflows WHERE id = 'b1000000-0000-4000-8000-000000002949'));
SELECT pg_temp.assert_true('the rebuilt row''s version moved, so an open editor sees it',
  pg_temp.version_of('b1000000-0000-4000-8000-000000002949') = 2);
SELECT pg_temp.assert_true('an intact record is not touched (same record, same version)',
  pg_temp.conv('b2000000-0000-4000-8000-000000002949')->>'key' = 'k1'
  AND NOT (pg_temp.conv('b2000000-0000-4000-8000-000000002949') ? 'restored')
  AND pg_temp.version_of('b2000000-0000-4000-8000-000000002949') = 1);
SELECT pg_temp.assert_true('a copy with no hub parent gets no record',
  pg_temp.conv('b3000000-0000-4000-8000-000000002949') IS NULL
  AND pg_temp.version_of('b3000000-0000-4000-8000-000000002949') = 1);
SELECT pg_temp.assert_true('a child of a plain workflow gets no record',
  pg_temp.conv('b5000000-0000-4000-8000-000000002949') IS NULL
  AND pg_temp.version_of('b5000000-0000-4000-8000-000000002949') = 1);
SELECT pg_temp.assert_true('a conversation flow with no provenance to rebuild from is left alone',
  pg_temp.conv('b6000000-0000-4000-8000-000000002949') IS NULL
  AND pg_temp.version_of('b6000000-0000-4000-8000-000000002949') = 1);
SELECT pg_temp.assert_true('a hub that lost its marker gets its month back from its name',
  pg_temp.hub('a1000000-0000-4000-8000-000000002949') = '{"month":"2026-10"}'::jsonb
  AND (SELECT settings ? 'viewport' FROM public.workflows WHERE id = 'a1000000-0000-4000-8000-000000002949'));
SELECT pg_temp.assert_true('a conversation under that hub is rebuilt in the same run, its part number from its name',
  pg_temp.conv('b8000000-0000-4000-8000-000000002949')->>'client' = 'claude'
  AND (pg_temp.conv('b8000000-0000-4000-8000-000000002949')->>'steps')::int = 1
  AND (pg_temp.conv('b8000000-0000-4000-8000-000000002949')->>'part')::int = 2
  AND pg_temp.version_of('b8000000-0000-4000-8000-000000002949') = 2);
SELECT pg_temp.assert_true('the intact record under that hub is not touched',
  pg_temp.conv('b7000000-0000-4000-8000-000000002949')->>'startedAt' = '2026-10-20T09:00:00.000Z'
  AND pg_temp.version_of('b7000000-0000-4000-8000-000000002949') = 1);
SELECT pg_temp.assert_true('a row that only looks like a hub (no conversations under it) is left alone',
  pg_temp.hub('a2000000-0000-4000-8000-000000002949') IS NULL
  AND pg_temp.version_of('a2000000-0000-4000-8000-000000002949') = 1);
SELECT pg_temp.assert_true('the intact hub is not touched',
  pg_temp.version_of('a0000000-0000-4000-8000-000000002949') = 1);
SELECT pg_temp.assert_true('a Studio production named like a hub is skipped: no marker, same version',
  pg_temp.hub('d1000000-0000-4000-8000-000000002949') IS NULL
  AND pg_temp.version_of('d1000000-0000-4000-8000-000000002949') = 1);
SELECT pg_temp.assert_true('a conversation bound to a Studio frame is skipped: no record, same version',
  pg_temp.conv('d2000000-0000-4000-8000-000000002949') IS NULL
  AND pg_temp.version_of('d2000000-0000-4000-8000-000000002949') = 1);
SELECT pg_temp.assert_true('another user''s child does not make a hub of this user''s row',
  pg_temp.hub('a3000000-0000-4000-8000-000000002949') IS NULL
  AND pg_temp.version_of('a3000000-0000-4000-8000-000000002949') = 1);
SELECT pg_temp.assert_true('another user''s row under this user''s hub gets no record',
  pg_temp.conv('b2000000-0000-4000-8000-000000002950') IS NULL
  AND pg_temp.version_of('b2000000-0000-4000-8000-000000002950') = 1);
SELECT pg_temp.assert_true('a hub-looking name whose month is no month is left alone',
  pg_temp.hub('a4000000-0000-4000-8000-000000002949') IS NULL
  AND pg_temp.version_of('a4000000-0000-4000-8000-000000002949') = 1);

-- Re-applying the migration changes nothing (CI re-applies the newest one).
\ir ../migrations/613_restore_mcp_conversation_markers.sql
SELECT pg_temp.assert_true('a second run is a no-op',
  pg_temp.version_of('b1000000-0000-4000-8000-000000002949') = 2
  AND pg_temp.version_of('a1000000-0000-4000-8000-000000002949') = 2
  AND pg_temp.version_of('b8000000-0000-4000-8000-000000002949') = 2
  AND (pg_temp.conv('b1000000-0000-4000-8000-000000002949')->>'steps')::int = 2
  AND pg_temp.version_of('d1000000-0000-4000-8000-000000002949') = 1
  AND pg_temp.version_of('d2000000-0000-4000-8000-000000002949') = 1
  AND pg_temp.version_of('a3000000-0000-4000-8000-000000002949') = 1
  AND pg_temp.version_of('b2000000-0000-4000-8000-000000002950') = 1);

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
