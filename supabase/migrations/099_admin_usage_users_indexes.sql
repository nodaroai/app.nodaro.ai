-- Migration 099: Indexes & RPC for admin → usage grouping/sorting and admin → users sorting.
--
-- Adds:
--   1. Indexes on usage_logs to support sort by credits/date and group by action/day.
--   2. Indexes on profiles to support sort by tier/role/email/daily_spent/joined/sub/topup/total.
--   3. Generated column profiles.total_credits (subscription + topup) so PostgREST
--      can ORDER BY total without a custom expression.
--   4. RPC get_admin_usage_logs(group_by, sort_by, sort_dir, limit, offset) returning
--      uniform rows for either flat or grouped views.

-- ============================================================
-- 1. usage_logs indexes
-- ============================================================

-- Group by action + sort by date within action.
CREATE INDEX IF NOT EXISTS idx_usage_logs_action_created_at
  ON public.usage_logs (action, created_at DESC);

-- Sort by date alone (admin views, day grouping).
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at
  ON public.usage_logs (created_at DESC);

-- Sort by credits.
CREATE INDEX IF NOT EXISTS idx_usage_logs_credits_used
  ON public.usage_logs (credits_used DESC);

-- ============================================================
-- 2. profiles: total_credits generated column + indexes
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS total_credits INTEGER
  GENERATED ALWAYS AS (
    COALESCE(subscription_credits, 0) + COALESCE(topup_credits, 0)
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_profiles_total_credits
  ON public.profiles (total_credits DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_subscription_credits
  ON public.profiles (subscription_credits DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_topup_credits
  ON public.profiles (topup_credits DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_daily_spent_credits
  ON public.profiles (daily_spent_credits DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_created_at
  ON public.profiles (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_email
  ON public.profiles (email);

-- ============================================================
-- 3. RPC: get_admin_usage_logs
-- ------------------------------------------------------------
-- group_by: one of 'none' | 'user' | 'action' | 'day'
--                 | 'user-action' | 'user-day' | 'action-day'
-- sort_by:  for group_by='none'    -> 'created_at' | 'credits_used'
--           for grouped variants    -> 'credits_used' | 'log_count' | 'created_at'
-- sort_dir: 'asc' | 'desc'
--
-- Returns: stable shape with NULLs for fields not relevant to the grouping.
--   id           - stable React key (uuid for flat, composite for grouped)
--   user_id      - present when grouping includes user
--   user_email   - resolved from profiles, present when user_id is
--   action       - present when grouping includes action, or for flat
--   provider     - flat only
--   day          - present when grouping includes day (truncated to date)
--   credits_used - flat row credits OR sum across the group
--   log_count    - 1 for flat, count(*) for grouped
--   created_at   - flat only (max(created_at) used for default sort on grouped)
--
-- Note: grouped branches aggregate over the entire usage_logs table — Postgres
-- cannot push LIMIT through GROUP BY. If usage_logs grows large this should be
-- extended with an optional `p_after TIMESTAMPTZ` filter so admins can scope
-- to a window (the (action, created_at) and (created_at) indexes would then
-- reduce the scan substantially). Flat (group_by='none') queries are fine —
-- the (created_at DESC) and (credits_used DESC) indexes serve them directly.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_admin_usage_logs(
  p_group_by TEXT DEFAULT 'none',
  p_sort_by  TEXT DEFAULT 'created_at',
  p_sort_dir TEXT DEFAULT 'desc',
  p_limit    INT  DEFAULT 50,
  p_offset   INT  DEFAULT 0
)
RETURNS TABLE (
  id           TEXT,
  user_id      UUID,
  user_email   TEXT,
  action       TEXT,
  provider     TEXT,
  day          DATE,
  credits_used BIGINT,
  log_count    BIGINT,
  created_at   TIMESTAMPTZ
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
      WHEN 'credits_used' THEN 'u.credits_used'
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
              1::bigint,
              u.created_at
         FROM usage_logs u
         LEFT JOIN profiles p ON p.id = u.user_id
        ORDER BY %s %s, u.id ASC
        LIMIT %s OFFSET %s',
      v_order, v_dir, v_lim, v_off
    );

  ELSIF p_group_by = 'user' THEN
    v_order := CASE coalesce(p_sort_by, 'credits_used')
      WHEN 'log_count'    THEN 'COUNT(*)'
      WHEN 'created_at'   THEN 'MAX(u.created_at)'
      ELSE 'SUM(u.credits_used)'
    END;
    v_sql := format(
      'SELECT (''user:'' || u.user_id::text)::text,
              u.user_id,
              p.email::text,
              NULL::text,
              NULL::text,
              NULL::date,
              SUM(u.credits_used)::bigint,
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
    v_order := CASE coalesce(p_sort_by, 'credits_used')
      WHEN 'log_count'    THEN 'COUNT(*)'
      WHEN 'created_at'   THEN 'MAX(u.created_at)'
      ELSE 'SUM(u.credits_used)'
    END;
    v_sql := format(
      'SELECT (''action:'' || u.action)::text,
              NULL::uuid,
              NULL::text,
              u.action,
              NULL::text,
              NULL::date,
              SUM(u.credits_used)::bigint,
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
      WHEN 'log_count'    THEN 'COUNT(*)'
      WHEN 'credits_used' THEN 'SUM(u.credits_used)'
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
              COUNT(*)::bigint,
              MAX(u.created_at)
         FROM usage_logs u
        GROUP BY date_trunc(''day'', u.created_at)
        ORDER BY %s %s NULLS LAST
        LIMIT %s OFFSET %s',
      v_order, v_dir, v_lim, v_off
    );

  ELSIF p_group_by = 'user-action' THEN
    v_order := CASE coalesce(p_sort_by, 'credits_used')
      WHEN 'log_count'    THEN 'COUNT(*)'
      WHEN 'created_at'   THEN 'MAX(u.created_at)'
      ELSE 'SUM(u.credits_used)'
    END;
    v_sql := format(
      'SELECT (''ua:'' || u.user_id::text || '':'' || u.action)::text,
              u.user_id,
              p.email::text,
              u.action,
              NULL::text,
              NULL::date,
              SUM(u.credits_used)::bigint,
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
    v_order := CASE coalesce(p_sort_by, 'credits_used')
      WHEN 'log_count'    THEN 'COUNT(*)'
      WHEN 'created_at'   THEN 'MAX(u.created_at)'
      ELSE 'SUM(u.credits_used)'
    END;
    v_sql := format(
      'SELECT (''ud:'' || u.user_id::text || '':'' || to_char(date_trunc(''day'', u.created_at), ''YYYY-MM-DD''))::text,
              u.user_id,
              p.email::text,
              NULL::text,
              NULL::text,
              date_trunc(''day'', u.created_at)::date,
              SUM(u.credits_used)::bigint,
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
    v_order := CASE coalesce(p_sort_by, 'credits_used')
      WHEN 'log_count'    THEN 'COUNT(*)'
      WHEN 'created_at'   THEN 'MAX(u.created_at)'
      ELSE 'SUM(u.credits_used)'
    END;
    v_sql := format(
      'SELECT (''ad:'' || u.action || '':'' || to_char(date_trunc(''day'', u.created_at), ''YYYY-MM-DD''))::text,
              NULL::uuid,
              NULL::text,
              u.action,
              NULL::text,
              date_trunc(''day'', u.created_at)::date,
              SUM(u.credits_used)::bigint,
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

GRANT EXECUTE ON FUNCTION public.get_admin_usage_logs(TEXT, TEXT, TEXT, INT, INT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_usage_logs(TEXT, TEXT, TEXT, INT, INT) FROM anon;
