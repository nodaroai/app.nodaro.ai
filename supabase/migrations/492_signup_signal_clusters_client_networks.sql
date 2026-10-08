-- The network axis of signup_signal_clusters counts REAL client networks only.
--
-- 373 grouped the 'ip' axis on ip_hash for every claim row. Until the backend
-- read the real client address (#1827, 2026-10-05), ip_hash held the hash of
-- a hosting edge proxy — about twenty addresses shared by every user of the
-- platform — and an unknown address hashes to a constant. Grouped as networks,
-- those rows put unrelated accounts into giant "clusters": the admin Users
-- page showed sixty-nine strangers under one number.
--
-- 458 marks a row whose ip_hash is a real client network with
-- ip_scheme = 'client' (and only such a row may become a network block). The
-- same marker decides the network axis here: a row without it has no network
-- key, so it can neither form a network cluster nor join one. The device and
-- browser axes were never affected — those keys do not depend on the proxy.
--
-- Everything else is 373 verbatim: SECURITY DEFINER with a pinned search_path,
-- EXECUTE revoked from every client role (CREATE OR REPLACE keeps the ACL, the
-- REVOKEs below are the belt to that suspender), the page clamps, the 25-id cap
-- with the true member_count, count(*) OVER () as total_count.
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
        WHEN 'ip'      THEN CASE WHEN s.ip_scheme = 'client' THEN s.ip_hash END
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

NOTIFY pgrst, 'reload schema';
