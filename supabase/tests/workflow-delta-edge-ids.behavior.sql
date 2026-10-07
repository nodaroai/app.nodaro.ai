\set ON_ERROR_STOP on
BEGIN;
-- apply_workflow_delta keeps stored edges and nodes that have no id, skips an
-- id-less re-send of a stored connection, and a one-time backfill gives every
-- stored id-less edge the normalizer's id (#1877).
-- Studio-owned documents need the compatible writer; the setup below mirrors
-- compatible-workflow-writes.behavior.sql so the superuser harness exercises
-- managed-host permissions. Everything rolls back.
GRANT CREATE ON SCHEMA public TO service_role;
ALTER FUNCTION public.create_compatible_workflow(jsonb) OWNER TO service_role;
CREATE FUNCTION pg_temp.assert_true(label text, value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT FAIL: %', label; END IF;
 RAISE NOTICE 'ok  %', label;
END $$;
-- The stored edge ids in order, '<none>' for an element with no id.
CREATE FUNCTION pg_temp.edge_ids(p_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(coalesce(e->>'id', '<none>'), ',' ORDER BY ord)
    FROM public.workflows w, jsonb_array_elements(w.edges) WITH ORDINALITY AS t(e, ord)
   WHERE w.id = p_id
$$;
CREATE FUNCTION pg_temp.version_of(p_id uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT version FROM public.workflows WHERE id = p_id
$$;

INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role) VALUES
 ('00000000-0000-4000-8000-000000001877','delta-edge-ids@test.invalid','{}','authenticated','authenticated');
INSERT INTO public.projects(id,user_id,name) VALUES
 ('c0000000-0000-4000-8000-000000001877','00000000-0000-4000-8000-000000001877','Delta edge ids');

-- ---------------------------------------------------------------------------
-- 1. The backfill.
-- ---------------------------------------------------------------------------
-- A graph written before every edge carried an id: an id-less edge with
-- handles, an edge already holding the id the next one would take, two
-- id-less copies of that connection (one with an empty id), an empty-string
-- handle, a non-string handle, and an ordinary edge.
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges,updated_at) VALUES
 ('d0000000-0000-4000-8000-000000001877','c0000000-0000-4000-8000-000000001877','00000000-0000-4000-8000-000000001877','Old graph',
  '[{"id":"A","data":{}},{"id":"B","data":{}},{"id":"C","data":{}}]',
  '[{"id":"e1","source":"A","target":"B"},
    {"source":"B","target":"C","sourceHandle":"text","targetHandle":"prompt"},
    {"id":"e-A-out-C-in","source":"X","target":"Y"},
    {"source":"A","target":"C"},
    {"source":"A","target":"C","id":""},
    {"source":"A","target":"B","sourceHandle":"","targetHandle":"in"},
    {"source":"B","target":"A","sourceHandle":5,"targetHandle":{"x":1}}]',
  '2026-01-01T00:00:00Z');
-- Its only id-less element has an EMPTY id.
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges) VALUES
 ('d2000000-0000-4000-8000-000000001877','c0000000-0000-4000-8000-000000001877','00000000-0000-4000-8000-000000001877','Empty id',
  '[{"id":"A","data":{}},{"id":"B","data":{}}]', '[{"id":"","source":"A","target":"B"}]');
-- Elements that are not edges at all: left alone.
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges) VALUES
 ('d3000000-0000-4000-8000-000000001877','c0000000-0000-4000-8000-000000001877','00000000-0000-4000-8000-000000001877','Not edges',
  '[]', '[1, "x", null]');
-- Edges stored as something other than an array: no crash, left alone.
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges) VALUES
 ('d4000000-0000-4000-8000-000000001877','c0000000-0000-4000-8000-000000001877','00000000-0000-4000-8000-000000001877','Not an array',
  '[]', '{"source":"A","target":"B"}');
-- Three hundred id-less copies of one connection: each resumes the suffix
-- where the last one stopped (the backfill stays linear).
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges) VALUES
 ('d5000000-0000-4000-8000-000000001877','c0000000-0000-4000-8000-000000001877','00000000-0000-4000-8000-000000001877','Many copies',
  '[{"id":"A","data":{}},{"id":"B","data":{}}]',
  (SELECT jsonb_agg(jsonb_build_object('source','A','target','B')) FROM generate_series(1, 300)));

-- A Studio-owned document with an id-less edge: the guard trigger refuses any
-- generic write to it, so the backfill must leave it alone (or the migration
-- itself would fail on PT409).
SET LOCAL ROLE service_role;
SELECT id AS studio_id FROM public.create_compatible_workflow('{
 "project_id":"c0000000-0000-4000-8000-000000001877", "user_id":"00000000-0000-4000-8000-000000001877",
 "name":"Studio", "nodes":[{"id":"K","data":{"keyframeId":"K"}},{"id":"L","data":{}}],
 "edges":[{"source":"K","target":"L"}],
 "settings":{"studio":{"requiredCapabilities":["studio-dependent-frames-v1"],"keyframes":[]}}, "app_slug":"studio"
}') \gset
RESET ROLE;

