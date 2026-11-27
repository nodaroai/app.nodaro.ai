-- ============================================================================
-- 731 — the admin Motion price check and the admin Remake faults name, for
-- every Video Remake run, both the size the ENGINE made it at and the size
-- DELIVERED.
--
-- A Video Remake request's `resolution` is now the size delivered: the engine
-- may make the run one size smaller and step it up. Three generations of run
-- rows exist:
--   1. before the step existed: `input_data.resolution` is the engine's size,
--      and the size delivered.
--   2. the earlier step (the request's `upscale: "next"`):
--      `input_data.resolution` is the engine's size; a stepped-up run records
--      the size delivered as `output_data.outputResolution` (absent when it
--      was not stepped up), and its `output_data.resolution` is the engine's
--      size.
--   3. the size delivered asked for: `input_data.resolution` is the size asked
--      (it may be "4k"), `output_data.resolution` the size delivered, and the
--      engine's size the server-only `__castSwapEngineResolution`, on the
--      input and on the output.
-- Engine sizes are 480p, 720p and 1080p; a delivered size may also be "4k".
--
-- 1. `public.admin_remake_engine_resolution(input, output)` — the engine's
--    size: the first string of input `__castSwapEngineResolution`, output
--    `__castSwapEngineResolution`, input `resolution`; it counts only when it
--    is an engine size, else none (so a generation 3 row that misses the
--    hidden key and asked "4k" is no group of its own).
-- 2. `public.admin_remake_delivered_resolution(input, output, status)` — the
--    size delivered:
--      - a completed run: the first valid delivered size of output
--        `outputResolution`, output `resolution` (in that order: on a
--        generation 2 row the output's `resolution` is the engine's size);
--        else the size asked, below.
--      - a run that delivered nothing (failed, queued, processing, cancelled):
--        its output is not read; the size asked, below.
--      - THE SIZE ASKED: the input's `resolution`, when it is a valid
--        delivered size and the input asked no earlier step up (its `upscale`
--        is not "next"); else none. On a generation 1 or 3 row that is what
--        the run was to deliver; a generation 2 row that asked "next" recorded
--        only the engine's size, so what it asked to receive is not known.
-- 3. `public.admin_motion_runs(...)` (593's) — `resolution` is now the
--    engine's size read as above, and `delivered_resolution` is new. Its
--    returned row changes, so it is dropped and created again with its
--    privileges. `admin_motion_run_list` builds its rows from it with
--    `to_jsonb`, so each listed run carries `delivered_resolution` too; its
--    `p_resolution` filter and its totals' 'resolution' rows stay by the
--    engine's size, now read with the fallback above (no backfill).
-- 4. `public.admin_remake_fault_list(...)` (694's) — each row's `resolution`
--    is the engine's size read as above, and `delivered_resolution` is new.
--
-- All server-only: the admin routes call them with the service role
-- (SECURITY INVOKER). Functions only: no table, index or data changes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_remake_engine_resolution(p_input JSONB, p_output JSONB)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE WHEN s.v IN ('480p', '720p', '1080p') THEN s.v END
    FROM (SELECT CASE
                   WHEN jsonb_typeof(p_input->'__castSwapEngineResolution') = 'string' THEN p_input->>'__castSwapEngineResolution'
                   WHEN jsonb_typeof(p_output->'__castSwapEngineResolution') = 'string' THEN p_output->>'__castSwapEngineResolution'
                   WHEN jsonb_typeof(p_input->'resolution') = 'string' THEN p_input->>'resolution'
                 END AS v) AS s
$$;

REVOKE ALL ON FUNCTION public.admin_remake_engine_resolution(JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_remake_engine_resolution(JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.admin_remake_engine_resolution(JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remake_engine_resolution(JSONB, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_remake_delivered_resolution(p_input JSONB, p_output JSONB, p_status TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT coalesce(
           -- A completed run's output: outputResolution first (a generation 2
           -- row's output resolution is the engine's size).
           CASE WHEN p_status IS NOT DISTINCT FROM 'completed' THEN
             coalesce(
               CASE WHEN jsonb_typeof(p_output->'outputResolution') = 'string'
                     AND p_output->>'outputResolution' IN ('480p', '720p', '1080p', '4k')
                    THEN p_output->>'outputResolution' END,
               CASE WHEN jsonb_typeof(p_output->'resolution') = 'string'
                     AND p_output->>'resolution' IN ('480p', '720p', '1080p', '4k')
                    THEN p_output->>'resolution' END)
           END,
           -- The size asked: unknown on a request that asked the earlier step up.
           CASE WHEN p_input->'upscale' IS DISTINCT FROM '"next"'::JSONB
                 AND jsonb_typeof(p_input->'resolution') = 'string'
                 AND p_input->>'resolution' IN ('480p', '720p', '1080p', '4k')
                THEN p_input->>'resolution' END)
$$;

REVOKE ALL ON FUNCTION public.admin_remake_delivered_resolution(JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_remake_delivered_resolution(JSONB, JSONB, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.admin_remake_delivered_resolution(JSONB, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remake_delivered_resolution(JSONB, JSONB, TEXT) TO service_role;

-- 593's body, with the engine's size and the size delivered.
DROP FUNCTION IF EXISTS public.admin_motion_runs(TIMESTAMPTZ, TIMESTAMPTZ, UUID, NUMERIC, JSONB, TEXT[]);

CREATE OR REPLACE FUNCTION public.admin_motion_runs(
  p_from         TIMESTAMPTZ,
  p_to           TIMESTAMPTZ,
  p_run_id       UUID,
  p_credit_usd   NUMERIC,
  p_kie_usd      JSONB  DEFAULT '{}',
  p_local_routes TEXT[] DEFAULT '{}'
)
RETURNS TABLE (
  id UUID, created_at TIMESTAMPTZ, user_id UUID, email TEXT, status TEXT,
  full_quality BOOLEAN, draft_job_id UUID, kind TEXT, trend_name TEXT, engine TEXT, style TEXT,
  resolution TEXT, delivered_resolution TEXT, draft BOOLEAN, length_sec NUMERIC, held BIGINT, taken BIGINT, settled BOOLEAN,
  taken_usd NUMERIC, recorded_usd NUMERIC, kie_usd NUMERIC, paid_usd NUMERIC, margin_usd NUMERIC,
  margin_pct NUMERIC, steps INT, steps_without_cost INT, quote JSONB, quote_total NUMERIC, reuse JSONB,
  extras JSONB, quote_allowed NUMERIC,
  flag_paid_above_taken BOOLEAN, flag_missing_cost BOOLEAN, flag_above_quote BOOLEAN, flagged BOOLEAN
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  -- Two branches, each gated on p_run_id alone, so the gate is checked once
  -- and one run is a primary-key lookup. A trashed run still counts.
  -- admin_motion_task_ids selects a range's runs as the second branch does.
  WITH runs AS MATERIALIZED (
    SELECT r.id, r.created_at, r.user_id, r.status, r.job_type, r.input_data, r.output_data
      FROM public.jobs r
     WHERE p_run_id IS NOT NULL
       AND r.id = p_run_id
       AND r.parent_job_id IS NULL
       AND (r.job_type IN ('cast-swap', 'cast-swap-full-quality')
            OR (r.job_type IS NULL AND r.input_data->>'type' = 'cast-swap'))
    UNION ALL
    SELECT r.id, r.created_at, r.user_id, r.status, r.job_type, r.input_data, r.output_data
      FROM public.jobs r
     WHERE p_run_id IS NULL
       AND r.created_at >= p_from AND r.created_at < p_to
       AND r.parent_job_id IS NULL
       AND (r.job_type IN ('cast-swap', 'cast-swap-full-quality')
            OR (r.job_type IS NULL AND r.input_data->>'type' = 'cast-swap'))
  ),
  tree AS (
    SELECT t.run_id,
           sum(t.held) AS held,
           bool_and(t.log_status IS DISTINCT FROM 'reserved') AS settled,
           bool_or(t.depth = 0 AND t.log_status IS NOT DISTINCT FROM 'reserved') AS own_open,
           sum(t.taken) AS taken,
           sum(t.recorded_usd) AS recorded_usd,
           sum(t.kie_usd) AS kie_usd,
           coalesce(sum(t.paid_usd), 0) AS paid_usd,
           (count(*) FILTER (WHERE t.depth > 0))::INT AS steps,
           (count(*) FILTER (WHERE t.no_cost))::INT AS steps_without_cost
      FROM public.admin_motion_tree(ARRAY(SELECT x.id FROM runs x), p_kie_usd, p_local_routes) AS t
     GROUP BY t.run_id
  )
  SELECT x.id, x.created_at, x.user_id, p.email, x.status,
         fq.full_quality, d.id,
         CASE WHEN jsonb_typeof(x.input_data->'trend') = 'object' THEN 'trend' ELSE 'hand' END,
         CASE WHEN jsonb_typeof(x.input_data->'trend') = 'object' THEN x.input_data->'trend'->>'name' END,
         public.admin_motion_engine(x.input_data),
         public.admin_motion_style(src.input),
         public.admin_remake_engine_resolution(x.input_data, x.output_data),
         public.admin_remake_delivered_resolution(x.input_data, x.output_data, x.status),
         coalesce(x.input_data->'draft' = 'true'::JSONB, false),
         CASE WHEN src.input->'preview' = 'true'::JSONB THEN 4
              WHEN jsonb_typeof(src.input->'sourceDurationSec') = 'number' THEN (src.input->>'sourceDurationSec')::NUMERIC
         END,
         t.held, tk.taken, t.settled, tk.taken_usd, t.recorded_usd, t.kie_usd, t.paid_usd,
         dif.margin_usd,
         CASE WHEN tk.taken_usd > 0 THEN dif.margin_usd / tk.taken_usd * 100 END,
         t.steps, t.steps_without_cost,
         rec.quote, qt.quote_total, rec.reuse, rec.extras, qa.quote_allowed,
         fl.paid_above, fl.missing_cost, fl.above_quote,
         fl.paid_above OR fl.missing_cost OR fl.above_quote
    FROM runs x
    JOIN tree t ON t.run_id = x.id
    LEFT JOIN public.profiles p ON p.id = x.user_id
    CROSS JOIN LATERAL (
      SELECT coalesce(x.job_type = 'cast-swap-full-quality', false)
               OR x.input_data->>'fullQualityOf' IS NOT NULL AS full_quality,
             CASE WHEN x.input_data->>'fullQualityOf' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  THEN (x.input_data->>'fullQualityOf')::UUID END AS draft_ref
    ) AS fq
    LEFT JOIN public.jobs d ON fq.full_quality AND d.id = fq.draft_ref AND d.user_id = x.user_id
    CROSS JOIN LATERAL (
      SELECT CASE WHEN fq.full_quality THEN d.input_data ELSE x.input_data END AS input
    ) AS src
    CROSS JOIN LATERAL (
      SELECT CASE WHEN t.own_open THEN NULL ELSE t.taken END AS taken
    ) AS own
    CROSS JOIN LATERAL (
      SELECT own.taken AS taken, own.taken * p_credit_usd AS taken_usd
    ) AS tk
    CROSS JOIN LATERAL (
      SELECT CASE WHEN t.settled AND tk.taken IS NOT NULL THEN tk.taken_usd - t.paid_usd END AS margin_usd
    ) AS dif
    CROSS JOIN LATERAL (
      SELECT CASE WHEN jsonb_typeof(x.input_data->'__castSwapQuote') = 'object'
                  THEN x.input_data->'__castSwapQuote' END AS quote,
             CASE WHEN jsonb_typeof(x.output_data->'__castSwapReuse') = 'object'
                  THEN x.output_data->'__castSwapReuse' END AS reuse,
             CASE WHEN jsonb_typeof(x.output_data->'__castSwapExtras') = 'object'
                   AND x.output_data->'__castSwapExtras'->'v' = '1'::JSONB
                  THEN x.output_data->'__castSwapExtras' END AS extras
    ) AS rec
    CROSS JOIN LATERAL (
      SELECT CASE WHEN rec.quote->'v' = '1'::JSONB AND jsonb_typeof(rec.quote->'totalCredits') = 'number'
                  THEN (rec.quote->>'totalCredits')::NUMERIC END AS quote_total
    ) AS qt
    CROSS JOIN LATERAL (
      SELECT qt.quote_total
             + CASE WHEN rec.extras->'ran' @> '["privacyCredits"]'::JSONB
                     AND jsonb_typeof(rec.quote->'privacyCredits') = 'number'
                    THEN (rec.quote->>'privacyCredits')::NUMERIC ELSE 0 END
             + CASE WHEN rec.extras->'ran' @> '["referencesRetryCredits"]'::JSONB
                     AND jsonb_typeof(rec.quote->'referencesRetryCredits') = 'number'
                    THEN (rec.quote->>'referencesRetryCredits')::NUMERIC ELSE 0 END AS quote_allowed
    ) AS qa
    -- A run still in flight is never flagged: each flag waits for every hold to settle.
    CROSS JOIN LATERAL (
      SELECT coalesce(t.settled AND tk.taken IS NOT NULL AND t.paid_usd > tk.taken_usd, false) AS paid_above,
             t.settled AND t.steps_without_cost > 0 AS missing_cost,
             coalesce(t.settled AND qa.quote_allowed IS NOT NULL AND tk.taken > qa.quote_allowed, false) AS above_quote
    ) AS fl
   ORDER BY x.created_at DESC, x.id DESC
$$;

REVOKE ALL ON FUNCTION public.admin_motion_runs(TIMESTAMPTZ, TIMESTAMPTZ, UUID, NUMERIC, JSONB, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_motion_runs(TIMESTAMPTZ, TIMESTAMPTZ, UUID, NUMERIC, JSONB, TEXT[]) FROM anon;
REVOKE ALL ON FUNCTION public.admin_motion_runs(TIMESTAMPTZ, TIMESTAMPTZ, UUID, NUMERIC, JSONB, TEXT[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_motion_runs(TIMESTAMPTZ, TIMESTAMPTZ, UUID, NUMERIC, JSONB, TEXT[]) TO service_role;

-- 694's body, with the engine's size and the size delivered.
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
           public.admin_remake_engine_resolution(r.input_data, r.output_data) AS engine_resolution,
           public.admin_remake_delivered_resolution(r.input_data, r.output_data, r.status) AS delivered_resolution,
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
    SELECT x.id, x.created_at, x.user_id, x.status, x.job_type, x.input_data, x.engine_resolution, x.delivered_resolution,
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
                      'resolution', pg.engine_resolution,
                      'delivered_resolution', pg.delivered_resolution,
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
