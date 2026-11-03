-- ============================================================================
-- The admin Motion price check: every Nodaro Motion run's figures over a range.
--
-- A Nodaro Motion run (a hand run, a trend run, each Full Quality try) is one
-- paid action made of many steps: the jobs below it by `parent_job_id`, each
-- holding and settling its own credits and recording what its provider cost.
-- These functions work out, for every run of a date range and before any
-- paging, what was held, what was taken from the person, that in USD, and what
-- the steps cost us, with the flags the admin page filters and sorts by.
--
-- Nothing here holds a price. The USD value of one credit arrives as a
-- parameter (`p_credit_usd`), a run's base hold is read from `jobs.credits`,
-- and KIE's own figures for its tasks arrive from the caller as a map of
-- task id to USD (`p_kie_usd`). The steps that run on our own machines arrive
-- as a list of routes (`p_local_routes`).
--
-- 1. `public.admin_motion_engine(input)` — 'pulse' for an input whose
--    `engine` is `motion-pulse`, `motion-lite` or `kling-4`; else 'prism', the
--    engine a run that names none runs on. Pinned with `castSwapEngineFrom` to
--    supabase/tests/fixtures/motion-engine-cases.json.
-- 2. `public.admin_motion_style(input)` — 'flex' or 'precise'. A trend run
--    (`__videoUrl` a string, or `trend` an object) reads the prompt style its
--    recipe ran: `__promptStyle` 'flexible' is flex, and with no
--    `__promptStyle` a full-depth clip (`__faceMasking.source`) is flex while
--    masking is on (its `mode` not 'off'); its own `style` is never read.
--    Any other run is flex when the person picked it (`style` 'motion').
--    Everything else is precise.
-- 3. `public.admin_motion_tree(run_ids, kie_usd, local_routes)` — each run
--    (depth 0) and every job below it by `parent_job_id`, of the run's owner,
--    down to depth 5 (the backend's MAX_CHILD_JOB_DEPTH), each job once per
--    run at its shallowest depth. A trashed job still counts. Per row:
--      - route         `input_data.type` when a non-empty string, else `job_type`
--      - step_key      the idempotency key
--      - model         the first of `input_data` `resolvedModel`, `provider`,
--                      `llmModel`, `model`
--      - held          its hold (`jobs.credits`)
--      - log_status    its usage log's status; none without a usage log
--      - taken         once that log is committed or refunded: its charge
--                      (`usage_log_charge`) plus the charges of its committed
--                      side holds; else none
--      - recorded_usd  its own cost — a metered LLM job's ledger cost
--                      (`llm_billing`, a ledger when its `calls` is a number),
--                      never the `provider_cost` beside it, and none when the
--                      ledger could not compute one; any other job's
--                      `provider_cost` — plus the ledger cost of each of its
--                      side holds, committed or refunded (the call cost us that
--                      whether its hold was kept or given back). None when
--                      nothing is known.
--      - kie_usd       KIE's figure for its `provider_task_id`, when the map
--                      holds a number for it
--      - is_local      the run's own row, or a step whose route is local
--      - paid_usd      KIE's figure, else the recorded one, else 0 when local
--      - no_cost       a step, not local, that completed with neither KIE's
--                      figure nor its own cost; its side holds' costs never
--                      make up for an unknown own cost (they are still paid)
-- 4. `public.admin_motion_runs(from, to, run_id, credit_usd, kie_usd, local_routes)` —
--    the runs: top-level jobs of type `cast-swap` or `cast-swap-full-quality`,
--    or still queued (`job_type` not set yet) with `input_data.type`
--    'cast-swap'; never a trend's face-mask make. The one run `run_id` names
--    (the range then ignored; a primary-key lookup), or else the runs created
--    in [from, to): two branches, each gated on `run_id` alone. Trashed runs
--    count.
--    Their trees are read in one call, never one per run. Per run:
--      - held          the rows' holds
--      - settled       no row's hold is still open
--      - taken         the rows' charges; none while the run's own hold is
--                      open, or when no row has settled
--      - taken_usd     taken × credit_usd
--      - recorded_usd, kie_usd   the rows' figures
--      - paid_usd      the rows' paid, 0 with none
--      - the difference, taken_usd less paid_usd, once settled with something
--        taken; and that difference over taken_usd, as a percent, when
--        taken_usd is above 0 (unrounded)
--      - steps / steps_without_cost   the rows below the run / the no_cost ones
--      - quote         the run's recorded quote (`input_data.__castSwapQuote`)
--      - quote_total   its `totalCredits`, from a version 1 quote
--      - reuse         the steps the run took from a cache or an earlier try
--                      instead of paying for them (`output_data.__castSwapReuse`)
--      - extras        which of the quoted extras ran (`output_data.__castSwapExtras`,
--                      version 1)
--      - quote_allowed quote_total, plus the quoted credits of each extra that
--                      ran (`privacyCredits`, `referencesRetryCredits`); an
--                      extra that did not run, or has no number quoted, adds 0
--      - flags         for a settled run only (a run still in flight, its own
--                      hold or a step's still open, is never flagged): paid
--                      above taken; a step with no recorded cost; taken above
--                      quote_allowed. `flagged` = any of them.
--      - kind          'trend' when `input_data.trend` is an object, else 'hand';
--                      trend_name its `name`
--      - engine, resolution, draft   from the run's own input
--      - length_sec, style   from the run's own input, or a Full Quality run's
--                      draft's (the owner's job its `fullQualityOf` names; a
--                      Full Quality run carries the draft's card, not its
--                      clip or recipe): 4 for a preview, else
--                      `sourceDurationSec`
-- 5. `public.admin_motion_run_list(...)` — the range's runs, filtered (each
--    filter is none when NULL; `p_flagged` true keeps flagged runs only, and
--    false is no filter, as NULL is), sorted and paged, as JSON:
--      - sorted by `p_sort` (margin_usd, margin_pct, paid_usd, taken or
--        created_at) in `p_dir` (asc or desc). By one of the four figures,
--        every settled run comes before every run still in flight, whose
--        figures are not final, in both directions; by created_at, the date
--        alone. A run with no figure is last within its group either way;
--        ties go newest first, then by id.
--      - paged by `p_limit` (1 to 200) and `p_offset` (0 or more), with
--        `p_credit_usd` above 0; any other value is refused (SQLSTATE 22023).
--      - `total`: the filtered runs. `runs`: the page, each row as
--        admin_motion_runs answers it, less quote, reuse and extras.
--      - `totals`, over the filtered runs: one row for all (there even with
--        no run) and one per engine, resolution and style, named by GROUPING.
--        `runs` and `unsettled` count every run; held, taken, taken_usd,
--        paid_usd and their difference sum the settled runs only, so a group
--        with no settled run has NULL for each of them, never 0.
-- 6. `public.admin_motion_task_ids(from, to)` — the distinct provider task ids
--    of every tree row of the range's runs, the KIE tasks to look up, as one
--    sorted array (an empty one for a range with none). One value, never
--    rows, so no API row cap can cut it short.
--
-- All six are server-only: the admin routes call them with the service role.
-- Functions only: no table, index or data changes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_motion_engine(p_input JSONB)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_input->'engine') = 'string'
     AND p_input->>'engine' IN ('motion-pulse', 'motion-lite', 'kling-4') THEN 'pulse'
    ELSE 'prism'
  END
