-- 495_job_output_url_references.sql
--
-- Which jobs' outputs name a url — looked up through an index, never a scan
-- (decided 2026-10-08, storage expiry round 10).
--
-- When the retention reapers (backend/src/ee/billing/cleanup-service.ts)
-- delete a file, its link is blanked in EVERY job output that names it — any
-- owner, not just the batch being reaped — and nothing else in those outputs
-- changes. `blank_job_output_urls` does that, and finding those outputs is the
-- question "which job outputs hold this url, at any depth". The reapers then
-- mark their batch through `mark_job_outputs_cleaned`, on each row's current
-- value. The failed-delete retry asks the same index whether a job made since
-- a failed asset or media delete links the file (`urls_linked_by_jobs_since`).
--
-- `output_data` is free-form JSON and urls sit at any depth (a descriptor's
-- `json.url`, a variant list, stems), so a GIN index on the column itself
-- cannot serve the question: probed on Postgres 17, `output_data @? 'strict
-- $.** ? (@ == "<url>")'` is a sequential scan even with a jsonb_path_ops
-- index. So the index is on an expression: the set of url strings an output
-- holds (`job_output_urls`), queried with `&&`.
--
-- WHY `job_output_urls` KEEPS EXECUTE FOR EVERY ROLE. An index expression is
-- evaluated, with the writer's privileges, on every insert and update of
-- `jobs` (probed: with EXECUTE revoked from PUBLIC, another role's INSERT into
-- jobs fails "permission denied for function job_output_urls"). The function
-- is pure and reads nothing, so granting it is harmless; revoking it would
-- break job writes. The function that rewrites rows, and its helper, are the
-- backend's only (service_role).
--
-- WHY THE URL FILTER. `output_data` also holds transcripts and model text; a
-- GIN entry larger than about a third of a page fails the write that made
-- it. Only strings that start with http(s):// and are at most 2048 bytes are
-- indexed, which every storage url is.
--
-- THE BUILD. Not CONCURRENTLY (the profile 379 and 481 document: `supabase db
-- push` wraps every file in a transaction). The build reads the whole heap
-- once and takes SHARE on `jobs`: reads go on, job writes wait for it. Apply
-- off-peak. `IF NOT EXISTS` makes it safe to retry.

-- Every url string an output holds, at any depth, once each.
CREATE OR REPLACE FUNCTION public.job_output_urls(p_output jsonb)
RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT t.s), '{}'::text[])
  FROM (
    SELECT q.v #>> '{}' AS s
    FROM jsonb_path_query(p_output, 'strict $.** ? (@.type() == "string")') AS q(v)
  ) AS t
  WHERE t.s ~ '^https?://' AND octet_length(t.s) <= 2048
$$;

