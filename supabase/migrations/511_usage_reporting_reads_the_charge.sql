-- ============================================================================
-- Usage reporting reads the CHARGE, not the hold.
--
-- `usage_logs.credits_used` is the amount RESERVED when a run is accepted and
-- never changes. Settlement may charge less (a re-render ceiling, a measured
-- length, a metered run): `commit_credits` gives the rest back and records the
-- charge in `credits_charged`; a refund gives back everything. The admin usage
-- page summed `credits_used` over every row, refunded holds included, so it
-- reported holds as spend.
--
-- 1. `public.usage_log_charge` — the SQL twin of `usageAmount`
--    (backend/src/lib/usage-amount.ts): the charge once settled, the hold while
--    it is still open, 0 once refunded. Both are pinned to one case table,
--    supabase/tests/fixtures/usage-charge-cases.json
--    (supabase/tests/usage-charge.behavior.sql and the TS unit test).
-- 2. `get_admin_usage_logs` gains `credits_charged` (the sum of that charge)
--    beside `credits_used` (the sum of holds, unchanged), and sorts on either.
--    Grouped views sort by the charge by default. Adding an output column
--    changes the return type, so the function is dropped and created again with
--    its grants restored (099: authenticated may execute, anon may not; the
--    is_admin() gate inside is unchanged).
--
-- Reporting only: no balance, reservation or settlement moves.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.usage_log_charge(
  p_status TEXT, p_credits_used INTEGER, p_credits_charged INTEGER
) RETURNS INTEGER
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_status = 'refunded'  THEN 0
    WHEN p_status = 'committed' THEN coalesce(p_credits_charged, p_credits_used)
    ELSE p_credits_used
  END
$$;