$$;

REVOKE ALL ON FUNCTION public.admin_motion_engine(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_motion_engine(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.admin_motion_engine(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_motion_engine(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_motion_style(p_input JSONB)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_input->'__videoUrl') = 'string' OR jsonb_typeof(p_input->'trend') = 'object' THEN
      CASE
        WHEN p_input->>'__promptStyle' = 'flexible' THEN 'flex'
        -- No prompt style recorded (a JSON null is none): a run from before
        -- the choice, Flexible for a full-depth clip while masking is on.
        WHEN coalesce(jsonb_typeof(p_input->'__promptStyle'), 'null') = 'null'
         AND p_input->'__faceMasking'->>'source' = 'full-depth'
         AND p_input->'__faceMasking'->>'mode' IS DISTINCT FROM 'off' THEN 'flex'
        ELSE 'precise'
      END
    WHEN p_input->>'style' = 'motion' THEN 'flex'
    ELSE 'precise'
  END
$$;

REVOKE ALL ON FUNCTION public.admin_motion_style(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_motion_style(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.admin_motion_style(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_motion_style(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_motion_tree(
  p_run_ids      UUID[],
  p_kie_usd      JSONB  DEFAULT '{}',
  p_local_routes TEXT[] DEFAULT '{}'
)
RETURNS TABLE (
  run_id UUID, job_id UUID, parent_job_id UUID, depth INT, route TEXT, step_key TEXT,
  provider TEXT, model TEXT, provider_task_id TEXT, status TEXT, created_at TIMESTAMPTZ,
  held INT, log_status TEXT, taken INT, recorded_usd NUMERIC, kie_usd NUMERIC, paid_usd NUMERIC,
  is_local BOOLEAN, no_cost BOOLEAN
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH RECURSIVE walk AS (
    SELECT r.id AS run_id, r.user_id AS owner, r.id AS job_id, 0 AS depth
      FROM public.jobs r
     WHERE r.id = ANY (p_run_ids)
    UNION ALL
    -- A step is read as its run's owner's only. A trashed step still counts.
    SELECT w.run_id, w.owner, c.id, w.depth + 1
      FROM walk w
      JOIN public.jobs c ON c.parent_job_id = w.job_id AND c.user_id = w.owner
     WHERE w.depth < 5
  ),
  tree AS (
    SELECT DISTINCT ON (w.run_id, w.job_id) w.run_id, w.job_id, w.depth
      FROM walk w
     ORDER BY w.run_id, w.job_id, w.depth
  )
  SELECT t.run_id, j.id, j.parent_job_id, t.depth, rt.route, j.idempotency_key, j.provider,
         coalesce(j.input_data->>'resolvedModel', j.input_data->>'provider', j.input_data->>'llmModel', j.input_data->>'model'),
         j.provider_task_id, j.status, j.created_at, j.credits, u.status,
         CASE WHEN u.status IN ('committed', 'refunded')
              THEN (public.usage_log_charge(u.status, u.credits_used, u.credits_charged) + coalesce(side.charge, 0))::INT
         END,
         rec.recorded_usd,
         kie.kie_usd,
         coalesce(kie.kie_usd, rec.recorded_usd, CASE WHEN loc.is_local THEN 0 END),
         loc.is_local,
         -- Without KIE's figure, a step's own cost must be known: its side
         -- holds' costs never make up for an unknown one.
         t.depth > 0 AND NOT loc.is_local AND j.status IS NOT DISTINCT FROM 'completed'
           AND kie.kie_usd IS NULL AND own.cost_usd IS NULL
    FROM tree t
    JOIN public.jobs j ON j.id = t.job_id
    LEFT JOIN public.usage_logs u ON u.id = j.usage_log_id
    -- Its settled side holds: the charges of the committed ones (taken), and
    -- the ledger cost of each, committed or refunded (what the call cost us,
    -- whether the hold was kept or given back).
    LEFT JOIN LATERAL (
      SELECT sum(s.charge) FILTER (WHERE s.status = 'committed' AND s.charge > 0) AS charge,
             sum(s.cost_usd) AS cost_usd
        FROM (SELECT l.status,
                     public.usage_log_charge(l.status, l.credits_used, l.credits_charged) AS charge,
                     CASE WHEN jsonb_typeof(h.ledger->'costUsd') = 'number'
                          THEN (h.ledger->>'costUsd')::NUMERIC END AS cost_usd
                FROM public.llm_side_holds h
                JOIN public.usage_logs l ON l.id = h.usage_log_id
               WHERE h.job_id = j.id
                 AND l.status IN ('committed', 'refunded')) AS s
    ) AS side ON true
    CROSS JOIN LATERAL (
      SELECT coalesce(CASE WHEN jsonb_typeof(j.input_data->'type') = 'string' THEN nullif(j.input_data->>'type', '') END,
                      j.job_type) AS route
    ) AS rt
    CROSS JOIN LATERAL (
      SELECT t.depth = 0 OR coalesce(rt.route = ANY (coalesce(p_local_routes, '{}'::TEXT[])), false) AS is_local
    ) AS loc
    CROSS JOIN LATERAL (
      SELECT CASE WHEN jsonb_typeof(coalesce(p_kie_usd, '{}'::JSONB) -> j.provider_task_id) = 'number'
                  THEN (coalesce(p_kie_usd, '{}'::JSONB) ->> j.provider_task_id)::NUMERIC END AS kie_usd
    ) AS kie
    -- Its own cost: a metered LLM job's ledger cost alone (never the
    -- provider_cost beside it), any other job's provider_cost.
    CROSS JOIN LATERAL (
      SELECT CASE WHEN jsonb_typeof(j.llm_billing->'calls') = 'number'
                  THEN CASE WHEN jsonb_typeof(j.llm_billing->'costUsd') = 'number'
                            THEN (j.llm_billing->>'costUsd')::NUMERIC END
                  ELSE j.provider_cost END AS cost_usd
    ) AS own
    CROSS JOIN LATERAL (
      SELECT CASE WHEN own.cost_usd IS NULL AND side.cost_usd IS NULL THEN NULL
                  ELSE coalesce(own.cost_usd, 0) + coalesce(side.cost_usd, 0) END AS recorded_usd
    ) AS rec
   ORDER BY t.run_id, t.depth, j.created_at, j.id
$$;

REVOKE ALL ON FUNCTION public.admin_motion_tree(UUID[], JSONB, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_motion_tree(UUID[], JSONB, TEXT[]) FROM anon;
REVOKE ALL ON FUNCTION public.admin_motion_tree(UUID[], JSONB, TEXT[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_motion_tree(UUID[], JSONB, TEXT[]) TO service_role;

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
  resolution TEXT, draft BOOLEAN, length_sec NUMERIC, held BIGINT, taken BIGINT, settled BOOLEAN,
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
         x.input_data->>'resolution',
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

CREATE OR REPLACE FUNCTION public.admin_motion_run_list(
  p_from         TIMESTAMPTZ,
  p_to           TIMESTAMPTZ,
  p_credit_usd   NUMERIC,
  p_kie_usd      JSONB,
  p_local_routes TEXT[],
  p_engine       TEXT,
  p_style        TEXT,
  p_kind         TEXT,
  p_resolution   TEXT,
  p_flagged      BOOLEAN,
  p_sort         TEXT,
  p_dir          TEXT,
  p_offset       INT,
  p_limit        INT
)
RETURNS JSONB
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_out JSONB;
BEGIN
  IF p_credit_usd IS NULL OR p_credit_usd <= 0 THEN
    RAISE EXCEPTION 'admin_motion_run_list: p_credit_usd must be above 0, not %',
      coalesce(p_credit_usd::TEXT, 'null') USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_sort IS NULL OR p_sort NOT IN ('margin_usd', 'margin_pct', 'paid_usd', 'taken', 'created_at') THEN
    RAISE EXCEPTION 'admin_motion_run_list: p_sort must be margin_usd, margin_pct, paid_usd, taken or created_at, not %',
      coalesce(p_sort, 'null') USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_dir IS NULL OR p_dir NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'admin_motion_run_list: p_dir must be asc or desc, not %',
      coalesce(p_dir, 'null') USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'admin_motion_run_list: p_limit must be 1 to 200, not %',
      coalesce(p_limit::TEXT, 'null') USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'admin_motion_run_list: p_offset must be 0 or more, not %',
      coalesce(p_offset::TEXT, 'null') USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- One read of the range's runs feeds the count, the page and the totals.
  WITH runs AS (
    SELECT r.*,
           CASE p_sort
             WHEN 'margin_usd' THEN r.margin_usd
             WHEN 'margin_pct' THEN r.margin_pct
             WHEN 'paid_usd'   THEN r.paid_usd
             WHEN 'taken'      THEN r.taken::NUMERIC
             ELSE extract(epoch FROM r.created_at)
           END AS sort_key
      FROM public.admin_motion_runs(p_from, p_to, NULL, p_credit_usd, p_kie_usd, p_local_routes) AS r
     WHERE (p_engine IS NULL OR r.engine = p_engine)
       AND (p_style IS NULL OR r.style = p_style)
       AND (p_kind IS NULL OR r.kind = p_kind)
       AND (p_resolution IS NULL OR r.resolution = p_resolution)
       AND (p_flagged IS NOT TRUE OR r.flagged)
  ),
  -- By a figure, every settled run comes before every run still in flight
  -- (whose figures are not final), in both directions; by date, the date alone.
  ordered AS (
    SELECT runs.*,
           row_number() OVER (ORDER BY CASE WHEN p_sort <> 'created_at' THEN runs.settled END DESC NULLS LAST,
                                       CASE WHEN p_dir = 'asc' THEN runs.sort_key END ASC NULLS LAST,
                                       CASE WHEN p_dir = 'desc' THEN runs.sort_key END DESC NULLS LAST,
                                       runs.created_at DESC, runs.id DESC) AS ord
      FROM runs
  ),
  totals AS (
    SELECT CASE WHEN GROUPING(runs.engine) = 0 THEN 'engine'
                WHEN GROUPING(runs.resolution) = 0 THEN 'resolution'
                WHEN GROUPING(runs.style) = 0 THEN 'style'
                ELSE 'all' END AS dimension,
           CASE WHEN GROUPING(runs.engine) = 0 THEN runs.engine
                WHEN GROUPING(runs.resolution) = 0 THEN runs.resolution
                WHEN GROUPING(runs.style) = 0 THEN runs.style END AS value,
           count(*) AS runs,
           count(*) FILTER (WHERE NOT runs.settled) AS unsettled,
           sum(runs.held) FILTER (WHERE runs.settled) AS held,
           sum(runs.taken) FILTER (WHERE runs.settled) AS taken,
           sum(runs.taken_usd) FILTER (WHERE runs.settled) AS taken_usd,
           sum(runs.paid_usd) FILTER (WHERE runs.settled) AS paid_usd
      FROM runs
     GROUP BY GROUPING SETS ((), (runs.engine), (runs.resolution), (runs.style))
  )
  SELECT jsonb_build_object(
           'total', (SELECT count(*) FROM runs),
           'runs', coalesce((
             SELECT jsonb_agg(to_jsonb(o) - 'quote' - 'reuse' - 'extras' - 'sort_key' - 'ord' ORDER BY o.ord)
               FROM ordered o
              WHERE o.ord > p_offset AND o.ord <= p_offset::BIGINT + p_limit
           ), '[]'::JSONB),
           'totals', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'dimension', t.dimension, 'value', t.value, 'runs', t.runs, 'unsettled', t.unsettled,
                      'held', t.held, 'taken', t.taken, 'taken_usd', t.taken_usd, 'paid_usd', t.paid_usd,
                      'margin_usd', t.taken_usd - t.paid_usd,
                      'margin_pct', CASE WHEN t.taken_usd > 0 THEN (t.taken_usd - t.paid_usd) / t.taken_usd * 100 END)
                    ORDER BY CASE t.dimension WHEN 'all' THEN 0 WHEN 'engine' THEN 1 WHEN 'resolution' THEN 2 ELSE 3 END,
                             t.value NULLS LAST)
               FROM totals t
           ), '[]'::JSONB))
    INTO v_out;
  RETURN v_out;
END
$$;

REVOKE ALL ON FUNCTION public.admin_motion_run_list(TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC, JSONB, TEXT[], TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_motion_run_list(TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC, JSONB, TEXT[], TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INT, INT) FROM anon;
REVOKE ALL ON FUNCTION public.admin_motion_run_list(TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC, JSONB, TEXT[], TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_motion_run_list(TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC, JSONB, TEXT[], TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INT, INT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_motion_task_ids(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TEXT[]
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  -- One value, never rows: an API's row cap cannot cut it short.
  SELECT coalesce(array_agg(DISTINCT t.provider_task_id ORDER BY t.provider_task_id), '{}'::TEXT[])
    FROM public.admin_motion_tree(ARRAY(
           -- The range's runs, selected as admin_motion_runs' range branch
           -- selects them (there is no one-run branch here).
           SELECT r.id
             FROM public.jobs r
            WHERE r.created_at >= p_from AND r.created_at < p_to
              AND r.parent_job_id IS NULL
              AND (r.job_type IN ('cast-swap', 'cast-swap-full-quality')
                   OR (r.job_type IS NULL AND r.input_data->>'type' = 'cast-swap'))
         )) AS t
   WHERE t.provider_task_id IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.admin_motion_task_ids(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_motion_task_ids(TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.admin_motion_task_ids(TIMESTAMPTZ, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_motion_task_ids(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