-- `p` with every string equal to one of `p_urls` replaced by JSON null,
-- wherever it sits. Keys, other strings and every other value are kept.
CREATE OR REPLACE FUNCTION public.jsonb_with_strings_nulled(p jsonb, p_urls text[])
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
BEGIN
  CASE jsonb_typeof(p)
    WHEN 'string' THEN
      IF (p #>> '{}') = ANY (p_urls) THEN
        RETURN 'null'::jsonb;
      END IF;
      RETURN p;
    WHEN 'array' THEN
      RETURN (
        SELECT coalesce(jsonb_agg(public.jsonb_with_strings_nulled(e.v, p_urls) ORDER BY e.i), '[]'::jsonb)
        FROM jsonb_array_elements(p) WITH ORDINALITY AS e(v, i)
      );
    WHEN 'object' THEN
      RETURN (
        SELECT coalesce(jsonb_object_agg(o.k, public.jsonb_with_strings_nulled(o.v, p_urls)), '{}'::jsonb)
        FROM jsonb_each(p) AS o(k, v)
      );
    ELSE
      RETURN p;
  END CASE;
END;
$$;

-- Blank `p_urls` in up to `p_limit` job outputs that name one of them, any
-- owner; returns how many rows changed. The caller repeats until fewer than
-- `p_limit` change: a blanked row no longer matches, so the loop ends, and a
-- second run is a no-op. Each row is rewritten from its CURRENT value, so a
-- concurrent write to the same output is never lost.
CREATE OR REPLACE FUNCTION public.blank_job_output_urls(p_urls text[], p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE sql VOLATILE
SET search_path = public
AS $$
  WITH hit AS (
    SELECT j.id
    FROM public.jobs j
    WHERE j.output_data IS NOT NULL
      AND public.job_output_urls(j.output_data) && p_urls
    LIMIT greatest(coalesce(p_limit, 200), 1)
  ), changed AS (
    UPDATE public.jobs j
    SET output_data = public.jsonb_with_strings_nulled(j.output_data, p_urls)
    FROM hit
    WHERE j.id = hit.id
    RETURNING 1
  )
  SELECT count(*)::integer FROM changed
$$;

-- Mark a reaped batch cleaned: each row's CURRENT output, with `p_urls` (the
-- files the batch really deleted) nulled wherever they sit, plus `_cleaned`.
-- One statement on the current value, never a whole output the reaper read at
-- the start of its batch: a link another path blanked in between (the retry
-- pass, the other reaper) stays blanked. Returns how many rows changed.
-- EVERY output the reapers select is marked, or the next run would select it
-- again: an object gets the marker key; any other JSON value (a bare string or
-- list) is kept whole under `output` beside the marker.
CREATE OR REPLACE FUNCTION public.mark_job_outputs_cleaned(p_ids uuid[], p_urls text[])
RETURNS integer
LANGUAGE sql VOLATILE
SET search_path = public
AS $$
  WITH changed AS (
    UPDATE public.jobs j
    SET output_data = CASE
      WHEN jsonb_typeof(j.output_data) = 'object'
        THEN public.jsonb_with_strings_nulled(j.output_data, coalesce(p_urls, '{}'::text[])) || '{"_cleaned": true}'::jsonb
      ELSE jsonb_build_object('_cleaned', true, 'output', public.jsonb_with_strings_nulled(j.output_data, coalesce(p_urls, '{}'::text[])))
    END
    WHERE j.id = ANY (p_ids)
      AND j.output_data IS NOT NULL
    RETURNING 1
  )
  SELECT count(*)::integer FROM changed
$$;

-- Which of `p_urls` a job output names whose job was created at or after the
-- moment at the same position in `p_since` — any owner, any depth (decided
-- 2026-10-09). The failed-delete retry asks it before it retries a failed
-- asset or media delete: a job made after the failure that links the file
-- keeps it.
-- One index probe per url, stopping at its first hit. A url with no moment
-- counts every job (keep when unsure).
CREATE OR REPLACE FUNCTION public.urls_linked_by_jobs_since(p_urls text[], p_since timestamptz[])
RETURNS SETOF text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT x.url
  FROM unnest(p_urls, p_since) AS x(url, since)
  WHERE x.url IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.output_data IS NOT NULL
        AND public.job_output_urls(j.output_data) && ARRAY[x.url]
        AND j.created_at >= coalesce(x.since, '-infinity'::timestamptz)
    )
$$;

REVOKE ALL ON FUNCTION public.jsonb_with_strings_nulled(jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.jsonb_with_strings_nulled(jsonb, text[]) TO service_role;
REVOKE ALL ON FUNCTION public.blank_job_output_urls(text[], integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.blank_job_output_urls(text[], integer) TO service_role;
REVOKE ALL ON FUNCTION public.mark_job_outputs_cleaned(uuid[], text[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_job_outputs_cleaned(uuid[], text[]) TO service_role;
REVOKE ALL ON FUNCTION public.urls_linked_by_jobs_since(text[], timestamptz[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.urls_linked_by_jobs_since(text[], timestamptz[]) TO service_role;

CREATE INDEX IF NOT EXISTS idx_jobs_output_urls
  ON public.jobs USING gin (public.job_output_urls(output_data))
  WHERE output_data IS NOT NULL;
