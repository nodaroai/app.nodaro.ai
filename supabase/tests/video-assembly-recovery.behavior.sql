-- Separate clips stay completed through a crashed lease, failed assembly,
-- policy change, deletion and successful replacement. No reservation is made.
BEGIN;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-4000-8000-000000071690','assembly-delivery@example.test');

-- The new job columns are the server's: no client role reads them, and none
-- writes the Library table whose rule now reads one of them.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_column_privilege(r,'public.jobs','video_assembly_recovery','SELECT') OR has_column_privilege(r,'public.jobs','metadata','SELECT')
      OR has_column_privilege(r,'public.jobs','video_assembly_recovery','UPDATE') OR has_column_privilege(r,'public.jobs','metadata','UPDATE') THEN
      RAISE EXCEPTION 'A client role can read or write the server''s job columns (%)',r;
    END IF;
    IF has_table_privilege(r,'public.assets','UPDATE') OR has_table_privilege(r,'public.workflow_executions','UPDATE') THEN
      RAISE EXCEPTION 'A client role writes a table whose trigger reads the server''s job columns (%)',r;
    END IF;
  END LOOP;
END;
$$;

-- As the server calls: every function below runs with the service role's own privileges.
SET LOCAL ROLE service_role;
DO $$
DECLARE
  uid uuid := '00000000-0000-4000-8000-000000071690';
  jid uuid := '00000000-0000-4000-8000-000000071691';
  clip text := 'https://files.example.test/videos/'||jid||'-delivery-1.mp4';
  outp jsonb := jsonb_build_object('deliveryMode','separate_clips','videoUrl',clip,'unassembledClips',jsonb_build_array(jsonb_build_object('segment',1,'url',clip)));
  m jsonb := jsonb_build_object('env','assembly-fixture','owner',uid,'watermark',true,'jobType','generate-video-pro','primary',clip,'delivered',outp->'unassembledClips','attempts',0,'state','pending','due',0);
  exec_id uuid := '00000000-0000-4000-8000-000000071692';
  project_id uuid;
  wf_id uuid;
  initial_states jsonb := jsonb_build_object('video',jsonb_build_object('status','completed','output',jsonb_build_object(
    'videoUrl',clip,'clipJobId',jid,'unassembledClips',outp->'unassembledClips','listResults',jsonb_build_array('https://edited',clip),
    'listResultStamps',jsonb_build_array(jsonb_build_object('clipJobId',jid),jsonb_build_object('clipJobId',jid)))));
  repaired_states jsonb;
  c jsonb;
  old_id uuid;
  aid uuid;
  k text;
  candidate text;
  f regprocedure;
