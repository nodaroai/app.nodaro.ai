-- Server-only functions are not callable by browser roles.
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default, and anon and
-- authenticated inherit it, so a revoke that names only those two roles leaves
-- the function callable. On Supabase, default privileges also grant it to both
-- roles by name. Each signature below runs on behalf of the server, so this
-- closes it to PUBLIC, anon and authenticated and keeps it for service_role.
--
-- Trigger functions on the list are closed for the same reason: firing a
-- trigger does not check EXECUTE, so closing them changes nothing they do.
--
-- webhooks_record_job_event runs only inside its trigger, and its own
-- migrations close it to service_role as well, so it gets no grant here.
--
-- A signature this database does not have is skipped. Touches privileges only:
-- no row and no function body changes, and a second run changes nothing.
--
-- supabase/tests/server-only-function-privileges.behavior.sql holds this list
-- and fails on any other SECURITY DEFINER function a browser role can run.
--
-- The rest of this file states the other privileges the migration history
-- leaves in place, so a database whose privileges did not come from running
-- that history ends up the same as one that did. Where they are already in
-- place, nothing changes.
DO $$
DECLARE
  sig text;
  fn regprocedure;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'abort_external_wallet(uuid)',
    'accept_invitation(text,uuid,text)',
    'activate_signup_grant(uuid,integer)',
    'add_subscription_credits(uuid,integer)',
    'add_topup_credits(uuid,integer)',
    'admin_adjust_credits(uuid,text,integer)',
    'admin_job_list(integer,integer,text,uuid,uuid[],text[],text[],integer,text[],timestamptz,timestamptz,text,boolean)',
    'admin_job_output_preview(jsonb)',
    'admin_job_own_credits(uuid,uuid,integer)',
    'admin_job_page(integer,integer,text,uuid,uuid[],text[],text[],integer,text[],timestamptz,timestamptz,text,boolean)',
    'admin_job_sources(timestamptz)',
    'admin_job_url_skeleton(jsonb)',
    'admin_motion_engine(jsonb)',
    'admin_motion_run_list(timestamptz,timestamptz,numeric,jsonb,text[],text,text,text,text,boolean,text,text,integer,integer)',
    'admin_motion_runs(timestamptz,timestamptz,uuid,numeric,jsonb,text[])',
    'admin_motion_style(jsonb)',
    'admin_motion_task_ids(timestamptz,timestamptz)',
    'admin_motion_tree(uuid[],jsonb,text[])',
    'allocate_workspace_credits(uuid,uuid,integer,uuid)',
    'app_analytics_one_run_since()',
    'app_analytics_recount_retried_runs()',
    'app_run_credits_total(uuid,uuid,uuid)',
    'append_character_asset(uuid,uuid,text,jsonb)',
    'append_character_reference_video(uuid,uuid,text,text)',
    'append_creature_asset(uuid,text,jsonb)',
    'append_location_asset(uuid,text,jsonb)',
    'append_object_asset(uuid,text,jsonb)',
    'apply_pending_deployment_allowance(uuid,text,text)',
    'asset_is_held(uuid)',
    'asset_recorded_reference_by_shape(text,uuid,bigint,uuid,uuid,text,text)',
    'assets_pipeline_owner_check()',
    'assets_recorded_reference_immutable()',
    'assets_stamp_recorded_reference()',
    'authorize_external_wallet(uuid)',
    'blank_job_output_urls(text[],integer)',
    'capture_external_wallet_settlement()',
    'character_workflow_usage(uuid,uuid)',
    'check_credits(uuid,integer)',
    'check_storage_quota(uuid,bigint)',
    'checkpoint_job_settlement(uuid,uuid,uuid,integer,integer,boolean,text,numeric)',
    'claim_auto_recharge(uuid)',
    'claim_character_lora_training(uuid,uuid)',
    'claim_job_finalize(uuid,integer,text)',
    'claim_recast_rescore(uuid,uuid,uuid,uuid,text,jsonb)',
    'claim_retained_image_gc(integer)',
    'claim_retained_video_gc(integer)',
    'claim_signup_grant(uuid,integer,boolean,boolean,boolean)',
    'claim_webhook_deliveries(text,integer,integer,integer,integer,integer)',
    'claw_back_org_credits(uuid,integer,text)',
    'clawback_topup_credits(uuid,text,integer,numeric)',
    'clear_recast_rescore_claim(uuid,uuid,uuid)',
    'commit_credits(uuid,integer)',
    'commit_credits_metered(uuid,integer)',
    'compare_and_swap_compatible_workflow(uuid,integer,jsonb)',
    'complete_job_and_settle(uuid,jsonb,boolean)',
    'complete_retained_image(uuid,text)',
    'complete_retained_image_gc(uuid)',
    'complete_retained_video(uuid,text)',
    'complete_retained_video_gc(uuid)',
    'consent_try_show(uuid,text,integer,integer,integer)',
    'content_rights_import_share(timestamptz)',
    'create_compatible_workflow(jsonb)',
    'create_workspace_with_project(uuid,text,text,text,jsonb,uuid)',
    'decrement_storage(uuid,bigint)',
    'deduct_credits(uuid,integer)',
    'delete_job_with_recast_cleanup(uuid,uuid,boolean)',
    'delete_project_with_recast_cleanup(uuid,uuid)',
    'delete_trashed_job_with_recast_cleanup(uuid,uuid,boolean,timestamptz)',
    'delete_workflow_with_recast_cleanup(uuid,uuid)',
    'expire_topup_credits(uuid)',
    'expunge_app_snapshots(uuid)',
    'find_user_by_sso_subject(text)',
    'generation_session_previews(uuid[])',
    'get_credit_summary()',
    'get_stats(uuid)',
    'get_total_credits(uuid)',
    'grant_deployment_allowance(uuid,integer,uuid,text,text,uuid)',
    'grant_org_credits_idempotent(uuid,integer,text,text,numeric)',
    'grant_topup_credits_idempotent(uuid,integer,text,numeric)',
    'grant_yearly_plan_monthly_credits(uuid,uuid,text,timestamptz,timestamptz,integer)',
    'guard_compatible_workflow_write()',
    'guard_retained_image()',
    'guard_retained_video()',
    'held_storage_keys_among(text[])',
    'hold_restriction_for_court_action()',
    'import_source_policies_version()',
    'increment_daily_spent(uuid,integer)',
    'increment_storage(uuid,bigint)',
    'job_platform_key(text,text)',
    'jobs_execution_owner_check()',
    'jobs_pointer_owner_check()',
    'join_workspace_by_code(text,uuid,text)',
    'jsonb_with_strings_nulled(jsonb,text[])',
    'lift_content_restriction(uuid,uuid,text)',
    'list_trash(uuid,uuid,text,uuid,boolean,text[],timestamptz,text,integer)',
    'llm_side_hold_call_starting(uuid)',
    'log_rights_complaint_update()',
    'mark_job_outputs_cleaned(uuid[],text[])',
    'merge_restriction_bytes(uuid,jsonb)',
    'move_session_items(uuid,uuid,uuid,uuid,uuid[])',
    'org_usage_report(text,uuid,date,date,text,text,uuid,uuid)',
    'org_usage_rows(text,uuid,date,date,text,uuid,uuid,timestamptz,uuid,integer)',
    'org_usage_totals(text,uuid,date,date,text,uuid,uuid)',
    'org_usage_variance(text,uuid,date,date,text,uuid,uuid)',
    'org_usage_window(date,date,text)',
    'personal_space_enabled_for(uuid)',
    'pipeline_entities_asset_owner_check()',
    'pipeline_entity_variants_asset_owner_check()',
    'prepare_external_wallet(uuid,uuid,uuid,text)',
    'preserve_account_infringement()',
    'preserve_account_sanction()',
    'preserve_content_restriction()',
    'preserve_content_rights_authorization()',
    'preserve_content_rights_confirmation()',
    'preserve_held_asset()',
    'preserve_held_job()',
    'preserve_job_submission_context()',
    'preserve_retained_job_image()',
    'preserve_retained_job_video()',
    'preserve_rights_complaint()',
    'preserve_rights_counter_notice()',
    'preserve_rights_event()',
    'process_app_monetization(uuid,uuid,integer,uuid,uuid,integer,integer,integer,uuid)',
    'protect_active_retained_images()',
    'protect_active_retained_videos()',
    'prune_webhook_deliveries(integer,integer)',
    'publish_community_listing(uuid,uuid,text,uuid,text,text,text,text,text,text,text[],text,jsonb,timestamptz,bigint,jsonb)',
    'publish_legacy_recast_rescore(uuid,uuid,uuid,uuid,text,jsonb)',
    'publish_recast_rescore(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)',
    'queue_retained_image_gc()',
    'queue_retained_video_gc()',
    'record_auto_recharge_failure(uuid)',
    'record_clone(uuid,uuid,text,uuid)',
    'record_picker_catalog_gap(text,text,text,text,text,text,uuid)',
    'record_retained_image_copy(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)',
    'record_retained_job_image(uuid,uuid,uuid,uuid,text)',
    'record_retained_job_video(uuid,uuid,uuid,uuid,text)',
    'record_retained_video_copy(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)',
    'record_webhook_delivery_attempt(uuid,integer,text,timestamptz,jsonb,integer,text,integer,text,integer,integer)',
    'refund_credits(uuid)',
    'refund_settled_metered_charge(uuid,uuid)',
    'refund_settled_side_hold(uuid)',
    'refuse_case_close_while_counter_notice_waits()',
    'refuse_content_rights_truncate()',
    'refuse_rights_complaint_event_change()',
    'reinstate_signup_grant(uuid)',
    'remove_creature_asset(uuid,uuid,text,text)',
    'remove_location_asset(uuid,uuid,text,text)',
    'remove_object_asset(uuid,uuid,text,text)',
    'replace_import_source_policies(jsonb,uuid,text)',
    'reserve_credits(uuid,integer,uuid,text,numeric,numeric,boolean,integer,boolean,uuid,uuid,boolean)',
    'reserve_job_credits(uuid,integer,uuid,text,numeric,numeric,boolean,integer,boolean,uuid,uuid,boolean,boolean)',
    'reserve_llm_side_hold(uuid,integer,uuid,text,text,boolean,integer,boolean,uuid,uuid,boolean)',
    'reserve_retained_image(uuid,uuid,text,bigint,integer,integer,text,text)',
    'reserve_retained_video(uuid,uuid,text,bigint,integer,integer,integer,text,text)',
    'reserve_storage_if_within_limit(uuid,bigint)',
    'reset_daily_spent(uuid)',
    'reset_daily_spent_if_needed(uuid)',
    'reset_member_spend(uuid,uuid)',
    'restrict_content(uuid,uuid,text[],text,text,uuid,text,uuid,uuid)',
    'reverse_settled_llm_charge(uuid,uuid,text,text)',
    'revoke_signup_grant(uuid,integer,uuid)',
    'rights_record_person_kept(uuid,uuid)',
    'rotate_webhook_secret(uuid,uuid,text,text,timestamptz)',
    'scene3d_assert_artifact_id_live(uuid,text,text)',
    'scene3d_claim_artifact_gc(integer,interval)',
    'scene3d_complete_artifact_gc(uuid)',
    'scene3d_enqueue_artifact_gc()',
    'scene3d_enqueue_intent_gc()',
    'scene3d_keep_artifact_immutable()',
    'scene3d_keep_delivery_immutable()',
    'scene3d_keep_revision_immutable()',
    'scene3d_publish_delivery(jsonb)',
    'scene3d_publish_refused_delivery(jsonb)',
    'scene3d_publish_revision(jsonb)',
    'scene3d_record_upload_receipt(jsonb)',
    'scene3d_reserve_upload(jsonb)',
    'scene3d_sweep_expired_artifacts(integer)',
    'scene3d_sweep_expired_upload_intents(integer)',
    'scene_node_data_urls(jsonb)',
    'set_deployment_allowance(uuid,integer,uuid,text,text,uuid)',
    'set_member_credit_cap(uuid,uuid,integer)',
    'settle_checkpointed_job_reservation(uuid)',
    'settle_counter_notice_on_lift()',
    'settle_job_reservation(uuid,uuid,uuid,text,integer,text,numeric)',
    'signup_signal_clusters(text,integer,integer)',
    'sso_subjects_for(uuid[])',
    'storage_url_ascii_decode(text)',
    'storage_url_is_foreign(text,uuid)',
    'storage_url_normalize(text)',
    'storage_url_path(text)',
    'storage_url_query_urls(text)',
    'transfer_org_ownership(uuid,uuid,uuid)',
    'update_app_analytics()',
    'upsert_execution_stats(text,text,text,integer,integer)',
    'urls_linked_by_jobs_since(text[],timestamptz[])',
    'usage_log_charge(text,integer,integer)',
    'user_has_held_content(uuid)',
    'webhook_deliveries_job_deleted()',
    'webhook_deliveries_owner_guard()',
    'webhook_endpoints_waiting(uuid,integer)',
    'webhooks_capture_job_event()',
    'webhooks_enforce_cap()',
    'webhooks_record_job_event(uuid,uuid,text,text,text,uuid)',
    'workflow_requires_compatible_writer(jsonb,jsonb)'
  ]::text[] LOOP
    fn := to_regprocedure('public.' || sig);
    IF fn IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    IF sig <> 'webhooks_record_job_event(uuid,uuid,text,text,text,uuid)' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END