REVOKE ALL ON FUNCTION public.usage_log_charge(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.usage_log_charge(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.usage_log_charge(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.usage_log_charge(TEXT, INTEGER, INTEGER) TO service_role;

DROP FUNCTION IF EXISTS public.get_admin_usage_logs(TEXT, TEXT, TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.get_admin_usage_logs(
  p_group_by TEXT DEFAULT 'none',
  p_sort_by  TEXT DEFAULT 'created_at',
  p_sort_dir TEXT DEFAULT 'desc',
  p_limit    INT  DEFAULT 50,
  p_offset   INT  DEFAULT 0
)
RETURNS TABLE (
  id              TEXT,
  user_id         UUID,
  user_email      TEXT,
  action          TEXT,
  provider        TEXT,
  day             DATE,
  credits_used    BIGINT,
  credits_charged BIGINT,
  log_count       BIGINT,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dir   TEXT;
  v_lim   INT;
  v_off   INT;
  v_order TEXT;
  v_sql   TEXT;
BEGIN
  -- Admin gate: same as get_admin_stats
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  v_dir := CASE WHEN lower(coalesce(p_sort_dir, 'desc')) = 'asc' THEN 'ASC' ELSE 'DESC' END;
  v_lim := LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
  v_off := GREATEST(coalesce(p_offset, 0), 0);

  IF coalesce(p_group_by, 'none') = 'none' THEN
    v_order := CASE coalesce(p_sort_by, 'created_at')
      WHEN 'credits_used'    THEN 'u.credits_used'
      WHEN 'credits_charged' THEN 'public.usage_log_charge(u.status, u.credits_used, u.credits_charged)'
      ELSE 'u.created_at'
    END;
    -- Tie-break on id ASC (UUIDs are random — direction doesn't matter for
    -- ordering, but stable across pages requires a fixed direction).
    v_sql := format(
      'SELECT u.id::text,
              u.user_id,
              p.email::text,
              u.action,
              u.provider,
              NULL::date,
              u.credits_used::bigint,
              public.usage_log_charge(u.status, u.credits_used, u.credits_charged)::bigint,
              1::bigint,
              u.created_at
         FROM usage_logs u
         LEFT JOIN profiles p ON p.id = u.user_id
        ORDER BY %s %s, u.id ASC
        LIMIT %s OFFSET %s',
      v_order, v_dir, v_lim, v_off
    );

  ELSIF p_group_by = 'user' THEN
    v_order := CASE coalesce(p_sort_by, 'credits_charged')
      WHEN 'log_count'    THEN 'COUNT(*)'
      WHEN 'created_at'   THEN 'MAX(u.created_at)'
      WHEN 'credits_used' THEN 'SUM(u.credits_used)'
      ELSE 'SUM(public.usage_log_charge(u.status, u.credits_used, u.credits_charged))'
    END;
    v_sql := format(
      'SELECT (''user:'' || u.user_id::text)::text,
              u.user_id,
              p.email::text,
              NULL::text,
              NULL::text,
              NULL::date,
              SUM(u.credits_used)::bigint,
              SUM(public.usage_log_charge(u.status, u.credits_used, u.credits_charged))::bigint,
              COUNT(*)::bigint,
              MAX(u.created_at)
         FROM usage_logs u
         LEFT JOIN profiles p ON p.id = u.user_id
        GROUP BY u.user_id, p.email
        ORDER BY %s %s NULLS LAST
        LIMIT %s OFFSET %s',
      v_order, v_dir, v_lim, v_off
    );

  ELSIF p_group_by = 'action' THEN
    v_order := CASE coalesce(p_sort_by, 'credits_charged')
      WHEN 'log_count'    THEN 'COUNT(*)'
      WHEN 'created_at'   THEN 'MAX(u.created_at)'
      WHEN 'credits_used' THEN 'SUM(u.credits_used)'
      ELSE 'SUM(public.usage_log_charge(u.status, u.credits_used, u.credits_charged))'
    END;
    v_sql := format(
      'SELECT (''action:'' || u.action)::text,
              NULL::uuid,
              NULL::text,
              u.action,
              NULL::text,
              NULL::date,
              SUM(u.credits_used)::bigint,
              SUM(public.usage_log_charge(u.status, u.credits_used, u.credits_charged))::bigint,
              COUNT(*)::bigint,
              MAX(u.created_at)
         FROM usage_logs u
        GROUP BY u.action
        ORDER BY %s %s NULLS LAST
        LIMIT %s OFFSET %s',
      v_order, v_dir, v_lim, v_off
    );

  ELSIF p_group_by = 'day' THEN
    v_order := CASE coalesce(p_sort_by, 'created_at')
      WHEN 'log_count'       THEN 'COUNT(*)'
      WHEN 'credits_used'    THEN 'SUM(u.credits_used)'
      WHEN 'credits_charged' THEN 'SUM(public.usage_log_charge(u.status, u.credits_used, u.credits_charged))'
      ELSE 'date_trunc(''day'', u.created_at)'
    END;
    v_sql := format(
      'SELECT (''day:'' || to_char(date_trunc(''day'', u.created_at), ''YYYY-MM-DD''))::text,
              NULL::uuid,
              NULL::text,
              NULL::text,
              NULL::text,
              date_trunc(''day'', u.created_at)::date,
              SUM(u.credits_used)::bigint,
              SUM(public.usage_log_charge(u.status, u.credits_used, u.credits_charged))::bigint,
              COUNT(*)::bigint,
              MAX(u.created_at)
         FROM usage_logs u
        GROUP BY date_trunc(''day'', u.created_at)
        ORDER BY %s %s NULLS LAST
        LIMIT %s OFFSET %s',
      v_order, v_dir, v_lim, v_off
    );

  ELSIF p_group_by = 'user-action' THEN
    v_order := CASE coalesce(p_sort_by, 'credits_charged')
      WHEN 'log_count'    THEN 'COUNT(*)'
      WHEN 'created_at'   THEN 'MAX(u.created_at)'
      WHEN 'credits_used' THEN 'SUM(u.credits_used)'
      ELSE 'SUM(public.usage_log_charge(u.status, u.credits_used, u.credits_charged))'
    END;
    v_sql := format(
      'SELECT (''ua:'' || u.user_id::text || '':'' || u.action)::text,
              u.user_id,
              p.email::text,
              u.action,
              NULL::text,
              NULL::date,
              SUM(u.credits_used)::bigint,
              SUM(public.usage_log_charge(u.status, u.credits_used, u.credits_charged))::bigint,
              COUNT(*)::bigint,
              MAX(u.created_at)
         FROM usage_logs u
         LEFT JOIN profiles p ON p.id = u.user_id
        GROUP BY u.user_id, u.action, p.email
        ORDER BY %s %s NULLS LAST
        LIMIT %s OFFSET %s',
      v_order, v_dir, v_lim, v_off
    );

  ELSIF p_group_by = 'user-day' THEN
    v_order := CASE coalesce(p_sort_by, 'credits_charged')
      WHEN 'log_count'    THEN 'COUNT(*)'
      WHEN 'created_at'   THEN 'MAX(u.created_at)'
      WHEN 'credits_used' THEN 'SUM(u.credits_used)'
      ELSE 'SUM(public.usage_log_charge(u.status, u.credits_used, u.credits_charged))'
    END;
    v_sql := format(
      'SELECT (''ud:'' || u.user_id::text || '':'' || to_char(date_trunc(''day'', u.created_at), ''YYYY-MM-DD''))::text,
              u.user_id,
              p.email::text,
              NULL::text,
              NULL::text,
              date_trunc(''day'', u.created_at)::date,
              SUM(u.credits_used)::bigint,
              SUM(public.usage_log_charge(u.status, u.credits_used, u.credits_charged))::bigint,
              COUNT(*)::bigint,
              MAX(u.created_at)
         FROM usage_logs u
         LEFT JOIN profiles p ON p.id = u.user_id
        GROUP BY u.user_id, p.email, date_trunc(''day'', u.created_at)
        ORDER BY %s %s NULLS LAST
        LIMIT %s OFFSET %s',
      v_order, v_dir, v_lim, v_off
    );

  ELSIF p_group_by = 'action-day' THEN
    v_order := CASE coalesce(p_sort_by, 'credits_charged')
      WHEN 'log_count'    THEN 'COUNT(*)'
      WHEN 'created_at'   THEN 'MAX(u.created_at)'
      WHEN 'credits_used' THEN 'SUM(u.credits_used)'
      ELSE 'SUM(public.usage_log_charge(u.status, u.credits_used, u.credits_charged))'
    END;
    v_sql := format(
      'SELECT (''ad:'' || u.action || '':'' || to_char(date_trunc(''day'', u.created_at), ''YYYY-MM-DD''))::text,
              NULL::uuid,
              NULL::text,
              u.action,
              NULL::text,
              date_trunc(''day'', u.created_at)::date,
              SUM(u.credits_used)::bigint,
              SUM(public.usage_log_charge(u.status, u.credits_used, u.credits_charged))::bigint,
              COUNT(*)::bigint,
              MAX(u.created_at)
         FROM usage_logs u
        GROUP BY u.action, date_trunc(''day'', u.created_at)
        ORDER BY %s %s NULLS LAST
        LIMIT %s OFFSET %s',
      v_order, v_dir, v_lim, v_off
    );

  ELSE
    RAISE EXCEPTION 'Invalid group_by: %', p_group_by;
  END IF;

  RETURN QUERY EXECUTE v_sql;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_usage_logs(TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_usage_logs(TEXT, TEXT, TEXT, INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_usage_logs(TEXT, TEXT, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_usage_logs(TEXT, TEXT, TEXT, INT, INT) TO service_role;