BEGIN
  FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE proname IN ('claim_video_assembly','finish_video_assembly') LOOP
    IF has_function_privilege('authenticated',f,'execute') OR has_function_privilege('anon',f,'execute') OR NOT has_function_privilege('service_role',f,'execute')
      THEN RAISE EXCEPTION 'Invalid recovery grant %',f; END IF;
  END LOOP;
  INSERT INTO public.projects(user_id,name) VALUES(uid,'Assembly test') RETURNING id INTO project_id;
  INSERT INTO public.workflows(project_id,user_id,name) VALUES(project_id,uid,'Assembly test') RETURNING id INTO wf_id;
  INSERT INTO public.workflow_executions(id,workflow_id,user_id,status,node_states) VALUES(exec_id,wf_id,uid,'completed',initial_states);
  INSERT INTO public.jobs(id,user_id,status,job_type,output_data,should_watermark,stop_requested_at,video_assembly_recovery,workflow_execution_id,input_data)
    VALUES(jid,uid,'completed','generate-video-pro',outp,true,now(),m,exec_id,'{"node_id":"video"}');
  INSERT INTO public.assets(user_id,job_id,type,filename,mime_type,size_bytes,r2_key,r2_url,metadata)
    VALUES(uid,jid,'video','clip.mp4','video/mp4',12,'videos/'||jid||'-delivery-1.mp4',clip,'{"separateClipCount":1}');
  IF public.claim_video_assembly('unrelated-fixture') IS NOT NULL THEN RAISE EXCEPTION 'Cross-env claim'; END IF;
  c := public.claim_video_assembly('assembly-fixture');
  old_id := (c->'manifest'->>'attemptId')::uuid;
  IF old_id IS NULL OR public.claim_video_assembly('assembly-fixture') IS NOT NULL THEN RAISE EXCEPTION 'Duplicate lease'; END IF;
  -- A deployment exits after uploading the first candidate. Another worker
  -- gets a fresh attempt id and may clean the abandoned files.
  UPDATE public.jobs SET video_assembly_recovery=jsonb_set(video_assembly_recovery,'{due}','0') WHERE id=jid;
  c := public.claim_video_assembly('assembly-fixture');
  aid := (c->'manifest'->>'attemptId')::uuid;
  IF aid IS NULL OR aid=old_id OR NOT ((c->'manifest'->'abandoned') ? old_id::text) THEN RAISE EXCEPTION 'Lost crash recovery'; END IF;
  k := 'videos/'||jid||'-assembly-'||aid||'.mp4';
  candidate := 'https://files.example.test/'||k;
  IF public.finish_video_assembly(jid,old_id,'publish',outp,candidate,k,25,ARRAY[k],'[]') THEN RAISE EXCEPTION 'Stale publisher'; END IF;
  IF NOT public.finish_video_assembly(jid,aid,'publish',outp,candidate,k,25,ARRAY[k],'[]') THEN RAISE EXCEPTION 'Live publication lost'; END IF;
  IF (SELECT output_data->>'videoUrl' FROM public.jobs WHERE id=jid) IS DISTINCT FROM candidate
     OR (SELECT output_data->'unassembledClips' FROM public.jobs WHERE id=jid) IS DISTINCT FROM outp->'unassembledClips'
     OR (SELECT status FROM public.jobs WHERE id=jid) <> 'completed'
     OR (SELECT r2_key FROM public.assets WHERE job_id=jid) IS DISTINCT FROM k
     OR EXISTS (SELECT FROM public.usage_logs WHERE job_id=jid) THEN RAISE EXCEPTION 'Lost clips, Library update or unintended charge'; END IF;
  -- The publication exception cannot retarget an ordinary asset afterwards.
  BEGIN
    UPDATE public.assets SET r2_key='videos/not-this-assembly.mp4' WHERE job_id=jid;
    RAISE EXCEPTION 'Arbitrary asset replacement was permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  repaired_states := jsonb_set(jsonb_set(initial_states,'{video,output,videoUrl}',to_jsonb(candidate)),
    '{video,output,listResults,1}',to_jsonb(candidate));
  IF (SELECT node_states FROM public.workflow_executions WHERE id=exec_id) IS DISTINCT FROM repaired_states
    THEN RAISE EXCEPTION 'Execution still plays the first clip, or a manual edit was lost'; END IF;
  -- A worker already held this first-clip snapshot when publication committed.
  UPDATE public.workflow_executions SET node_states=initial_states WHERE id=exec_id;
  IF (SELECT node_states FROM public.workflow_executions WHERE id=exec_id) IS DISTINCT FROM repaired_states
    THEN RAISE EXCEPTION 'A late snapshot reverted the assembled video'; END IF;
  -- Another original filing began before repair, but only reaches INSERT now.
  DELETE FROM public.assets WHERE job_id=jid;
  INSERT INTO public.assets(user_id,job_id,type,filename,mime_type,size_bytes,r2_key,r2_url,metadata)
    VALUES(uid,jid,'video','clip.mp4','video/mp4',12,'videos/'||jid||'-delivery-1.mp4',clip,'{"separateClipCount":1}');
  IF (SELECT r2_url FROM public.assets WHERE job_id=jid) IS DISTINCT FROM candidate THEN RAISE EXCEPTION 'Late asset filed stale primary'; END IF;
  UPDATE public.jobs SET output_data=outp,video_assembly_recovery=m WHERE id=jid;
  FOR i IN 1..4 LOOP
    c := public.claim_video_assembly('assembly-fixture'); aid := (c->'manifest'->>'attemptId')::uuid;
    IF aid IS NULL THEN RAISE EXCEPTION 'Retry % missing',i; END IF;
    PERFORM public.finish_video_assembly(jid,aid,'retry');
    IF public.claim_video_assembly('assembly-fixture') IS NOT NULL THEN RAISE EXCEPTION 'Backoff not honored'; END IF;
    UPDATE public.jobs SET video_assembly_recovery=jsonb_set(video_assembly_recovery,'{due}','0') WHERE id=jid;
  END LOOP;
  IF (SELECT video_assembly_recovery->>'state' FROM public.jobs WHERE id=jid) <> 'exhausted' THEN RAISE EXCEPTION 'Unbounded retry'; END IF;
  UPDATE public.jobs SET output_data=outp,video_assembly_recovery=m WHERE id=jid;
  c := public.claim_video_assembly('assembly-fixture'); aid := (c->'manifest'->>'attemptId')::uuid;
  UPDATE public.jobs SET deleted_at=now() WHERE id=jid;
  IF public.finish_video_assembly(jid,aid,'publish',outp,candidate,'videos/'||jid||'-assembly-'||aid||'.mp4',25,ARRAY[k],'[]')
     OR (SELECT output_data FROM public.jobs WHERE id=jid) IS DISTINCT FROM outp THEN RAISE EXCEPTION 'Deleted result republished'; END IF;
END;
$$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
