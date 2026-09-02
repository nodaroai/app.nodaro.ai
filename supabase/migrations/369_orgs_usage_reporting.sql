-- 369: usage reporting for organizations (E2/P15).
-- Three service-role-only reporting functions over usage_logs (346: browser-
-- unreadable) and credit_transactions, plus the one index the variance line
-- needs, plus a shared window helper. Nothing here mutates. Every refusal is a
-- stable RAISE prefix the plugin route maps to 400 (INVALID_TIMEZONE,
-- RANGE_TOO_LARGE, BAD_SCOPE, BAD_GROUP_BY). Money columns (cost_usd) are never
-- returned. All four functions are STABLE (read-only) and service_role only.

-- 1. The variance line's index: org_usage_variance rows keyed by org, workspace, time.
CREATE INDEX IF NOT EXISTS idx_credit_tx_variance_org_created
  ON credit_transactions (org_id, workspace_id, created_at DESC)
  WHERE source = 'org_usage_variance';

-- 2. Window helper: [from 00:00 tz, to+1 00:00 tz). STABLE (read-only), never
--    IMMUTABLE (AT TIME ZONE depends on the session's tz database). Raises
--    INVALID_TIMEZONE: / RANGE_TOO_LARGE:. Private to the reporting functions but
--    a definer like them so the grants test classifies it. No table read, no pragma.
CREATE OR REPLACE FUNCTION public.org_usage_window(p_from DATE, p_to DATE, p_tz TEXT)
RETURNS TABLE (win_start TIMESTAMPTZ, win_end TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_start TIMESTAMPTZ; v_end TIMESTAMPTZ;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN RAISE EXCEPTION 'RANGE_TOO_LARGE: from and to are required'; END IF;
  IF p_to < p_from THEN RAISE EXCEPTION 'RANGE_TOO_LARGE: to precedes from'; END IF;
  IF (p_to - p_from) >= 366 THEN RAISE EXCEPTION 'RANGE_TOO_LARGE: range exceeds 366 days'; END IF;
  BEGIN
    v_start := (p_from::timestamp) AT TIME ZONE COALESCE(p_tz, 'UTC');
    v_end   := ((p_to + 1)::timestamp) AT TIME ZONE COALESCE(p_tz, 'UTC');
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE EXCEPTION 'INVALID_TIMEZONE: % is not a known time zone', p_tz;
  END;
  RETURN QUERY SELECT v_start, v_end;
END $$;

-- 3. Grouped report. p_scope 'org' | 'workspace'; p_scope_id the org or workspace id;
--    p_group_by 'workspace' (org scope only) | 'member' | 'model' | 'day';
--    p_user_id narrows to one runner (the member self-view); p_workspace_id narrows
--    an org report to one workspace. Capped at 5001 rows (the route reports
--    truncated=true when 5001 come back). Reads usage_logs -> pragma use_column.
CREATE OR REPLACE FUNCTION public.org_usage_report(
  p_scope TEXT, p_scope_id UUID, p_from DATE, p_to DATE, p_tz TEXT, p_group_by TEXT,
  p_workspace_id UUID DEFAULT NULL, p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
  group_key TEXT, workspace_id UUID, user_id UUID, model TEXT, day DATE,
  run_count BIGINT, credits BIGINT, settled_credits BIGINT, in_flight_credits BIGINT,
  in_flight_runs BIGINT, app_run_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_start TIMESTAMPTZ; v_end TIMESTAMPTZ; v_tz TEXT := COALESCE(p_tz, 'UTC');
BEGIN
  IF p_scope NOT IN ('org', 'workspace') THEN RAISE EXCEPTION 'BAD_SCOPE: %', p_scope; END IF;
  IF p_group_by NOT IN ('workspace', 'member', 'model', 'day') THEN RAISE EXCEPTION 'BAD_GROUP_BY: %', p_group_by; END IF;
  IF p_group_by = 'workspace' AND p_scope <> 'org' THEN RAISE EXCEPTION 'BAD_GROUP_BY: workspace grouping is org-scoped'; END IF;
  SELECT w.win_start, w.win_end INTO v_start, v_end FROM org_usage_window(p_from, p_to, v_tz) w;

  RETURN QUERY
  SELECT
    CASE p_group_by
      WHEN 'workspace' THEN s.ws::text WHEN 'member' THEN s.runner::text
      WHEN 'model' THEN s.model_id WHEN 'day' THEN s.bucket::text END AS group_key,
    CASE WHEN p_group_by = 'workspace' THEN s.ws END,
    CASE WHEN p_group_by = 'member' THEN s.runner END,
    CASE WHEN p_group_by = 'model' THEN s.model_id END,
    CASE WHEN p_group_by = 'day' THEN s.bucket END,
    count(*)::bigint,
    sum(COALESCE(s.charged, s.used))::bigint,
    sum(CASE WHEN s.st = 'committed' THEN COALESCE(s.charged, s.used) ELSE 0 END)::bigint,
    sum(CASE WHEN s.st = 'reserved' THEN s.used ELSE 0 END)::bigint,
    count(*) FILTER (WHERE s.st = 'reserved')::bigint,
    count(*) FILTER (WHERE s.is_app)::bigint
  FROM (
    SELECT u.workspace_id AS ws, u.user_id AS runner,
           COALESCE(u.metadata->>'model', u.action) AS model_id,
           (u.created_at AT TIME ZONE v_tz)::date AS bucket,
           u.status AS st, u.credits_used AS used, u.credits_charged AS charged,
           COALESCE((u.metadata->>'is_app_run')::boolean, false) AS is_app
    FROM usage_logs u
    WHERE u.status <> 'refunded'
      AND u.created_at >= v_start AND u.created_at < v_end
      AND ((p_scope = 'org' AND u.org_id = p_scope_id) OR (p_scope = 'workspace' AND u.workspace_id = p_scope_id))
      AND (p_workspace_id IS NULL OR u.workspace_id = p_workspace_id)
      AND (p_user_id IS NULL OR u.user_id = p_user_id)
  ) s
  GROUP BY 1, 2, 3, 4, 5
  ORDER BY 7 DESC, 1 ASC
  LIMIT 5001;
END $$;

-- 4. Flat rows, keyset-paged newest first on (created_at DESC, id DESC).
--    Reads usage_logs -> pragma use_column.
CREATE OR REPLACE FUNCTION public.org_usage_rows(
  p_scope TEXT, p_scope_id UUID, p_from DATE, p_to DATE, p_tz TEXT,
  p_workspace_id UUID DEFAULT NULL, p_user_id UUID DEFAULT NULL,
  p_after_created TIMESTAMPTZ DEFAULT NULL, p_after_id UUID DEFAULT NULL, p_limit INT DEFAULT 50)
RETURNS TABLE (
  id UUID, created_at TIMESTAMPTZ, workspace_id UUID, user_id UUID, job_id UUID,
  model TEXT, status TEXT, credits_reserved INTEGER, credits_settled INTEGER, credits INTEGER, is_app_run BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_start TIMESTAMPTZ; v_end TIMESTAMPTZ; v_lim INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 1000);
BEGIN
  IF p_scope NOT IN ('org', 'workspace') THEN RAISE EXCEPTION 'BAD_SCOPE: %', p_scope; END IF;
  SELECT w.win_start, w.win_end INTO v_start, v_end FROM org_usage_window(p_from, p_to, COALESCE(p_tz, 'UTC')) w;
  RETURN QUERY
  SELECT u.id, u.created_at, u.workspace_id, u.user_id, u.job_id,
         COALESCE(u.metadata->>'model', u.action), u.status, u.credits_used, u.credits_charged,
         COALESCE(u.credits_charged, u.credits_used),
         COALESCE((u.metadata->>'is_app_run')::boolean, false)
  FROM usage_logs u
  WHERE u.status <> 'refunded'
    AND u.created_at >= v_start AND u.created_at < v_end
    AND ((p_scope = 'org' AND u.org_id = p_scope_id) OR (p_scope = 'workspace' AND u.workspace_id = p_scope_id))
    AND (p_workspace_id IS NULL OR u.workspace_id = p_workspace_id)
    AND (p_user_id IS NULL OR u.user_id = p_user_id)
    AND (p_after_created IS NULL OR u.created_at < p_after_created
         OR (u.created_at = p_after_created AND p_after_id IS NOT NULL AND u.id < p_after_id))
  ORDER BY u.created_at DESC, u.id DESC
  LIMIT v_lim;
END $$;

-- 5. The platform-absorbed line: org_usage_variance credits per workspace in the window.
--    Reads credit_transactions; every reference is alias-qualified (t.*) so no pragma
--    is required (the two usage_logs readers above carry the defensive pragma).
CREATE OR REPLACE FUNCTION public.org_usage_variance(
  p_scope TEXT, p_scope_id UUID, p_from DATE, p_to DATE, p_tz TEXT, p_workspace_id UUID DEFAULT NULL)
RETURNS TABLE (workspace_id UUID, credits BIGINT, row_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_start TIMESTAMPTZ; v_end TIMESTAMPTZ;
BEGIN
  IF p_scope NOT IN ('org', 'workspace') THEN RAISE EXCEPTION 'BAD_SCOPE: %', p_scope; END IF;
  SELECT w.win_start, w.win_end INTO v_start, v_end FROM org_usage_window(p_from, p_to, COALESCE(p_tz, 'UTC')) w;
  RETURN QUERY
  SELECT t.workspace_id, sum(t.amount)::bigint, count(*)::bigint
  FROM credit_transactions t
  WHERE t.source = 'org_usage_variance'
    AND t.created_at >= v_start AND t.created_at < v_end
    AND ((p_scope = 'org' AND t.org_id = p_scope_id) OR (p_scope = 'workspace' AND t.workspace_id = p_scope_id))
    AND (p_workspace_id IS NULL OR t.workspace_id = p_workspace_id)
  GROUP BY t.workspace_id;
END $$;

-- 6. Grants: service_role only, every function (the plugin calls them with tk.db;
--    a browser must not). Types spelled exactly as the headers so the grants test's
--    signature builder matches.
REVOKE EXECUTE ON FUNCTION public.org_usage_window(DATE, DATE, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.org_usage_window(DATE, DATE, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.org_usage_window(DATE, DATE, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.org_usage_window(DATE, DATE, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.org_usage_report(TEXT, UUID, DATE, DATE, TEXT, TEXT, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.org_usage_report(TEXT, UUID, DATE, DATE, TEXT, TEXT, UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.org_usage_report(TEXT, UUID, DATE, DATE, TEXT, TEXT, UUID, UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.org_usage_report(TEXT, UUID, DATE, DATE, TEXT, TEXT, UUID, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.org_usage_rows(TEXT, UUID, DATE, DATE, TEXT, UUID, UUID, TIMESTAMPTZ, UUID, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.org_usage_rows(TEXT, UUID, DATE, DATE, TEXT, UUID, UUID, TIMESTAMPTZ, UUID, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.org_usage_rows(TEXT, UUID, DATE, DATE, TEXT, UUID, UUID, TIMESTAMPTZ, UUID, INT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.org_usage_rows(TEXT, UUID, DATE, DATE, TEXT, UUID, UUID, TIMESTAMPTZ, UUID, INT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.org_usage_variance(TEXT, UUID, DATE, DATE, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.org_usage_variance(TEXT, UUID, DATE, DATE, TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.org_usage_variance(TEXT, UUID, DATE, DATE, TEXT, UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.org_usage_variance(TEXT, UUID, DATE, DATE, TEXT, UUID) TO service_role;