-- Apply the REAL migration file (not a copy — a copy would drift from it).
\ir ../migrations/479_apply_workflow_delta_null_ids.sql

SELECT pg_temp.assert_true('an id-less edge gets the normalizer id from its handles',
  split_part(pg_temp.edge_ids('d0000000-0000-4000-8000-000000001877'), ',', 2) = 'e-B-text-C-prompt');
SELECT pg_temp.assert_true('an id-less edge whose id is taken gets the next free suffix',
  split_part(pg_temp.edge_ids('d0000000-0000-4000-8000-000000001877'), ',', 4) = 'e-A-out-C-in-2');
SELECT pg_temp.assert_true('an empty id counts as no id, and an id-less twin keeps its place under the next suffix',
  split_part(pg_temp.edge_ids('d0000000-0000-4000-8000-000000001877'), ',', 5) = 'e-A-out-C-in-3');
SELECT pg_temp.assert_true('an empty-string handle counts as no handle (out)',
  split_part(pg_temp.edge_ids('d0000000-0000-4000-8000-000000001877'), ',', 6) = 'e-A-out-B-in');
SELECT pg_temp.assert_true('a handle that is not a string counts as no handle (out / in)',
  split_part(pg_temp.edge_ids('d0000000-0000-4000-8000-000000001877'), ',', 7) = 'e-B-out-A-in');
SELECT pg_temp.assert_true('edges that had an id keep it, in order, and nothing is dropped',
  pg_temp.edge_ids('d0000000-0000-4000-8000-000000001877') = 'e1,e-B-text-C-prompt,e-A-out-C-in,e-A-out-C-in-2,e-A-out-C-in-3,e-A-out-B-in,e-B-out-A-in');
SELECT pg_temp.assert_true('a handle value is stored as it was (only the id is added)',
  (SELECT edges->6->'sourceHandle' = '5'::jsonb AND edges->5->>'sourceHandle' = ''
     FROM public.workflows WHERE id = 'd0000000-0000-4000-8000-000000001877'));
SELECT pg_temp.assert_true('the backfill does not move updated_at (dashboards keep their order)',
  (SELECT updated_at = '2026-01-01T00:00:00Z'::timestamptz FROM public.workflows WHERE id = 'd0000000-0000-4000-8000-000000001877'));
SELECT pg_temp.assert_true('the backfill bumps version, so an open editor sees the change',
  pg_temp.version_of('d0000000-0000-4000-8000-000000001877') = 2);
SELECT pg_temp.assert_true('a row whose only id-less edge has an empty id is fixed',
  pg_temp.edge_ids('d2000000-0000-4000-8000-000000001877') = 'e-A-out-B-in');
SELECT pg_temp.assert_true('elements that are not edges are left alone (no write, no version bump)',
  pg_temp.version_of('d3000000-0000-4000-8000-000000001877') = 1
  AND (SELECT edges = '[1, "x", null]'::jsonb FROM public.workflows WHERE id = 'd3000000-0000-4000-8000-000000001877'));
SELECT pg_temp.assert_true('edges stored as a non-array are left alone, and do not stop the backfill',
  pg_temp.version_of('d4000000-0000-4000-8000-000000001877') = 1);
SELECT pg_temp.assert_true('three hundred copies of one connection get e-A-out-B-in, then -2 … -300, in order',
  (SELECT count(DISTINCT e->>'id') = 300
          AND bool_and(e->>'id' = CASE WHEN ord = 1 THEN 'e-A-out-B-in' ELSE 'e-A-out-B-in-' || ord END)
     FROM public.workflows w, jsonb_array_elements(w.edges) WITH ORDINALITY AS t(e, ord)
    WHERE w.id = 'd5000000-0000-4000-8000-000000001877'));
SELECT pg_temp.assert_true('a Studio-owned document is left alone',
  pg_temp.edge_ids(:'studio_id') = '<none>');
SELECT pg_temp.assert_true('set_updated_at is enabled again after the backfill',
  (SELECT tgenabled <> 'D' FROM pg_trigger WHERE tgname = 'set_updated_at' AND tgrelid = 'public.workflows'::regclass));

-- Re-applying the migration changes nothing (CI re-applies the newest one).
\ir ../migrations/479_apply_workflow_delta_null_ids.sql
SELECT pg_temp.assert_true('a second run is a no-op',
  pg_temp.edge_ids('d0000000-0000-4000-8000-000000001877') = 'e1,e-B-text-C-prompt,e-A-out-C-in,e-A-out-C-in-2,e-A-out-C-in-3,e-A-out-B-in,e-B-out-A-in'
  AND pg_temp.version_of('d0000000-0000-4000-8000-000000001877') = 2
  AND pg_temp.version_of('d5000000-0000-4000-8000-000000001877') = 2);

