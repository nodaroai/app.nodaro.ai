-- Admin read access for the two tables the admin Jobs page resolves labels
-- from client-side (the page queries Supabase directly, like its profiles /
-- workflows lookups, which migrations 002/024 already covered):
--
--   * workflow_executions — jobs created inside an execution often carry only
--     workflow_execution_id (workflow_id is null on the orchestrator's
--     per-node rows), so linking the admin table's Workflow column requires
--     resolving execution -> workflow_id.
--   * developer_apps — jobs with source='app' store the developer-app id in
--     source_detail (it is a query key for credit-guard and
--     connected-instances, so the stored value stays an id); showing the
--     app's NAME instead of a raw UUID requires reading the row.
--
-- SELECT only — admins never mutate these tables from the client. Uses the
-- is_admin() SECURITY DEFINER helper (never query profiles from a policy).

DROP POLICY IF EXISTS "Admins can view all workflow executions" ON public.workflow_executions;
CREATE POLICY "Admins can view all workflow executions" ON public.workflow_executions
  FOR SELECT USING (is_admin());

DROP POLICY IF EXISTS "Admins can view all developer apps" ON public.developer_apps;
CREATE POLICY "Admins can view all developer apps" ON public.developer_apps
  FOR SELECT USING (is_admin());
