-- ============================================================================
-- The admin Jobs list reads one filtered page in one call, with lighter rows.
--
-- Until now the route made two reads for a page: `admin_job_page` (575) for
-- the ids, then the rows by id, each with the job's whole `input_data` and
-- `output_data` (a run's full request and result: transcripts, checkpoints,
-- word timings). The list shows none of that beyond a row's type and its
-- output's media; the job's detail view loads the whole job when it opens.
--
-- 1. `public.admin_job_url_skeleton(value)` — the parts of a JSON value that
--    are web addresses: every string starting `http://` or `https://` (any
--    case), at any depth, inside the objects and arrays that hold it, with
--    every other value left out (an object or array with no address in it is
--    dropped whole). Object keys keep the names they had, so the addresses
--    come back in the order a reader walking the full value meets them.
-- 2. `public.admin_job_output_preview(output)` — what the list keeps of a
--    job's `output_data`: its address skeleton, plus — for an object — the
--    top-level strings a gallery tile reads by name: `thumbnailUrl` and
--    `imageUrl` whole (an image needs no `http` prefix there), and the start
--    of `generatedText` / `text` / `result`: its first 1000 characters after
--    any leading whitespace (the tile trims it and shows 280). Pinned to supabase/tests/fixtures/admin-job-output-preview-cases.json,
--    which the editor's tile is also tested against: the tile a preview makes
--    is the tile the full output makes.
-- 3. `public.admin_job_list(...)` — the page `admin_job_page` picks (the same
--    arguments, the same filters and order — it calls it), as rows: the
--    columns the list shows, `input_data` reduced to its `type`, and
--    `output_data` reduced to its preview.
--
-- 4. `public.admin_job_page(...)` again (575), with the same signature,
--    arguments and results, and one change: its credit minimum
--    (`p_min_credits`) no longer calls `admin_job_own_credits` once per row
--    it scans — a function Postgres cannot inline, running two subqueries
--    per call, while the newest-first walk reads row after row until the page
--    fills. The same figure is now joined in: the job's own usage log when it
--    is settled (committed or refunded) and the sum of its committed side
--    holds, read beside each row by index, with the charge written out as
--    `usage_log_charge` writes it (refunded 0; committed the charge, else the
--    hold). `admin_job_own_credits` stays the figure's definition: the
--    behavior test proves this filter keeps exactly the jobs it keeps, over
--    the own-credits case table and the usage-charge case table.
--
-- All are server-only: the admin route calls them with the service role.
-- Functions only: no table, index or data changes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_job_url_skeleton(p_value JSONB)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  v_out JSONB;
BEGIN
  CASE jsonb_typeof(p_value)
    WHEN 'string' THEN
      RETURN CASE WHEN (p_value #>> '{}') ~* '^https?://' THEN p_value END;
    WHEN 'object', 'array' THEN
      -- A part with no address anywhere in it is left out in one pass, never
      -- walked value by value (a transcript's words, a checkpoint).
      IF NOT jsonb_path_exists(p_value,
           'strict $.** ? (@.type() == "string" && @ like_regex "^https?://" flag "i")') THEN
        RETURN NULL;
      END IF;
      IF jsonb_typeof(p_value) = 'array' THEN
        SELECT jsonb_agg(s.v ORDER BY s.n) INTO v_out
          FROM (SELECT e.n, public.admin_job_url_skeleton(e.x) AS v
                  FROM jsonb_array_elements(p_value) WITH ORDINALITY AS e(x, n)) AS s
         WHERE s.v IS NOT NULL;
      ELSE
        SELECT jsonb_object_agg(s.k, s.v) INTO v_out
          FROM (SELECT e.key AS k, public.admin_job_url_skeleton(e.value) AS v
                  FROM jsonb_each(p_value) AS e) AS s
         WHERE s.v IS NOT NULL;
      END IF;
      RETURN v_out;
    ELSE
      RETURN NULL;
  END CASE;
END
$$;

REVOKE ALL ON FUNCTION public.admin_job_url_skeleton(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_job_url_skeleton(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.admin_job_url_skeleton(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_job_url_skeleton(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_job_output_preview(p_output JSONB)
RETURNS JSONB
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_output IS NULL THEN NULL
    WHEN jsonb_typeof(p_output) <> 'object' THEN public.admin_job_url_skeleton(p_output)
    ELSE coalesce(public.admin_job_url_skeleton(p_output), '{}'::jsonb) || coalesce((
      SELECT jsonb_object_agg(
               f.key,
               CASE WHEN f.key IN ('thumbnailUrl', 'imageUrl') OR (f.value #>> '{}') ~* '^https?://'
                    THEN f.value
                    -- JavaScript's trim() whitespace, so a text that opens
                    -- with a long run of it still shows.
                    ELSE to_jsonb(left(ltrim(f.value #>> '{}',
                           U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),
                           1000)) END)
        FROM jsonb_each(p_output) AS f
       WHERE f.key IN ('thumbnailUrl', 'imageUrl', 'generatedText', 'text', 'result')
         AND jsonb_typeof(f.value) = 'string'
    ), '{}'::jsonb)
  END
$$;

REVOKE ALL ON FUNCTION public.admin_job_output_preview(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_job_output_preview(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.admin_job_output_preview(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_job_output_preview(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_job_list(
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
RETURNS TABLE (
  id                       UUID,
  status                   TEXT,
  job_type                 TEXT,
  credits                  INTEGER,
  provider                 TEXT,
  provider_cost            NUMERIC,
  display_cost             NUMERIC,
  error_message            TEXT,
  input_data               JSONB,
  output_data              JSONB,
  created_at               TIMESTAMPTZ,
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  user_id                  UUID,
  workflow_id              UUID,
  workflow_execution_id    UUID,
  source                   TEXT,
  source_detail            TEXT,
  provider_kind            TEXT,
  provider_task_id         TEXT,
  reconcile_attempts       INTEGER,
  reconcile_last_error     TEXT,
  provider_call_started_at TIMESTAMPTZ,
  usage_log_id             UUID
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT j.id, j.status::text, j.job_type::text, j.credits::integer, j.provider::text,
         j.provider_cost::numeric, j.display_cost::numeric, j.error_message::text,
         -- The list reads a row's type only (`input_data.type`, else `job_type`).
         CASE WHEN j.input_data IS NOT NULL
              THEN jsonb_strip_nulls(jsonb_build_object('type', j.input_data->'type')) END,
         public.admin_job_output_preview(j.output_data),
         j.created_at, j.started_at, j.completed_at, j.user_id, j.workflow_id,
         j.workflow_execution_id, j.source::text, j.source_detail::text, j.provider_kind::text,
         j.provider_task_id::text, j.reconcile_attempts::integer, j.reconcile_last_error::text,
         j.provider_call_started_at, j.usage_log_id
    FROM public.admin_job_page(
           p_offset => p_offset, p_limit => p_limit, p_status => p_status, p_user_id => p_user_id,
           p_exclude_user_ids => p_exclude_user_ids, p_types => p_types, p_models => p_models,
           p_min_credits => p_min_credits, p_sources => p_sources, p_from => p_from, p_to => p_to,
           p_q => p_q, p_q_is_id => p_q_is_id
         ) WITH ORDINALITY AS p(job_id, ord)
    JOIN public.jobs j ON j.id = p.job_id
   ORDER BY p.ord
$$;

REVOKE ALL ON FUNCTION public.admin_job_list(INT, INT, TEXT, UUID, UUID[], TEXT[], TEXT[], INT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_job_list(INT, INT, TEXT, UUID, UUID[], TEXT[], TEXT[], INT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.admin_job_list(INT, INT, TEXT, UUID, UUID[], TEXT[], TEXT[], INT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_job_list(INT, INT, TEXT, UUID, UUID[], TEXT[], TEXT[], INT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) TO service_role;

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
  v_join  TEXT   := '';
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
    -- `admin_job_own_credits` joined in, not called per row: the own usage
    -- log when settled, and the committed side holds' charges above 0.
    v_join := ' LEFT JOIN public.usage_logs u ON u.id = j.usage_log_id AND u.status IN (''committed'', ''refunded'')'
      ' LEFT JOIN LATERAL (SELECT sum(c.charge)::integer AS charge'
      '   FROM (SELECT coalesce(s.credits_charged, s.credits_used) AS charge'
      '           FROM public.llm_side_holds h JOIN public.usage_logs s ON s.id = h.usage_log_id'
      '          WHERE h.job_id = j.id AND s.status = ''committed'') AS c'
      '  WHERE c.charge > 0) AS sh ON true';
    v_where := array_append(v_where,
      'coalesce(CASE u.status WHEN ''refunded'' THEN 0 WHEN ''committed'' THEN coalesce(u.credits_charged, u.credits_used) END'
      ' + coalesce(sh.charge, 0), j.credits, 0) >= $6');
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
    'SELECT j.id FROM public.jobs j%s %s ORDER BY j.created_at DESC, j.id DESC OFFSET $12 LIMIT $13',
    v_join,
    CASE WHEN cardinality(v_where) > 0 THEN 'WHERE ' || array_to_string(v_where, ' AND ') ELSE '' END
  )
  USING p_status, p_user_id, p_exclude_user_ids, p_types, p_models, p_min_credits, p_sources,
        p_from, p_to, v_q_id, v_like, greatest(coalesce(p_offset, 0), 0), p_limit;
END
$$;

-- CREATE OR REPLACE keeps 575's grants; restated so this file reads whole.
REVOKE ALL ON FUNCTION public.admin_job_page(INT, INT, TEXT, UUID, UUID[], TEXT[], TEXT[], INT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_job_page(INT, INT, TEXT, UUID, UUID[], TEXT[], TEXT[], INT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.admin_job_page(INT, INT, TEXT, UUID, UUID[], TEXT[], TEXT[], INT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_job_page(INT, INT, TEXT, UUID, UUID[], TEXT[], TEXT[], INT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) TO service_role;