-- ---------------------------------------------------------------------------
-- 2. The delta: a row that still carries an id-less edge (written after the
--    backfill by a lane that does not normalize) keeps it through a delete.
--    Each delta runs in its own statement and its result is read in the
--    next: a read in the SAME statement would see that statement's snapshot,
--    from before the function's update.
-- ---------------------------------------------------------------------------
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,edges) VALUES
 ('d1000000-0000-4000-8000-000000001877','c0000000-0000-4000-8000-000000001877','00000000-0000-4000-8000-000000001877','Delta',
  '[{"id":"A","data":{}},{"id":"B","data":{}},{"id":"C","data":{}}]',
  '[{"id":"e1","source":"A","target":"B"},{"source":"B","target":"C"},{"id":"e2","source":"A","target":"C"}]');

SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true('deleting one edge succeeds',
  (SELECT ok FROM public.apply_workflow_delta(p_workflow_id => 'd1000000-0000-4000-8000-000000001877', p_base_version => pg_temp.version_of('d1000000-0000-4000-8000-000000001877'),
     p_delete_edge_ids => ARRAY['e1'], p_user_id => '00000000-0000-4000-8000-000000001877')));
SELECT pg_temp.assert_true('the id-less edge survives a delete of another edge (it used to vanish)',
  pg_temp.edge_ids('d1000000-0000-4000-8000-000000001877') = '<none>,e2');
SELECT pg_temp.assert_true('an id-less re-send of a stored connection is accepted',
  (SELECT ok FROM public.apply_workflow_delta(p_workflow_id => 'd1000000-0000-4000-8000-000000001877', p_base_version => pg_temp.version_of('d1000000-0000-4000-8000-000000001877'),
     p_upsert_edges => '[{"source":"B","target":"C"},{"source":"C","target":"A"}]'::jsonb,
     p_user_id => '00000000-0000-4000-8000-000000001877')));
SELECT pg_temp.assert_true('… and is not appended again, while an id-less NEW connection is',
  pg_temp.edge_ids('d1000000-0000-4000-8000-000000001877') = '<none>,e2,<none>'
  AND (SELECT edges->2->>'source' = 'C' FROM public.workflows WHERE id = 'd1000000-0000-4000-8000-000000001877'));
SELECT pg_temp.assert_true('a delete list holding a NULL is accepted',
  (SELECT ok FROM public.apply_workflow_delta(p_workflow_id => 'd1000000-0000-4000-8000-000000001877', p_base_version => pg_temp.version_of('d1000000-0000-4000-8000-000000001877'),
     p_delete_edge_ids => ARRAY['e2', NULL], p_user_id => '00000000-0000-4000-8000-000000001877')));
SELECT pg_temp.assert_true('a NULL inside the delete list removes only the named edge (it used to remove every edge)',
  pg_temp.edge_ids('d1000000-0000-4000-8000-000000001877') = '<none>,<none>');
SELECT pg_temp.assert_true('a NULL delete list is accepted',
  (SELECT ok FROM public.apply_workflow_delta(p_workflow_id => 'd1000000-0000-4000-8000-000000001877', p_base_version => pg_temp.version_of('d1000000-0000-4000-8000-000000001877'),
     p_delete_edge_ids => NULL, p_user_id => '00000000-0000-4000-8000-000000001877')));
SELECT pg_temp.assert_true('a NULL delete list deletes nothing (it used to delete every edge)',
  pg_temp.edge_ids('d1000000-0000-4000-8000-000000001877') = '<none>,<none>');
SELECT pg_temp.assert_true('a node delete list holding a NULL is accepted',
  (SELECT ok FROM public.apply_workflow_delta(p_workflow_id => 'd1000000-0000-4000-8000-000000001877', p_base_version => pg_temp.version_of('d1000000-0000-4000-8000-000000001877'),
     p_delete_node_ids => ARRAY['C', NULL], p_user_id => '00000000-0000-4000-8000-000000001877')));
SELECT pg_temp.assert_true('a NULL inside the node delete list removes only the named node',
  (SELECT string_agg(n->>'id', ',' ORDER BY ord) = 'A,B'
     FROM public.workflows w, jsonb_array_elements(w.nodes) WITH ORDINALITY AS t(n, ord)
    WHERE w.id = 'd1000000-0000-4000-8000-000000001877'));
SELECT pg_temp.assert_true('an empty delete list is accepted',
  (SELECT ok FROM public.apply_workflow_delta(p_workflow_id => 'd1000000-0000-4000-8000-000000001877', p_base_version => pg_temp.version_of('d1000000-0000-4000-8000-000000001877'),
     p_user_id => '00000000-0000-4000-8000-000000001877')));
SELECT pg_temp.assert_true('an empty delete list still deletes nothing',
  pg_temp.edge_ids('d1000000-0000-4000-8000-000000001877') = '<none>,<none>');
RESET ROLE;

-- The redefinition keeps the function's security shape.
SELECT pg_temp.assert_true('apply_workflow_delta is still SECURITY DEFINER with the pinned search_path',
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
     FROM pg_proc WHERE oid = 'public.apply_workflow_delta(uuid,integer,jsonb,text[],jsonb,text[],jsonb,uuid)'::regprocedure));
SELECT pg_temp.assert_true('anon still cannot run it',
  NOT has_function_privilege('anon', 'public.apply_workflow_delta(uuid,integer,jsonb,text[],jsonb,text[],jsonb,uuid)', 'EXECUTE'));

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