$$;

-- Functions that read a NULL auth.uid() as the server, or that only a signed-in
-- user needs. authenticated keeps them; anon does not.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = ANY (ARRAY[
         'access_rank',
         'apply_workflow_delta',
         'check_profiles_update_allowed',
         'check_projects_update_allowed',
         'check_workflows_update_allowed',
         'effective_setting',
         'ensure_default_project',
         'get_admin_stats',
         'get_admin_usage_logs',
         'org_member_status',
         'org_role',
         'org_setting',
         'workflow_access',
         'workspace_member_status',
         'workspace_role',
         'ws_setting_bool'
       ]::name[])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END
$$;

-- Table, column and sequence privileges, in the order the history applied them.
-- A table-level REVOKE also removes the column-level grants of that privilege,
-- so each table's REVOKE comes before its column GRANT. The UPDATE grant on
-- app_runs restates the column list of migration 469 and adds no column; the
-- behavior test above holds that list exactly.
REVOKE ALL ON TABLE public.provider_credentials FROM anon, authenticated;
REVOKE ALL ON TABLE public.recast_audio_bases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recast_audio_bases TO service_role;
REVOKE ALL ON TABLE public.copilot_threads FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.copilot_turns FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.copilot_messages FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.copilot_threads TO authenticated;
GRANT SELECT ON TABLE public.copilot_turns TO authenticated;
GRANT SELECT ON TABLE public.copilot_messages TO authenticated;
GRANT ALL ON TABLE public.copilot_threads TO service_role;
GRANT ALL ON TABLE public.copilot_turns TO service_role;
GRANT ALL ON TABLE public.copilot_messages TO service_role;
REVOKE UPDATE (cover_node_types) ON TABLE public.workflows FROM authenticated, anon;
REVOKE ALL ON TABLE public.copilot_memories FROM PUBLIC, anon;
GRANT SELECT, DELETE ON TABLE public.copilot_memories TO authenticated;
REVOKE ALL ON TABLE public.usage_logs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.usage_logs TO service_role;
REVOKE SELECT ON TABLE public.jobs FROM anon, authenticated;
GRANT SELECT (id, user_id, status, output_data) ON TABLE public.jobs TO authenticated;
REVOKE ALL ON TABLE public.pipelines FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.pipelines TO service_role;
REVOKE ALL ON TABLE public.signup_signals FROM anon, authenticated;
REVOKE ALL ON TABLE public.free_grant_activations FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_consents FROM anon, authenticated;
REVOKE ALL ON TABLE public.job_policy_decisions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.job_policy_decisions TO service_role;
REVOKE ALL ON TABLE public.deployment_payer_settings FROM anon, authenticated;
REVOKE ALL ON TABLE public.deployment_user_allowances FROM anon, authenticated;
GRANT SELECT (user_id, granted_credits, reserved_credits, spent_credits) ON TABLE public.deployment_user_allowances TO authenticated;
REVOKE ALL ON TABLE public.deployment_allowance_grants FROM anon, authenticated;
REVOKE ALL ON TABLE public.deployment_integration_keys FROM anon, authenticated;
REVOKE ALL ON TABLE public.deployment_allowance_pending FROM anon, authenticated;
REVOKE ALL ON public.scene3d_artifacts, public.scene3d_revisions, public.scene3d_revision_artifacts, public.scene3d_artifact_gc, public.scene3d_upload_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scene3d_artifacts, public.scene3d_revisions, public.scene3d_revision_artifacts, public.scene3d_artifact_gc, public.scene3d_upload_intents TO service_role;
REVOKE ALL ON public.scene3d_deliveries, public.scene3d_delivery_artifacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scene3d_deliveries, public.scene3d_delivery_artifacts TO service_role;
REVOKE SELECT (submission_context) ON TABLE public.jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.retained_images FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.retained_images TO service_role;
REVOKE ALL ON TABLE public.retained_image_gc FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.retained_image_gc TO service_role;
REVOKE ALL ON TABLE public.retained_job_images FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.retained_job_images TO service_role;
REVOKE ALL ON TABLE public.retained_image_copies FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.retained_image_copies TO service_role;
REVOKE ALL ON TABLE public.retained_videos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.retained_videos TO service_role;
REVOKE ALL ON TABLE public.retained_video_gc FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.retained_video_gc TO service_role;
REVOKE ALL ON TABLE public.retained_job_videos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.retained_job_videos TO service_role;
REVOKE ALL ON TABLE public.retained_video_copies FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.retained_video_copies TO service_role;
REVOKE ALL ON TABLE public.external_wallet_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.external_wallet_operations TO service_role;
REVOKE ALL ON TABLE public.http_credentials FROM anon, authenticated;
REVOKE ALL ON TABLE public.plugin_account_secrets FROM anon, authenticated;
REVOKE ALL ON TABLE public.saved_posts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.saved_posts TO service_role;
REVOKE ALL ON TABLE public.tracked_competitors FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tracked_competitors TO service_role;
REVOKE ALL ON TABLE public.competitor_scans FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.competitor_scans TO service_role;
REVOKE ALL ON TABLE public.competitor_card_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.competitor_card_actions TO service_role;
REVOKE ALL ON TABLE public.account_blocks FROM anon, authenticated;
REVOKE ALL ON TABLE public.blocked_networks FROM anon, authenticated;
REVOKE ALL ON TABLE public.free_grant_revocations FROM anon, authenticated;
REVOKE ALL ON TABLE public.collections FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.collections TO service_role;
REVOKE ALL ON TABLE public.collection_records FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.collection_records TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.app_runs FROM anon, authenticated;
GRANT UPDATE (input_values, name, hidden_nodes, node_states) ON TABLE public.app_runs TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.jobs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.workflow_executions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.assets FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.locations FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.creatures FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.objects FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.characters FROM anon, authenticated;
REVOKE ALL ON TABLE public.storage_delete_retries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.storage_delete_retries TO service_role;
REVOKE ALL ON TABLE public.quiet_stops FROM anon, authenticated;
REVOKE ALL ON TABLE public.signup_addresses FROM anon, authenticated;
REVOKE ALL ON TABLE public.generation_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.generation_sessions TO service_role;
REVOKE ALL ON TABLE public.session_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.session_items TO service_role;
REVOKE ALL ON TABLE public.job_ratings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.job_ratings TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.gallery_favorites FROM anon, authenticated;
REVOKE ALL ON TABLE public.webhooks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.webhook_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.webhooks TO service_role;
GRANT ALL ON TABLE public.webhook_deliveries TO service_role;
REVOKE ALL ON TABLE public.color_palettes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.color_palettes TO service_role;
REVOKE ALL ON TABLE public.moodboards FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.moodboards TO service_role;
REVOKE INSERT, UPDATE ON TABLE public.node_presets FROM anon, authenticated;
GRANT INSERT (id, user_id, node_type, name, description, data, group_id, tags, sort_order, created_at, updated_at) ON TABLE public.node_presets TO authenticated;
GRANT UPDATE (node_type, name, description, data, group_id, tags, sort_order, updated_at) ON TABLE public.node_presets TO authenticated;
REVOKE ALL ON TABLE public.engine_environments FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.engine_environments TO service_role;
REVOKE ALL ON TABLE public.trends FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.trends TO service_role;
REVOKE ALL ON TABLE public.trend_versions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.trend_versions TO service_role;
REVOKE ALL ON TABLE public.trend_favorites FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.trend_favorites TO service_role;
REVOKE SELECT (llm_billing) ON TABLE public.jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.llm_side_holds FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.llm_side_holds TO service_role;
REVOKE ALL ON TABLE public.trend_tags FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.trend_tags TO service_role;
REVOKE ALL ON TABLE public.lane_plan_sizes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lane_plan_sizes TO service_role;
REVOKE ALL ON TABLE public.lane_user_overrides FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lane_user_overrides TO service_role;
REVOKE ALL ON TABLE public.lane_provider_ceilings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lane_provider_ceilings TO service_role;
REVOKE ALL ON TABLE public.lane_requeue_payloads FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lane_requeue_payloads TO service_role;
REVOKE ALL ON TABLE public.lane_usage_daily FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lane_usage_daily TO service_role;
REVOKE ALL ON TABLE public.lane_provider_daily FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lane_provider_daily TO service_role;
REVOKE ALL ON TABLE public.lane_history_days FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lane_history_days TO service_role;
REVOKE ALL ON TABLE public.trend_radar_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.trend_radar_settings TO service_role;
REVOKE ALL ON TABLE public.trend_radar_sources FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.trend_radar_sources TO service_role;
REVOKE ALL ON TABLE public.trend_radar_candidates FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.trend_radar_candidates TO service_role;
REVOKE ALL ON TABLE public.trend_radar_readings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.trend_radar_readings TO service_role;
REVOKE ALL ON TABLE public.rights_declarations FROM anon, authenticated;
REVOKE ALL ON TABLE public.content_rights_confirmations FROM anon, authenticated;
REVOKE ALL ON TABLE public.rights_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.import_source_policies FROM anon, authenticated;
REVOKE ALL ON TABLE public.content_rights_authorizations FROM anon, authenticated;
REVOKE ALL ON TABLE public.rights_complaints FROM anon, authenticated;
REVOKE ALL ON TABLE public.rights_complaint_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.content_restrictions FROM anon, authenticated;
REVOKE ALL ON TABLE public.rights_counter_notices FROM anon, authenticated;
REVOKE ALL ON TABLE public.account_infringements FROM anon, authenticated;
REVOKE ALL ON TABLE public.account_sanctions FROM anon, authenticated;
REVOKE ALL ON TABLE public.rights_unconfirmed_imports FROM anon, authenticated;
REVOKE ALL ON TABLE public.rights_import_share_start FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.rights_complaints_reference_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.rights_counter_notices_reference_seq FROM anon, authenticated;

-- The browser updates one profiles column. The profiles UPDATE policy's guard
-- names the columns it protects, so the column grant is what limits the rest: a
-- column is not writable from the browser until it is granted here or later.
-- The table REVOKE comes first because it also removes column-level grants.
REVOKE UPDATE ON TABLE public.profiles FROM anon, authenticated;
GRANT UPDATE (last_workspace_id) ON TABLE public.profiles TO authenticated;

-- Bookkeeping tables that migration 558 locks, and that a reverse script may
-- have dropped.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'public.credit_redenomination_state',
    'public.credit_redenomination_snapshot',
    'public.free_grant_backfill_295'
  ] LOOP
    IF to_regclass(t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE %s TO service_role', t);
  END LOOP;
END
$$;
