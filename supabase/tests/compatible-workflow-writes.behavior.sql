\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(label text, value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT FAIL: %', label; END IF;
 RAISE NOTICE 'ok  %', label;
END $$;
INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role) VALUES
 ('00000000-0000-4000-8000-000000000986','compatible@test.invalid','{}','authenticated','authenticated');
INSERT INTO public.projects(id,user_id,name) VALUES
 ('c0000000-0000-4000-8000-000000000986','00000000-0000-4000-8000-000000000986','Compatible writes');
SET LOCAL ROLE service_role;
SELECT id AS guarded_id FROM public.create_compatible_workflow('{
 "project_id":"c0000000-0000-4000-8000-000000000986", "user_id":"00000000-0000-4000-8000-000000000986",
 "name":"Linked", "nodes":[{"id":"A","data":{"keyframeId":"A"}}], "edges":[],
 "settings":{"studio":{"requiredCapabilities":["studio-dependent-frames-v1"],"keyframes":[]}}, "app_slug":"studio"
}') \gset
SELECT set_config('test.guarded_id', :'guarded_id', true);
SELECT pg_temp.assert_true('compatible insert succeeds', EXISTS(SELECT 1 FROM public.workflows WHERE id = :'guarded_id'));
SELECT pg_temp.assert_true('compatible writer flag does not leak', current_setting('nodaro.compatible_workflow_write',true) IS DISTINCT FROM 'on');
SELECT pg_temp.assert_true('stale CAS changes nothing', (SELECT count(*) = 0 FROM public.compare_and_swap_compatible_workflow(:'guarded_id',999,'{"name":"stale"}')));
SELECT pg_temp.assert_true('compatible CAS advances version', (SELECT version = 2 AND name = 'Reviewed' FROM public.compare_and_swap_compatible_workflow(:'guarded_id',1,'{"name":"Reviewed","settings":{"studio":{"keyframes":[],"settledJobIds":["job"]}}}')));
SELECT pg_temp.assert_true('identity columns cannot be smuggled into CAS', NOT has_function_privilege('authenticated','public.compare_and_swap_compatible_workflow(uuid,integer,jsonb)','EXECUTE'));
DO $$ BEGIN
 BEGIN
  PERFORM public.compare_and_swap_compatible_workflow(current_setting('test.guarded_id')::uuid,2,'{"user_id":"00000000-0000-4000-8000-000000000987"}');
  RAISE EXCEPTION 'ASSERT FAIL: caller changed identity';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  UPDATE public.workflows SET nodes = '[]', settings = '{}' WHERE id = current_setting('test.guarded_id')::uuid;
  RAISE EXCEPTION 'ASSERT FAIL: ordinary server writer stripped dependencies';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN
  INSERT INTO public.workflows(project_id,user_id,name,nodes) VALUES
   ('c0000000-0000-4000-8000-000000000986','00000000-0000-4000-8000-000000000986','Bypass','[{"id":"B","data":{"sequenceBinding":null}}]');
  RAISE EXCEPTION 'ASSERT FAIL: unreviewed insert';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END $$;
UPDATE public.workflows SET name = 'Metadata only' WHERE id = :'guarded_id';
INSERT INTO public.workflows(id,project_id,user_id,name,nodes,settings) VALUES
 ('d0000000-0000-4000-8000-000000000986','c0000000-0000-4000-8000-000000000986','00000000-0000-4000-8000-000000000986','Ordinary','[]','{}');
UPDATE public.workflows SET nodes = '[{"id":"ordinary","data":{"prompt":"still editable"}}]' WHERE id = 'd0000000-0000-4000-8000-000000000986';
SELECT pg_temp.assert_true('ordinary server writes remain available', EXISTS(SELECT 1 FROM public.workflows WHERE id = 'd0000000-0000-4000-8000-000000000986' AND version=2));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000986',true);
SET LOCAL ROLE authenticated;
SELECT set_config('nodaro.compatible_workflow_write','on',true);
DO $$ DECLARE v_id uuid := current_setting('test.guarded_id')::uuid; v_version integer;
BEGIN
 SELECT version INTO v_version FROM public.workflows WHERE id = v_id;
 BEGIN
  UPDATE public.workflows SET nodes = '[]', settings = '{}' WHERE id = v_id;
  RAISE EXCEPTION 'ASSERT FAIL: forged flag allowed raw client write';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN
  PERFORM public.apply_workflow_delta(p_workflow_id => v_id, p_base_version => v_version,
   p_delete_node_ids => ARRAY['A'], p_set => '{"settings":{}}');
  RAISE EXCEPTION 'ASSERT FAIL: SECURITY DEFINER delta bypass';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN
  PERFORM public.create_compatible_workflow('{}');
  RAISE EXCEPTION 'ASSERT FAIL: public compatible create';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.compare_and_swap_compatible_workflow(v_id,v_version,'{}');
  RAISE EXCEPTION 'ASSERT FAIL: public compatible update';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'ok  direct client, forged flag, delta RPC and privileged RPC attempts refused';
END $$;
UPDATE public.workflows SET name = 'Ordinary client edit' WHERE id = 'd0000000-0000-4000-8000-000000000986';
SELECT pg_temp.assert_true('ordinary RLS owner edit succeeds', EXISTS(SELECT 1 FROM public.workflows WHERE id = 'd0000000-0000-4000-8000-000000000986' AND name='Ordinary client edit'));
RESET ROLE;
SELECT set_config('nodaro.compatible_workflow_write','',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true('stored dependencies survived every refusal', EXISTS(SELECT 1 FROM public.workflows WHERE id=:'guarded_id' AND settings->'studio'->'settledJobIds' = '["job"]'::jsonb AND nodes->0->'data'->>'keyframeId'='A'));
DELETE FROM public.workflows WHERE id=:'guarded_id';
SELECT pg_temp.assert_true('normal whole-workflow deletion stays available', NOT EXISTS(SELECT 1 FROM public.workflows WHERE id=:'guarded_id'));
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
