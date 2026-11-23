-- ============================================================================
-- 694 — the admin Remake faults list: every Video Remake run that recorded a
-- fault, newest first, filtered and paged.
--
-- The Video Remake engine records what went wrong (or nearly did) on a run's
-- own row, also on a run that failed, as the server-only
-- `output_data.__castSwapFaults`: a list of
--   { kind: text, severity: 'blocked' | 'recovered' | 'warning', at: ISO text, detail?: object }
-- `kind` is an open vocabulary (blur_left, unblurred_refused, face_check_unsure,
-- face_check_error, intent_override today; `detail.code` names an override's
-- intent).
--
-- `public.admin_remake_fault_list(from, to, severity, kind, engine, offset, limit)`
--    — as one JSON value:
--      - `total`  the runs that match every filter (before paging)
--      - `rows`   the page, newest first (created_at, then id, descending)
--      - `kinds`  the distinct fault kinds of the range's runs (engine
--                 filter applied, severity and kind filters not), sorted: the
--                 page's kind picker
--    A run is a top-level job of type `cast-swap` or `cast-swap-full-quality`
--    (a Full Quality try runs the same engine and records its own faults). A
--    run still queued (no `job_type` yet) has recorded nothing, so it is not
--    read. A trashed run still counts.
--
--    THE ONE READING OF AN ENTRY, used alike by the filters, the count and the
--    chips: a list element that is not an object, or has no non-blank string
--    `kind`, is skipped; a `severity` outside blocked / recovered / warning
--    reads as 'warning' (shown, never hidden); `at` is kept only as a string,
--    `detail` only as an object. A value that is not a list is no fault at
--    all, and a run whose entries are all skipped is not listed.
--
--    Per row: id, created_at, user_id, email (its profile's), job_type,
--    status, full_quality, engine ('prism' / 'pulse', 660's
--    `admin_motion_engine` over the run's own input), resolution, draft,
--    worst (the worst severity), faults (worst first: blocked, recovered,
--    warning; then by `at`, then as recorded).
--
--    Filters, each none when NULL: `p_severity` keeps runs with at least one
--    fault of that severity, `p_kind` runs with at least one fault of that
--    kind (exact), `p_engine` runs on that engine. `p_from` < `p_to` are
--    required. Anything else is refused (SQLSTATE 22023).
--
-- Server-only: the admin route calls it with the service role (SECURITY
-- INVOKER, like 593's functions: the service role reads `jobs` itself). No
-- table or data changes.
--
-- NO INDEX OF ITS OWN: the list reads the existing `idx_jobs_job_type`
-- (the two Remake job types), then keeps the range (at most 31 days, refused
-- beyond), the root jobs and the runs whose `output_data` carries the key.
-- An index on `output_data` would read every row's output (de-TOASTing the
-- large ones) under a SHARE lock that blocks writes to `jobs` while it builds.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_remake_fault_list(
  p_from     TIMESTAMPTZ,
  p_to       TIMESTAMPTZ,
  p_severity TEXT,
  p_kind     TEXT,
  p_engine   TEXT,
  p_offset   INT,
  p_limit    INT
)
RETURNS JSONB
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_out JSONB;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'admin_remake_fault_list: p_from must be before p_to, not % – %',
      coalesce(p_from::TEXT, 'null'), coalesce(p_to::TEXT, 'null') USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_to - p_from > INTERVAL '31 days' THEN
    RAISE EXCEPTION 'admin_remake_fault_list: the range may span at most 31 days'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_severity IS NOT NULL AND p_severity NOT IN ('blocked', 'recovered', 'warning') THEN
    RAISE EXCEPTION 'admin_remake_fault_list: p_severity must be blocked, recovered or warning, not %',
      p_severity USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_kind IS NOT NULL AND (btrim(p_kind) = '' OR length(p_kind) > 120) THEN
    RAISE EXCEPTION 'admin_remake_fault_list: p_kind must be 1 to 120 characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_engine IS NOT NULL AND p_engine NOT IN ('prism', 'pulse') THEN
    RAISE EXCEPTION 'admin_remake_fault_list: p_engine must be prism or pulse, not %',
      p_engine USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'admin_remake_fault_list: p_limit must be 1 to 200, not %',
      coalesce(p_limit::TEXT, 'null') USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'admin_remake_fault_list: p_offset must be 0 or more, not %',
      coalesce(p_offset::TEXT, 'null') USING ERRCODE = 'invalid_parameter_value';
  END IF;

  WITH runs AS MATERIALIZED (
    -- Read through idx_jobs_job_type (the run's job type), then narrowed to
    -- the range, the root jobs and the runs that recorded faults. No index of
    -- its own: the range is at most 31 days of one job type.
    SELECT r.id, r.created_at, r.user_id, r.status, r.job_type, r.input_data,
           -- A value that is not a list is no fault (jsonb_array_elements would raise on it).
           CASE WHEN jsonb_typeof(r.output_data->'__castSwapFaults') = 'array'
                THEN r.output_data->'__castSwapFaults' ELSE '[]'::JSONB END AS raw
      FROM public.jobs r
     WHERE r.job_type IN ('cast-swap', 'cast-swap-full-quality')
       AND r.created_at >= p_from AND r.created_at < p_to
       AND r.parent_job_id IS NULL
       AND r.output_data ? '__castSwapFaults'
  ),
  faults AS (
    SELECT x.id, e.ord, e.v->>'kind' AS kind, sev.severity,
           CASE sev.severity WHEN 'blocked' THEN 0 WHEN 'recovered' THEN 1 ELSE 2 END AS rank,
           CASE WHEN jsonb_typeof(e.v->'at') = 'string' THEN e.v->>'at' END AS at,
           CASE WHEN jsonb_typeof(e.v->'detail') = 'object' THEN e.v->'detail' END AS detail
      FROM runs x
      CROSS JOIN LATERAL jsonb_array_elements(x.raw) WITH ORDINALITY AS e(v, ord)
      CROSS JOIN LATERAL (
        SELECT CASE WHEN jsonb_typeof(e.v->'severity') = 'string' AND e.v->>'severity' IN ('blocked', 'recovered')
                    THEN e.v->>'severity' ELSE 'warning' END AS severity
      ) AS sev
     WHERE jsonb_typeof(e.v) = 'object'
       AND jsonb_typeof(e.v->'kind') = 'string'
       AND btrim(e.v->>'kind') <> ''
  ),
  per_run AS (
    SELECT f.id,
           min(f.rank) AS worst_rank,
           -- `at` and `detail` only when there (a detail's own nulls kept as recorded).
           jsonb_agg(jsonb_build_object('kind', f.kind, 'severity', f.severity)
                     || CASE WHEN f.at IS NOT NULL THEN jsonb_build_object('at', f.at) ELSE '{}'::JSONB END
                     || CASE WHEN f.detail IS NOT NULL THEN jsonb_build_object('detail', f.detail) ELSE '{}'::JSONB END
                     ORDER BY f.rank, f.at NULLS LAST, f.ord) AS faults,
           array_agg(DISTINCT f.kind) AS kinds,
           array_agg(DISTINCT f.severity) AS severities
      FROM faults f
     GROUP BY f.id
  ),
  listed AS (
    SELECT x.id, x.created_at, x.user_id, x.status, x.job_type, x.input_data,
           public.admin_motion_engine(x.input_data) AS engine,
           pr.worst_rank, pr.faults, pr.kinds, pr.severities
      FROM runs x
      JOIN per_run pr ON pr.id = x.id
     WHERE p_engine IS NULL OR public.admin_motion_engine(x.input_data) = p_engine
  ),
  filtered AS (
    SELECT l.*
      FROM listed l
     WHERE (p_severity IS NULL OR p_severity = ANY (l.severities))
       AND (p_kind IS NULL OR p_kind = ANY (l.kinds))
  ),
  page AS (
    SELECT f.*
      FROM filtered f
     ORDER BY f.created_at DESC, f.id DESC
    OFFSET p_offset
     LIMIT p_limit
  )
  SELECT jsonb_build_object(
           'total', (SELECT count(*) FROM filtered),
           'rows', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'id', pg.id,
                      'created_at', pg.created_at,
                      'user_id', pg.user_id,
                      'email', p.email,
                      'job_type', pg.job_type,
                      'status', pg.status,
                      'full_quality', coalesce(pg.job_type = 'cast-swap-full-quality', false)
                                        OR pg.input_data->>'fullQualityOf' IS NOT NULL,
                      'engine', pg.engine,
                      'resolution', CASE WHEN jsonb_typeof(pg.input_data->'resolution') = 'string'
                                         THEN pg.input_data->>'resolution' END,
                      'draft', coalesce(pg.input_data->'draft' = 'true'::JSONB, false),
                      'worst', CASE pg.worst_rank WHEN 0 THEN 'blocked' WHEN 1 THEN 'recovered' ELSE 'warning' END,
                      'faults', pg.faults)
                    ORDER BY pg.created_at DESC, pg.id DESC)
               FROM page pg
               LEFT JOIN public.profiles p ON p.id = pg.user_id
           ), '[]'::JSONB),
           'kinds', coalesce((
             SELECT jsonb_agg(k.kind ORDER BY k.kind)
               FROM (SELECT DISTINCT unnest(l.kinds) AS kind FROM listed l) AS k
           ), '[]'::JSONB))
    INTO v_out;
  RETURN v_out;
END
$$;

REVOKE ALL ON FUNCTION public.admin_remake_fault_list(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_remake_fault_list(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, INT) FROM anon;
REVOKE ALL ON FUNCTION public.admin_remake_fault_list(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remake_fault_list(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, INT) TO service_role;
