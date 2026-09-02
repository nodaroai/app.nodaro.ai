-- Admin review of signup-signal collisions: who shares a machine, a browser
-- profile, or a network.
--
-- WHY A FUNCTION AND NOT A VIEW OR A CLIENT-SIDE GROUP BY. The gate in 365/366
-- counts collisions one account at a time (countSignupSignals). Admin review
-- asks the inverse question — "show me every key that more than one account
-- claimed from" — which is a GROUP BY over the whole table. PostgREST cannot
-- express `GROUP BY ... HAVING count(*) > 1`, and pulling every signal row to
-- the backend to group it in JS is the same table scan with a wire hop.
--
-- SERVICE-ROLE ONLY, for the same reason signup_signals itself is (365 §2):
-- this function is a lookup oracle over other people's devices. Given a key it
-- names the accounts behind it; given nothing it enumerates the clusters. The
-- REVOKEs below are the whole protection — Postgres grants EXECUTE to PUBLIC on
-- every new function and PostgREST publishes public-schema functions at
-- /rest/v1/rpc/, so without them any logged-in user could call it. There is no
-- GRANT back to authenticated, ever. Service role keeps EXECUTE through its own
-- default-privilege grant.
--
-- WHAT THE ROWS MEAN. One row per key with more than one claiming account, on
-- the axis named by p_axis ('device' -> device_key, 'browser' -> browser_key,
-- 'ip' -> ip_hash). An unrecognised axis makes the CASE evaluate to NULL for
-- every row, which the NULL filter removes — zero rows, never an error, so a
-- stale client cannot make this raise.
--
-- source = 'claim' is filtered in the CTE, not merely tolerated: signup_signals
-- is UNIQUE (user_id, source), so restricting to one source makes user_id
-- unique within a group. That is what lets count(*) be an ACCOUNT count and
-- lets the array be capped without lying — member_count stays the true size
-- while user_ids carries only the 25 newest, so a NAT cluster of five hundred
-- accounts cannot turn the caller's hydration into a five-hundred-id URL.
--
-- total_count is count(*) OVER (): window functions run after GROUP BY/HAVING
-- and before LIMIT, so it is the number of clusters on this axis, not the page
-- size. The ORDER BY carries a key tiebreaker — without it two clusters sharing
-- a last_seen_at could swap places between pages and one of them would never be
-- seen.
CREATE OR REPLACE FUNCTION public.signup_signal_clusters(
  p_axis text,
  p_limit integer,
  p_offset integer
)
RETURNS TABLE (
  cluster_key text,
  member_count integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  user_ids uuid[],
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH axis_rows AS (
    SELECT
      CASE p_axis
        WHEN 'device'  THEN s.device_key
        WHEN 'browser' THEN s.browser_key
        WHEN 'ip'      THEN s.ip_hash
      END AS k,
      s.user_id,
      s.created_at
    FROM public.signup_signals AS s
    WHERE s.source = 'claim'
  ),
  clusters AS (
    SELECT
      a.k AS k,
      count(*)::integer AS n_members,
      min(a.created_at) AS first_at,
      max(a.created_at) AS last_at,
      (array_agg(a.user_id ORDER BY a.created_at DESC))[1:25] AS ids
    FROM axis_rows AS a
    WHERE a.k IS NOT NULL AND a.k <> ''
    GROUP BY a.k
    HAVING count(*) > 1
  )
  SELECT
    c.k,
    c.n_members,
    c.first_at,
    c.last_at,
    c.ids,
    count(*) OVER ()
  FROM clusters AS c
  ORDER BY c.last_at DESC, c.k
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE EXECUTE ON FUNCTION public.signup_signal_clusters(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.signup_signal_clusters(text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.signup_signal_clusters(text, integer, integer) FROM authenticated;

-- Supabase's DDL event trigger reloads PostgREST on its own; this is the belt
-- to that suspender, so the new function is callable without waiting for the
-- next reload (366 §7 does the same for the same reason).
NOTIFY pgrst, 'reload schema';
