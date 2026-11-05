-- ============================================================================
-- Behavioral proof: browser roles run only the SECURITY DEFINER functions that
-- are declared here. Everything else is server-only by default.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Postgres grants EXECUTE on a new function to PUBLIC, and Supabase
-- default privileges grant it to anon and authenticated by name, so a function
-- is browser-callable until a migration runs
-- REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated.
--
--   1. No non-trigger SECURITY DEFINER function in public is executable by anon
--      or authenticated unless browser_callable names it. A new function that
--      forgets its revoke fails here.
--   2. Every browser_callable entry exists, has one overload, is executable by
--      authenticated, and is executable by anon only where it says so.
--   3. Every server_only signature still in the database is closed to PUBLIC,
--      anon and authenticated, and open to service_role. This also covers the
--      entries that are SECURITY INVOKER or triggers, which (1) does not scan.
--   4. The browser roles read no server-only jobs column and write nothing on
--      jobs or pipelines. On app_runs, authenticated updates exactly the columns
--      the run PATCH accepts. jobs.status stays readable.
--   5. On profiles, authenticated updates exactly last_workspace_id and anon
--      updates nothing, whatever columns the table gains. service_role updates.
--
-- To add a browser-callable function, add it to browser_callable with the reason
-- it is safe: it checks the caller, or a policy needs it.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_none(label text, offenders text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERT FAIL %: %', label, offenders;
  END IF;
  RAISE NOTICE 'ok %', label;
END;
$$;

CREATE TEMP TABLE browser_callable (
  name text PRIMARY KEY,
  anon_allowed boolean NOT NULL,
  reason text NOT NULL CHECK (reason <> '')
) ON COMMIT DROP;

INSERT INTO browser_callable (name, anon_allowed, reason) VALUES
  ('apply_workflow_delta', false,
   'The editor''s save call. Writes only for a caller who owns or can edit the workflow. Trusts p_user_id when auth.uid() is NULL, so anon stays closed.'),
  ('check_profiles_update_allowed', false,
   'Profiles UPDATE policy helper: compares the proposed protected columns with the stored row. Only authenticated can update profiles, so anon stays closed.'),
  ('check_projects_update_allowed', false,
   'Projects UPDATE policy helper: refuses a change to the owner, workspace or default flag. Anon has no update path.'),
  ('check_workflows_update_allowed', false,
   'Workflows UPDATE policy helper: refuses a change to ownership and provenance, and gates sharing levers on the caller. Anon has no update path.'),
  ('deployment_payer_user_id', true,
   'Profiles SELECT policy helper. The policy applies to every role and anon holds SELECT on profiles, so without EXECUTE an anon read of the table errors.'),
  ('effective_setting', false,
   'Workspace setting read, gated on the caller''s membership. Treats a NULL auth.uid() as the server, so anon stays closed.'),
  ('ensure_default_project', false,
   'Called by the browser. Refuses a caller with no auth.uid() and only touches the caller''s own project.'),
  ('get_admin_stats', false,
   'Called by the admin panel. Refuses a caller who is not an admin.'),
  ('get_admin_usage_logs', false,
   'Called by the admin panel. Refuses a caller who is not an admin.'),
  ('get_my_role', true,
   'Returns only the role of auth.uid() and takes no input.'),
  ('is_admin', true,
   'RLS policy helper, used by policies that apply to anon. Checks auth.uid() and takes no input.'),
  ('org_member_status', false,
   'Returns the caller''s own status. Trusts p_user_id when auth.uid() is NULL, so anon stays closed.'),
  ('org_role', false,
   'RLS policy helper. Returns the caller''s own role. Trusts p_user_id when auth.uid() is NULL, so anon stays closed.'),
  ('org_setting', false,
   'Organization setting read, gated on the caller''s membership. Treats a NULL auth.uid() as the server, so anon stays closed.'),
  ('workflow_access', false,
   'RLS policy helper. Resolves access for the caller. Trusts p_user_id when auth.uid() is NULL, so anon stays closed.'),
  ('workspace_member_status', false,
   'Returns the caller''s own status. Trusts p_user_id when auth.uid() is NULL, so anon stays closed.'),
  ('workspace_role', false,
   'RLS policy helper. Returns the caller''s own role. Trusts p_user_id when auth.uid() is NULL, so anon stays closed.'),
  ('ws_setting_bool', false,
   'RLS policy helper over effective_setting, which is gated on membership. Anon stays closed for the same reason.');

CREATE TEMP TABLE server_only (sig text PRIMARY KEY) ON COMMIT DROP;

INSERT INTO server_only (sig) VALUES
  ('abort_external_wallet(uuid)'),
  ('accept_invitation(text,uuid,text)'),
  ('activate_signup_grant(uuid,integer)'),
  ('add_subscription_credits(uuid,integer)'),
  ('add_topup_credits(uuid,integer)'),
  ('admin_adjust_credits(uuid,text,integer)'),
  ('admin_job_list(integer,integer,text,uuid,uuid[],text[],text[],integer,text[],timestamptz,timestamptz,text,boolean)'),
  ('admin_job_output_preview(jsonb)'),
  ('admin_job_own_credits(uuid,uuid,integer)'),
  ('admin_job_page(integer,integer,text,uuid,uuid[],text[],text[],integer,text[],timestamptz,timestamptz,text,boolean)'),
  ('admin_job_sources(timestamptz)'),
  ('admin_job_url_skeleton(jsonb)'),
  ('admin_motion_engine(jsonb)'),
  ('admin_motion_run_list(timestamptz,timestamptz,numeric,jsonb,text[],text,text,text,text,boolean,text,text,integer,integer)'),
  ('admin_motion_runs(timestamptz,timestamptz,uuid,numeric,jsonb,text[])'),
  ('admin_motion_style(jsonb)'),
  ('admin_motion_task_ids(timestamptz,timestamptz)'),
  ('admin_motion_tree(uuid[],jsonb,text[])'),
  ('allocate_workspace_credits(uuid,uuid,integer,uuid)'),
  ('app_analytics_one_run_since()'),
  ('app_analytics_recount_retried_runs()'),
  ('app_run_credits_total(uuid,uuid,uuid)'),
  ('append_character_asset(uuid,uuid,text,jsonb)'),
  ('append_character_reference_video(uuid,uuid,text,text)'),
  ('append_creature_asset(uuid,text,jsonb)'),
  ('append_location_asset(uuid,text,jsonb)'),
  ('append_object_asset(uuid,text,jsonb)'),
  ('apply_pending_deployment_allowance(uuid,text,text)'),
  ('asset_is_held(uuid)'),
  ('asset_recorded_reference_by_shape(text,uuid,bigint,uuid,uuid,text,text)'),
  ('assets_pipeline_owner_check()'),
  ('assets_recorded_reference_immutable()'),
  ('assets_stamp_recorded_reference()'),
  ('authorize_external_wallet(uuid)'),
  ('blank_job_output_urls(text[],integer)'),
  ('capture_external_wallet_settlement()'),
  ('character_workflow_usage(uuid,uuid)'),
  ('check_credits(uuid,integer)'),
  ('check_storage_quota(uuid,bigint)'),
  ('checkpoint_job_settlement(uuid,uuid,uuid,integer,integer,boolean,text,numeric)'),
  ('claim_auto_recharge(uuid)'),
  ('claim_character_lora_training(uuid,uuid)'),
  ('claim_job_finalize(uuid,integer,text)'),
  ('claim_recast_rescore(uuid,uuid,uuid,uuid,text,jsonb)'),
  ('claim_retained_image_gc(integer)'),
  ('claim_retained_video_gc(integer)'),
  ('claim_signup_grant(uuid,integer,boolean,boolean,boolean)'),
  ('claim_webhook_deliveries(text,integer,integer,integer,integer,integer)'),
  ('claw_back_org_credits(uuid,integer,text)'),
  ('clawback_topup_credits(uuid,text,integer,numeric)'),
  ('clear_recast_rescore_claim(uuid,uuid,uuid)'),
  ('commit_credits(uuid,integer)'),
  ('commit_credits_metered(uuid,integer)'),
  ('compare_and_swap_compatible_workflow(uuid,integer,jsonb)'),
  ('complete_job_and_settle(uuid,jsonb,boolean)'),
  ('complete_retained_image(uuid,text)'),
  ('complete_retained_image_gc(uuid)'),
  ('complete_retained_video(uuid,text)'),
  ('complete_retained_video_gc(uuid)'),
  ('consent_try_show(uuid,text,integer,integer,integer)'),
  ('content_rights_import_share(timestamptz)'),
  ('create_compatible_workflow(jsonb)'),
  ('create_workspace_with_project(uuid,text,text,text,jsonb,uuid)'),
  ('decrement_storage(uuid,bigint)'),
  ('deduct_credits(uuid,integer)'),
  ('delete_job_with_recast_cleanup(uuid,uuid,boolean)'),
  ('delete_project_with_recast_cleanup(uuid,uuid)'),
  ('delete_trashed_job_with_recast_cleanup(uuid,uuid,boolean,timestamptz)'),
  ('delete_workflow_with_recast_cleanup(uuid,uuid)'),
  ('expire_topup_credits(uuid)'),
  ('expunge_app_snapshots(uuid)'),
  ('find_user_by_sso_subject(text)'),
  ('generation_session_previews(uuid[])'),
  ('get_credit_summary()'),
  ('get_stats(uuid)'),
  ('get_total_credits(uuid)'),
  ('grant_deployment_allowance(uuid,integer,uuid,text,text,uuid)'),
  ('grant_org_credits_idempotent(uuid,integer,text,text,numeric)'),
  ('grant_topup_credits_idempotent(uuid,integer,text,numeric)'),
  ('grant_yearly_plan_monthly_credits(uuid,uuid,text,timestamptz,timestamptz,integer)'),
  ('guard_compatible_workflow_write()'),
  ('guard_retained_image()'),
  ('guard_retained_video()'),
  ('held_storage_keys_among(text[])'),
  ('hold_restriction_for_court_action()'),
  ('import_source_policies_version()'),
  ('increment_daily_spent(uuid,integer)'),
  ('increment_storage(uuid,bigint)'),
  ('job_platform_key(text,text)'),
  ('jobs_execution_owner_check()'),
  ('jobs_pointer_owner_check()'),
  ('join_workspace_by_code(text,uuid,text)'),
  ('jsonb_with_strings_nulled(jsonb,text[])'),
  ('lift_content_restriction(uuid,uuid,text)'),
  ('list_trash(uuid,uuid,text,uuid,boolean,text[],timestamptz,text,integer)'),
  ('llm_side_hold_call_starting(uuid)'),
  ('log_rights_complaint_update()'),
  ('mark_job_outputs_cleaned(uuid[],text[])'),
  ('merge_restriction_bytes(uuid,jsonb)'),
  ('move_session_items(uuid,uuid,uuid,uuid,uuid[])'),
  ('org_usage_report(text,uuid,date,date,text,text,uuid,uuid)'),
  ('org_usage_rows(text,uuid,date,date,text,uuid,uuid,timestamptz,uuid,integer)'),
  ('org_usage_totals(text,uuid,date,date,text,uuid,uuid)'),
  ('org_usage_variance(text,uuid,date,date,text,uuid,uuid)'),
  ('org_usage_window(date,date,text)'),
  ('personal_space_enabled_for(uuid)'),
  ('pipeline_entities_asset_owner_check()'),
  ('pipeline_entity_variants_asset_owner_check()'),
  ('prepare_external_wallet(uuid,uuid,uuid,text)'),
  ('preserve_account_infringement()'),
  ('preserve_account_sanction()'),
  ('preserve_content_restriction()'),
  ('preserve_content_rights_authorization()'),
  ('preserve_content_rights_confirmation()'),
  ('preserve_held_asset()'),
  ('preserve_held_job()'),
  ('preserve_job_submission_context()'),
  ('preserve_retained_job_image()'),
  ('preserve_retained_job_video()'),
  ('preserve_rights_complaint()'),
  ('preserve_rights_counter_notice()'),
  ('preserve_rights_event()'),
  ('process_app_monetization(uuid,uuid,integer,uuid,uuid,integer,integer,integer,uuid)'),
  ('protect_active_retained_images()'),
  ('protect_active_retained_videos()'),
  ('prune_webhook_deliveries(integer,integer)'),
  ('publish_community_listing(uuid,uuid,text,uuid,text,text,text,text,text,text,text[],text,jsonb,timestamptz,bigint,jsonb)'),
  ('publish_legacy_recast_rescore(uuid,uuid,uuid,uuid,text,jsonb)'),
  ('publish_recast_rescore(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)'),
  ('queue_retained_image_gc()'),
  ('queue_retained_video_gc()'),
  ('record_auto_recharge_failure(uuid)'),
  ('record_clone(uuid,uuid,text,uuid)'),
  ('record_picker_catalog_gap(text,text,text,text,text,text,uuid)'),
  ('record_retained_image_copy(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'),
  ('record_retained_job_image(uuid,uuid,uuid,uuid,text)'),
  ('record_retained_job_video(uuid,uuid,uuid,uuid,text)'),
  ('record_retained_video_copy(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'),
  ('record_webhook_delivery_attempt(uuid,integer,text,timestamptz,jsonb,integer,text,integer,text,integer,integer)'),
  ('refund_credits(uuid)'),
  ('refund_settled_metered_charge(uuid,uuid)'),
  ('refund_settled_side_hold(uuid)'),
  ('refuse_case_close_while_counter_notice_waits()'),
  ('refuse_content_rights_truncate()'),
  ('refuse_rights_complaint_event_change()'),
  ('reinstate_signup_grant(uuid)'),
  ('remove_creature_asset(uuid,uuid,text,text)'),
  ('remove_location_asset(uuid,uuid,text,text)'),
  ('remove_object_asset(uuid,uuid,text,text)'),
  ('replace_import_source_policies(jsonb,uuid,text)'),
  ('reserve_credits(uuid,integer,uuid,text,numeric,numeric,boolean,integer,boolean,uuid,uuid,boolean)'),
  ('reserve_job_credits(uuid,integer,uuid,text,numeric,numeric,boolean,integer,boolean,uuid,uuid,boolean,boolean)'),
  ('reserve_llm_side_hold(uuid,integer,uuid,text,text,boolean,integer,boolean,uuid,uuid,boolean)'),
  ('reserve_retained_image(uuid,uuid,text,bigint,integer,integer,text,text)'),
  ('reserve_retained_video(uuid,uuid,text,bigint,integer,integer,integer,text,text)'),
  ('reserve_storage_if_within_limit(uuid,bigint)'),
  ('reset_daily_spent(uuid)'),
  ('reset_daily_spent_if_needed(uuid)'),
  ('reset_member_spend(uuid,uuid)'),
  ('restrict_content(uuid,uuid,text[],text,text,uuid,text,uuid,uuid)'),
  ('reverse_settled_llm_charge(uuid,uuid,text,text)'),
  ('revoke_signup_grant(uuid,integer,uuid)'),
  ('rights_record_person_kept(uuid,uuid)'),
  ('rotate_webhook_secret(uuid,uuid,text,text,timestamptz)'),
  ('scene3d_assert_artifact_id_live(uuid,text,text)'),
  ('scene3d_claim_artifact_gc(integer,interval)'),
  ('scene3d_complete_artifact_gc(uuid)'),
  ('scene3d_enqueue_artifact_gc()'),
  ('scene3d_enqueue_intent_gc()'),
  ('scene3d_keep_artifact_immutable()'),
  ('scene3d_keep_delivery_immutable()'),
  ('scene3d_keep_revision_immutable()'),
  ('scene3d_publish_delivery(jsonb)'),
  ('scene3d_publish_refused_delivery(jsonb)'),
  ('scene3d_publish_revision(jsonb)'),
  ('scene3d_record_upload_receipt(jsonb)'),
  ('scene3d_reserve_upload(jsonb)'),
  ('scene3d_sweep_expired_artifacts(integer)'),
  ('scene3d_sweep_expired_upload_intents(integer)'),
  ('scene_node_data_urls(jsonb)'),
  ('set_deployment_allowance(uuid,integer,uuid,text,text,uuid)'),
  ('set_member_credit_cap(uuid,uuid,integer)'),
  ('settle_checkpointed_job_reservation(uuid)'),
  ('settle_counter_notice_on_lift()'),
  ('settle_job_reservation(uuid,uuid,uuid,text,integer,text,numeric)'),
  ('signup_signal_clusters(text,integer,integer)'),
  ('sso_subjects_for(uuid[])'),
  ('storage_url_ascii_decode(text)'),
  ('storage_url_is_foreign(text,uuid)'),
  ('storage_url_normalize(text)'),
  ('storage_url_path(text)'),
  ('storage_url_query_urls(text)'),
  ('transfer_org_ownership(uuid,uuid,uuid)'),
  ('update_app_analytics()'),
  ('upsert_execution_stats(text,text,text,integer,integer)'),
  ('urls_linked_by_jobs_since(text[],timestamptz[])'),
  ('usage_log_charge(text,integer,integer)'),
  ('user_has_held_content(uuid)'),
  ('webhook_deliveries_job_deleted()'),
  ('webhook_deliveries_owner_guard()'),
  ('webhook_endpoints_waiting(uuid,integer)'),
  ('webhooks_capture_job_event()'),
  ('webhooks_enforce_cap()'),
  ('webhooks_record_job_event(uuid,uuid,text,text,text,uuid)'),
  ('workflow_requires_compatible_writer(jsonb,jsonb)');

CREATE TEMP VIEW definer AS
SELECT p.oid,
       p.oid::regprocedure::text AS sig,
       p.proname::text AS name,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.prosecdef
   AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
   AND NOT EXISTS (
     SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e');

CREATE TEMP VIEW server_only_present AS
SELECT s.sig, to_regprocedure('public.' || s.sig) AS fn
  FROM server_only s
 WHERE to_regprocedure('public.' || s.sig) IS NOT NULL;

SELECT pg_temp.assert_none(
  'SECURITY DEFINER functions a browser role can run that browser_callable does not name (add the revoke, or declare it with a reason)',
  (SELECT string_agg(d.sig, ', ' ORDER BY d.sig) FROM definer d
    WHERE (d.anon OR d.authenticated)
      AND d.name NOT IN (SELECT name FROM browser_callable)));

SELECT pg_temp.assert_none(
  'browser_callable entries with no SECURITY DEFINER function of that name',
  (SELECT string_agg(b.name, ', ' ORDER BY b.name) FROM browser_callable b
    WHERE NOT EXISTS (SELECT 1 FROM definer d WHERE d.name = b.name)));

-- The list matches by name, so a second overload must not ride in on it.
SELECT pg_temp.assert_none(
  'browser_callable entries with more than one overload',
  (SELECT string_agg(o.name, ', ' ORDER BY o.name) FROM (
     SELECT d.name FROM definer d JOIN browser_callable b USING (name)
      GROUP BY d.name HAVING count(*) > 1) o));

SELECT pg_temp.assert_none(
  'browser_callable entries authenticated cannot run (a policy would error, or the entry is stale)',
  (SELECT string_agg(d.sig, ', ' ORDER BY d.sig) FROM definer d JOIN browser_callable b USING (name)
    WHERE NOT d.authenticated));

SELECT pg_temp.assert_none(
  'browser_callable entries whose anon access differs from anon_allowed',
  (SELECT string_agg(d.sig || ' anon=' || d.anon, ', ' ORDER BY d.sig) FROM definer d JOIN browser_callable b USING (name)
    WHERE d.anon IS DISTINCT FROM b.anon_allowed));

SELECT pg_temp.assert_none(
  'server_only signatures a browser role or PUBLIC can run',
  (SELECT string_agg(s.sig, ', ' ORDER BY s.sig) FROM server_only_present s
    WHERE has_function_privilege('public', s.fn, 'EXECUTE')
       OR has_function_privilege('anon', s.fn, 'EXECUTE')
       OR has_function_privilege('authenticated', s.fn, 'EXECUTE')));

-- webhooks_record_job_event is closed to service_role on purpose: it runs only
-- inside its trigger (webhooks.behavior.sql holds that).
SELECT pg_temp.assert_none(
  'server_only signatures service_role cannot run',
  (SELECT string_agg(s.sig, ', ' ORDER BY s.sig) FROM server_only_present s
    WHERE s.sig <> 'webhooks_record_job_event(uuid,uuid,text,text,text,uuid)'
      AND NOT has_function_privilege('service_role', s.fn, 'EXECUTE')));

SELECT pg_temp.assert_none(
  'server_only list resolves to no function at all',
  (SELECT 'none found' WHERE NOT EXISTS (SELECT 1 FROM server_only_present)));

SELECT pg_temp.assert_none(
  'browser roles that can read a server-only jobs column',
  (SELECT string_agg(r || ' ' || c, ', ' ORDER BY r, c)
     FROM unnest(ARRAY['anon', 'authenticated']) r,
          unnest(ARRAY['llm_billing', 'provider_cost', 'submission_context']) c
    WHERE has_column_privilege(r, 'public.jobs', c, 'SELECT')));

SELECT pg_temp.assert_none(
  'browser roles that can write jobs or pipelines',
  (SELECT string_agg(r || ' ' || p || ' ' || t, ', ' ORDER BY r, t, p)
     FROM unnest(ARRAY['anon', 'authenticated']) r,
          unnest(ARRAY['public.jobs', 'public.pipelines']) t,
          unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
    WHERE has_table_privilege(r, t, p)
       OR (p IN ('INSERT', 'UPDATE') AND has_any_column_privilege(r, t, p))));

SELECT pg_temp.assert_none(
  'browser roles that can insert, delete or truncate app_runs, or anon updating it',
  (SELECT string_agg(r || ' ' || p, ', ' ORDER BY r, p)
     FROM unnest(ARRAY['anon', 'authenticated']) r,
          unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
    WHERE has_table_privilege(r, 'public.app_runs', p)
       OR (p = 'INSERT' AND has_any_column_privilege(r, 'public.app_runs', p))
       OR (p = 'UPDATE' AND r = 'anon' AND has_any_column_privilege(r, 'public.app_runs', p))));

-- The exact set, so credits_used (or any new column) cannot become writable and
-- name cannot stop being writable. backend/src/lib/app-run-ownership.ts owns it.
SELECT pg_temp.assert_none(
  'app_runs columns authenticated can update that it should not, or cannot that it should',
  (SELECT string_agg(a.attname, ', ' ORDER BY a.attname)
     FROM pg_attribute a
    WHERE a.attrelid = 'public.app_runs'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
          IS DISTINCT FROM (a.attname IN ('input_values', 'name', 'hidden_nodes', 'node_states'))));

SELECT pg_temp.assert_none(
  'authenticated cannot read jobs.status',
  (SELECT 'jobs.status' WHERE NOT has_column_privilege('authenticated', 'public.jobs', 'status', 'SELECT')));

SELECT pg_temp.assert_none(
  'service_role cannot read and write these tables',
  (SELECT string_agg(p || ' ' || t, ', ' ORDER BY t, p)
     FROM unnest(ARRAY['public.jobs', 'public.pipelines', 'public.app_runs']) t,
          unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    WHERE NOT has_table_privilege('service_role', t, p)));

-- Every column of the table, read from the catalog, so a column added later is
-- covered without touching this file. A table-level grant would make it writable.
SELECT pg_temp.assert_none(
  'profiles columns authenticated can update that it should not, or cannot that it should',
  (SELECT string_agg(a.attname, ', ' ORDER BY a.attname)
     FROM pg_attribute a
    WHERE a.attrelid = 'public.profiles'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
          IS DISTINCT FROM (a.attname = 'last_workspace_id')));

SELECT pg_temp.assert_none(
  'a table-level UPDATE on profiles held by a browser role',
  (SELECT string_agg(r, ', ' ORDER BY r) FROM unnest(ARRAY['anon', 'authenticated']) r
    WHERE has_table_privilege(r, 'public.profiles', 'UPDATE')));

SELECT pg_temp.assert_none(
  'anon can update a profiles column',
  (SELECT 'anon' WHERE has_any_column_privilege('anon', 'public.profiles', 'UPDATE')));

SELECT pg_temp.assert_none(
  'service_role cannot update profiles',
  (SELECT 'service_role' WHERE NOT has_table_privilege('service_role', 'public.profiles', 'UPDATE')));

-- The same rule through real statements, RLS and the policy's guard included.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
 ('00000000-0000-4000-8000-000000598101', 'profile-column-lock@test.invalid', '{}', 'authenticated', 'authenticated');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000598101","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000598101';
DO $$
DECLARE
  n int;
  c text;
BEGIN
  UPDATE public.profiles SET last_workspace_id = NULL
   WHERE id = '00000000-0000-4000-8000-000000598101';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAIL: the owner did not update last_workspace_id (% rows)', n;
  END IF;
  FOREACH c IN ARRAY ARRAY[
    'app_credits_allowance', 'total_earnings', 'storage_used_bytes',
    'last_daily_reset', 'current_period_end', 'subscription_ended_at', 'role', 'full_name'
  ] LOOP
    BEGIN
      EXECUTE format('UPDATE public.profiles SET %I = %I WHERE id = %L',
                     c, c, '00000000-0000-4000-8000-000000598101');
      RAISE EXCEPTION 'ASSERT FAIL: the owner updated profiles.%', c;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'ok the owner updates last_workspace_id and no other column';
END
$$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    UPDATE public.profiles SET last_workspace_id = NULL
     WHERE id = '00000000-0000-4000-8000-000000598101';
    RAISE EXCEPTION 'ASSERT FAIL: anon updated profiles.last_workspace_id';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok anon updates nothing on profiles';
END
$$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  n int;
BEGIN
  UPDATE public.profiles SET storage_used_bytes = storage_used_bytes
   WHERE id = '00000000-0000-4000-8000-000000598101';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAIL: service_role did not update profiles (% rows)', n;
  END IF;
  RAISE NOTICE 'ok service_role updates profiles';
END
$$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
