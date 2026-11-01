-- ============================================================================
-- The admin Jobs list filters on the server.
--
-- The admin Jobs page read one page of `jobs` by status and user and filtered
-- the rest (type, model, credits, platform, dates, search) in the browser, so
-- a filter only ever saw the 50 rows it was handed. `admin_job_page` moves
-- every filter into one query and returns the ids of one page; the route then
-- loads those rows as before.
--
-- 1. `public.job_platform_key(source, source_detail)` — the platform a job came
--    from, as a stable key: `web:<product>` for the Nodaro web apps (the last
--    label of the subdomain of a host ending in `.nodaro.ai`; any other host,
--    the bare `nodaro.ai` included, kept whole and lowercased), `app:<app id>`
--    for a developer app, the source kind for
--    every other caller, `unknown` before provenance was recorded. The SQL twin
--    of the platform rule the editor groups by; both are pinned to one case
--    table, supabase/tests/fixtures/job-platform-cases.json.
-- 2. `public.admin_job_own_credits(job_id, usage_log_id, credits)` — the job's
--    OWN credits figure: once its usage log is settled (committed or refunded),
--    the charge (`usage_log_charge`) plus the charge of its committed LLM side
--    holds (554); before that, its hold (`jobs.credits`); else 0. Pinned to
--    supabase/tests/fixtures/admin-job-own-credits-cases.json.
-- 3. `public.admin_job_page(...)` — the filtered page of job ids, newest first.
--    Every argument is optional: NULL (or an empty list, or a blank search)
--    is no filter. The WHERE clause is built from the filters present only, so
--    an absent filter costs nothing (the own-credits figure, a subquery per
--    row, is computed only when a minimum is asked for); every value is bound
--    as a parameter, never written into the SQL text.
--      - type   = `input_data->>'type'` when it is a non-empty string, else
--                 `job_type`
--      - model  = `input_data->>'resolvedModel'` (the model the job runs,
--                 recorded by every new job), else `provider`, else
--                 `llmModel`, else `model` (`jobs.provider` is the vendor
--                 lane, never the model)
--      - `p_to` is exclusive; `p_from` inclusive
--      - `p_q` matches the row's text (`input_data` `prompt`, `userPrompt`,
--        `userInput` or `text`) or the error message as a literal substring,
--        case-insensitive; with `p_q_is_id` it is a job id, matched exactly
--      - ties on `created_at` are broken by id, so pages never overlap
-- 4. `public.admin_job_sources(since)` — every platform key with jobs created
--    at or after `since`, with its job count and one representative
--    `source` / `source_detail` (the least of each), most jobs first. The
--    admin Jobs page's platform filter lists its choices from it.
--
-- All four are server-only: the admin route calls them with the service role.
-- Functions only: no table, index or data changes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.job_platform_key(p_source TEXT, p_source_detail TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT CASE
    WHEN s.src = 'app' THEN
      CASE WHEN nullif(btrim(p_source_detail), '') IS NULL THEN 'app'
           ELSE 'app:' || btrim(p_source_detail) END
    WHEN s.src = 'web' AND p_source_detail IS NOT NULL AND p_source_detail <> '' THEN
      'web:' || CASE
        WHEN s.host = '' THEN 'web'
        WHEN s.host LIKE '%.nodaro.ai' THEN
          -- The last non-empty label of the subdomain: `studio`, or `studio`
          -- from `next.studio`.
          coalesce(substring(left(s.host, length(s.host) - length('.nodaro.ai')) FROM '([^.]+)\.*$'), 'web')
        ELSE s.host
      END
    WHEN s.src <> '' THEN s.src
    ELSE 'unknown'
  END
  FROM (SELECT lower(coalesce(p_source, '')) AS src,
               lower(btrim(coalesce(p_source_detail, ''))) AS host) AS s
$$;

REVOKE ALL ON FUNCTION public.job_platform_key(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.job_platform_key(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.job_platform_key(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.job_platform_key(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_job_own_credits(
  p_job_id UUID, p_usage_log_id UUID, p_credits INTEGER
) RETURNS INTEGER
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT public.usage_log_charge(u.status, u.credits_used, u.credits_charged)
            + coalesce((
                SELECT sum(c.charge)::integer
                  FROM (SELECT public.usage_log_charge(s.status, s.credits_used, s.credits_charged) AS charge
                          FROM public.llm_side_holds h
                          JOIN public.usage_logs s ON s.id = h.usage_log_id
                         WHERE h.job_id = p_job_id
                           AND s.status = 'committed') AS c
                 WHERE c.charge > 0
              ), 0)
       FROM public.usage_logs u
      WHERE u.id = p_usage_log_id
        AND u.status IN ('committed', 'refunded')),
    p_credits,
    0
  )
$$;

REVOKE ALL ON FUNCTION public.admin_job_own_credits(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_job_own_credits(UUID, UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.admin_job_own_credits(UUID, UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_job_own_credits(UUID, UUID, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_job_page(
  p_offset           INT         DEFAULT NULL,
  p_limit            INT         DEFAULT NULL,
  p_status           TEXT        DEFAULT NULL,
  p_user_id          UUID        DEFAULT NULL,
  p_exclude_user_ids UUID[]      DEFAULT NULL,
  p_types            TEXT[]      DEFAULT NULL,
  p_models           TEXT[]      DEFAULT NULL,
  p_min_credits      INT         DEFAULT NULL,
  p_sources          TEXT[]      DEFAULT NULL,
  p_from             TIMESTAMPTZ DEFAULT NULL,
  p_to               TIMESTAMPTZ DEFAULT NULL,
  p_q                TEXT        DEFAULT NULL,
  p_q_is_id          BOOLEAN     DEFAULT NULL
)
RETURNS TABLE (id UUID)
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_where TEXT[] := ARRAY[]::TEXT[];
  v_q     TEXT   := nullif(btrim(p_q), '');
  v_q_id  UUID;
  v_like  TEXT;
BEGIN
  -- Each clause names its value by position in the USING list below; none is
  -- ever formatted into the SQL text.
  IF p_status IS NOT NULL THEN
    v_where := array_append(v_where, 'j.status = $1');
  END IF;
  IF p_user_id IS NOT NULL THEN
    v_where := array_append(v_where, 'j.user_id = $2');
  END IF;
  IF cardinality(p_exclude_user_ids) > 0 THEN
    v_where := array_append(v_where, 'j.user_id <> ALL ($3)');
  END IF;
  IF cardinality(p_types) > 0 THEN
    -- `input_data.type` only when it is a non-empty string (the editor's
    -- `rowJobType` reads it the same way), else `job_type`.
    v_where := array_append(v_where,
      'coalesce(CASE WHEN jsonb_typeof(j.input_data->''type'') = ''string'' THEN nullif(j.input_data->>''type'', '''') END, j.job_type) = ANY ($4)');
  END IF;
  IF cardinality(p_models) > 0 THEN
    v_where := array_append(v_where,
      'coalesce(j.input_data->>''resolvedModel'', j.input_data->>''provider'', j.input_data->>''llmModel'', j.input_data->>''model'') = ANY ($5)');
  END IF;
  IF p_min_credits IS NOT NULL THEN
    v_where := array_append(v_where, 'public.admin_job_own_credits(j.id, j.usage_log_id, j.credits) >= $6');
  END IF;
  IF cardinality(p_sources) > 0 THEN
    v_where := array_append(v_where, 'public.job_platform_key(j.source, j.source_detail) = ANY ($7)');
  END IF;
  IF p_from IS NOT NULL THEN
    v_where := array_append(v_where, 'j.created_at >= $8');
  END IF;
  IF p_to IS NOT NULL THEN
    v_where := array_append(v_where, 'j.created_at < $9');
  END IF;
  IF v_q IS NOT NULL THEN
    IF coalesce(p_q_is_id, false) THEN
      v_q_id := v_q::UUID;
      v_where := array_append(v_where, 'j.id = $10');
    ELSE
      -- A literal substring: the LIKE wildcards and the escape character in
      -- the search itself are escaped.
      v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
      -- Every field a row keeps its text in: the prompt of a media node, the
      -- `userPrompt` / `userInput` of an LLM step, the `text` of speech.
      v_where := array_append(v_where,
        '(j.input_data->>''prompt'' ILIKE $11 OR j.input_data->>''userPrompt'' ILIKE $11'
        ' OR j.input_data->>''userInput'' ILIKE $11 OR j.input_data->>''text'' ILIKE $11'
        ' OR j.error_message ILIKE $11)');
    END IF;
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT j.id FROM public.jobs j %s ORDER BY j.created_at DESC, j.id DESC OFFSET $12 LIMIT $13',
    CASE WHEN cardinality(v_where) > 0 THEN 'WHERE ' || array_to_string(v_where, ' AND ') ELSE '' END
  )
  USING p_status, p_user_id, p_exclude_user_ids, p_types, p_models, p_min_credits, p_sources,
        p_from, p_to, v_q_id, v_like, greatest(coalesce(p_offset, 0), 0), p_limit;
END
$$;

REVOKE ALL ON FUNCTION public.admin_job_page(INT, INT, TEXT, UUID, UUID[], TEXT[], TEXT[], INT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_job_page(INT, INT, TEXT, UUID, UUID[], TEXT[], TEXT[], INT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.admin_job_page(INT, INT, TEXT, UUID, UUID[], TEXT[], TEXT[], INT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_job_page(INT, INT, TEXT, UUID, UUID[], TEXT[], TEXT[], INT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_job_sources(p_since TIMESTAMPTZ)
RETURNS TABLE (key TEXT, source TEXT, source_detail TEXT, count BIGINT)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT public.job_platform_key(j.source, j.source_detail) AS key,
         min(j.source) AS source,
         min(j.source_detail) AS source_detail,
         count(*) AS count
    FROM public.jobs j
   WHERE j.created_at >= p_since
   GROUP BY 1
   ORDER BY 4 DESC, 1
$$;

REVOKE ALL ON FUNCTION public.admin_job_sources(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_job_sources(TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.admin_job_sources(TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_job_sources(TIMESTAMPTZ) TO service_role;
