-- 733 — one function the server asks, once per process, whether the whole
-- routed-video schema (722 to 730) is in place. Those nine files are applied
-- one at a time, each under a short lock timeout, so a chain that stopped
-- part-way is possible, and most of its pieces fail SILENTLY when missing: a
-- trigger that is not attached blocks nothing and repays nothing, and no query
-- errors. This names what is missing so the server can say so and refuse to
-- save a routing policy over it.
--
-- New object only: it changes no existing table and takes no lock a live
-- request can wait behind. It reads the catalog, never a row. Safe to re-run.
CREATE OR REPLACE FUNCTION public.video_route_schema_state()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  missing text[] := '{}';
  t text; c text; f text; pair text[];
BEGIN
  -- 722: the tables and the functions the server calls.
  FOREACH t IN ARRAY ARRAY['video_route_ledger','video_route_debts','video_route_repayments','video_route_deferred_repayments'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN missing := missing || ('table ' || t); END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['reserve_video_route_credits','prepare_video_route_run','commit_video_route_credits','sync_video_route_debt',
    'retry_deferred_video_repayments','repay_external_video_route_debt','video_route_debt_enforced','claim_video_assembly','finish_video_assembly'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = f) THEN
      missing := missing || ('function ' || f);
    END IF;
  END LOOP;
  -- 723: the job's columns and its settlement trigger. 724 to 729: one table's triggers each.
  FOREACH c IN ARRAY ARRAY['video_send_started_at','metadata','video_route_addons_base','video_assembly_recovery'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = to_regclass('public.jobs') AND a.attname = c AND NOT a.attisdropped) THEN
      missing := missing || ('column jobs.' || c);
    END IF;
  END LOOP;
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['jobs','queue_completed_video_settlement'],
    ['usage_logs','block_unpaid_video_reservation'], ['usage_logs','clear_refunded_video_debt'],
    ['topup_grants','recover_video_topup_grant'],
    ['deployment_user_allowances','recover_video_allowance'],
    ['workspace_budgets','recover_video_workspace_allocation'],
    ['workflow_executions','file_recovered_execution_videos'],
    ['assets','file_recovered_video_primary']] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g WHERE g.tgrelid = to_regclass('public.' || pair[1]) AND g.tgname = pair[2] AND NOT g.tgisinternal AND g.tgenabled <> 'D') THEN
      missing := missing || ('trigger ' || pair[2] || ' on ' || pair[1]);
    END IF;
  END LOOP;
  -- 730: the index background assembly claims by.
  IF to_regclass('public.jobs_video_assembly_due_idx') IS NULL THEN missing := missing || 'index jobs_video_assembly_due_idx'::text; END IF;
  RETURN jsonb_build_object('missing', to_jsonb(missing));
END;
$$;
REVOKE ALL ON FUNCTION public.video_route_schema_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_route_schema_state() TO service_role;
