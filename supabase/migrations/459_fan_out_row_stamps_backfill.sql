-- Server fan-out runs recorded before each row carried its own identity: give
-- their stored node state the row-aligned `listResultStamps` the editor reads on
-- reload, for EVERY node type that fans out (decided 2026-10-05).
--
-- WHY. A server fan-out now publishes `output.listResultStamps` beside
-- `output.listResults` (one `{ jobId, thumbnailUrl, quality, clipKey }` per row,
-- `{}` for a row that produced nothing — workers/fan-out-result.ts). The
-- editor's reload stamps each row's result from it, whatever the node type, and
-- for a run that has none falls back to a placeholder `exec-<node>-<n>` job id.
-- Runs recorded earlier therefore keep reloading with placeholder ids (and, on
-- an Apply EDL render, no Preview label).
--
-- THE MAPPING IS EXACT, in two passes. Nothing is ever paired by position
-- alone, and a row neither pass names stays `{}`, exactly what a live run
-- writes for a row it cannot name.
--
-- Pass 1, slot-keyed. A queued fan-out iteration's job row carries the
-- execution (`workflow_execution_id`), the node (`input_data.node_id`) and its
-- result slot (`input_data.iterationIndex` — the orchestrator writes iteration
-- i's result to `listResults[i]`; the crash-resume loader pairs them the same
-- way). A row is stamped only when exactly ONE completed job has that
-- execution, node and slot AND its output URL equals `listResults[i]`.
--
-- Pass 2, URL-keyed, for every node state pass 1 left without stamps. A
-- sync-HTTP node's job (Save to Storage, Video Composer, Motion Graphics, After
-- Effects, Lottie Overlay, 3D Title, …) is inserted by its own route: it has no
-- `workflow_execution_id` and no `iterationIndex`, only the `input_data.node_id`
-- the orchestrator stamps afterwards (node-executor.ts). Such a row is stamped
-- only when exactly ONE completed job of the execution's user (`jobs.user_id`)
-- run for that node (`input_data.node_id`) has an output URL equal to the row —
-- the rule the server applies to a saved canvas's placeholder ids when it
-- loads or saves a workflow (backend/src/lib/canvas-result-ids.ts). A URL two
-- jobs made, or that only another user's job made, names nothing.
--
-- Pass 3, single takes (decided 2026-10-05). An Apply EDL run that rendered
-- ONE take — no fan-out, or a fan-out of one row, whose primary output is that
-- row — keeps the take's stamp on its state's `output` itself (`quality`, read
-- by the app's output card and the editor's reload), not in row stamps. Runs
-- recorded before renders were labelled have none there, so their Previews
-- showed no label. The state names its job (`jobId`); the take is labelled
-- only when that job is a completed `apply-edl` job of the same execution, run
-- for that node, whose output URL is the state's `videoUrl` / `audioUrl`. It
-- writes the stamp's `quality` (and `clipKey`, which older jobs never have)
-- from the same stamp function as the rows, so a single take and a row of a
-- fan-out are labelled by one rule. A take that already carries a `quality` is
-- left as it is.
--
-- A JOB'S OUTPUT URL is the value the orchestrator put in the row
-- (output-extractor.ts `fanOutIterationValue` over `buildNodeOutputFromJobData`):
-- `imageUrl`, else `videoUrl`, else `audioUrl` — an empty string counts as
-- absent, as JS `||` reads it — else Save to Storage's `url` when its `type`
-- names a medium. Only URL rows are named: a text or JSON row (an LLM item, an
-- Edit Plan clip, a Camera Switch EDL) is never a reloaded result, and a node
-- whose worker writes its URL under another key simply matches nothing.
--
-- WHAT A STAMP HOLDS, all read from the job row (fan-out-result.ts rowStampOf):
--   jobId        jobs.id                              every type
--   thumbnailUrl output_data.thumbnailUrl, if present every type
--   quality      Apply EDL only: output_data.quality when the worker wrote it;
--                else the payload's input_data.quality by the worker's own rule
--                (lib/apply-edl-output.ts: "proxy" is a Preview, anything else
--                the final). Another node's `quality` is something else.
--   clipKey      Apply EDL only: output_data.clipKey when present. Older renders
--                were never given one and none is invented.
-- The URL and stamp rules below are mirrored by `jobOutputUrl` / `jobRowStamp`
-- in backend/src/lib/canvas-result-ids.ts; both are checked against the same
-- cases (supabase/tests/fixtures/job-row-stamps.sql).
--
-- SCOPE (passes 1 and 2). Only node states with more than one list row, at least one of them a
-- URL, and no `listResultStamps` yet, in executions that are no longer running
-- (so the orchestrator's own node_states writes are never raced), and only when
-- at least one row matched. Re-running it changes nothing.
--
-- BOUNDED. One UPDATE per (execution, node), by primary key. Pass 1 is driven
-- from the fan-out iteration jobs (the only rows that carry `iterationIndex`),
-- joined to their execution by the indexed `workflow_execution_id`. Pass 2
-- walks `workflow_executions` in id order, 500 rows per statement, keeps only
-- node states a jsonpath filter says are candidates, and reads each one's
-- user's jobs for that node once (`idx_jobs_user_id`). Both passes only read
-- until a row matched; the only locks are the stamped rows' own.
-- Pass 3 reads the completed `apply-edl` jobs that carry an execution once,
-- joined to their execution by primary key, and makes one UPDATE per labelled
-- take, by primary key.
-- `workflow_executions.updated_at` moves on a stamped row (its set_updated_at
-- trigger); freezing it would mean locking a table the orchestrator writes
-- continuously, and nothing orders runs by it. The two helper functions are
-- session temp functions, dropped at the end.
--
-- NOTICEs report, per pass, the node states visited and stamped, the rows
-- named and left `{}`, and (pass 2) the node states nothing matched at all —
-- among them the sync-HTTP types whose jobs output a plan rather than a URL.
-- A job's output URL, as the orchestrator put it in the row.
CREATE OR REPLACE FUNCTION pg_temp.mig459_job_url(output jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    nullif(output ->> 'imageUrl', ''),
    nullif(output ->> 'videoUrl', ''),
    nullif(output ->> 'audioUrl', ''),
    CASE WHEN output ->> 'type' IN ('image', 'video', 'audio') THEN nullif(output ->> 'url', '') END
  )
$$;

-- What a row's stamp holds, from the job that made it (rowStampOf).
CREATE OR REPLACE FUNCTION pg_temp.mig459_stamp(job_id uuid, job_type text, input jsonb, output jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'jobId', job_id::text,
    'thumbnailUrl', nullif(output ->> 'thumbnailUrl', ''),
    'quality', CASE WHEN job_type = 'apply-edl' THEN coalesce(
      nullif(output ->> 'quality', ''),
      CASE WHEN input ->> 'quality' = 'proxy' THEN 'proxy' ELSE 'final' END
    ) END,
    'clipKey', CASE WHEN job_type = 'apply-edl' THEN nullif(output ->> 'clipKey', '') END
  ))
$$;

-- Pass 1: slot-keyed, from the fan-out iteration jobs.
DO $$
DECLARE
  target record;
  stamps jsonb;
  matched int;
  visited int := 0;
  nodes_stamped int := 0;
  rows_named int := 0;
  rows_left int := 0;
BEGIN
  FOR target IN
    SELECT DISTINCT e.id AS execution_id, j.input_data->>'node_id' AS node_id
    FROM public.jobs j
    JOIN public.workflow_executions e ON e.id = j.workflow_execution_id
    WHERE j.workflow_execution_id IS NOT NULL
      AND j.status = 'completed'
      AND j.input_data ? 'iterationIndex'
      AND j.input_data ? 'node_id'
      AND e.status NOT IN ('pending', 'running', 'stopping')
      AND jsonb_typeof(e.node_states -> (j.input_data->>'node_id') -> 'output' -> 'listResults') = 'array'
      AND jsonb_array_length(e.node_states -> (j.input_data->>'node_id') -> 'output' -> 'listResults') > 1
      AND NOT ((e.node_states -> (j.input_data->>'node_id') -> 'output') ? 'listResultStamps')
  LOOP
    visited := visited + 1;
    SELECT
      jsonb_agg(coalesce(m.stamp, '{}'::jsonb) ORDER BY r.ord),
      count(m.stamp)
    INTO stamps, matched
    FROM public.workflow_executions e
    CROSS JOIN LATERAL jsonb_array_elements(e.node_states -> target.node_id -> 'output' -> 'listResults')
      WITH ORDINALITY AS r(url, ord)
    LEFT JOIN LATERAL (
      SELECT (array_agg(pg_temp.mig459_stamp(j.id, j.job_type, j.input_data, j.output_data)))[1] AS stamp
      FROM public.jobs j
      WHERE j.workflow_execution_id = e.id
        AND j.status = 'completed'
        AND j.input_data->>'node_id' = target.node_id
        AND j.input_data->>'iterationIndex' = (r.ord - 1)::text
        AND jsonb_typeof(r.url) = 'string'
        AND (r.url #>> '{}') LIKE 'http%'
        AND pg_temp.mig459_job_url(j.output_data) = r.url #>> '{}'
      HAVING count(*) = 1
    ) m ON true
    WHERE e.id = target.execution_id;

    IF matched > 0 THEN
      UPDATE public.workflow_executions e
      SET node_states = jsonb_set(e.node_states, ARRAY[target.node_id, 'output', 'listResultStamps'], stamps)
      WHERE e.id = target.execution_id
        AND NOT ((e.node_states -> target.node_id -> 'output') ? 'listResultStamps');
      nodes_stamped := nodes_stamped + 1;
      rows_named := rows_named + matched;
      rows_left := rows_left + jsonb_array_length(stamps) - matched;
    END IF;
  END LOOP;

  RAISE NOTICE '459 pass 1 (slot-keyed fan-out jobs): % node states visited, % stamped, % rows named, % rows left {} (no single exact job)',
    visited, nodes_stamped, rows_named, rows_left;
END $$;

-- Pass 2: URL-keyed, for every node state pass 1 left without stamps
-- (sync-HTTP fan-outs among them), 500 executions per statement.
DO $$
DECLARE
  last_id uuid := '00000000-0000-0000-0000-000000000000';
  batch uuid[];
  target record;
  stamps jsonb;
  matched int;
  visited int := 0;
  nodes_stamped int := 0;
  nodes_unmatched int := 0;
  rows_named int := 0;
  rows_left int := 0;
  rows_unmatched int := 0;
BEGIN
  LOOP
    SELECT array_agg(b.id ORDER BY b.id) INTO batch
    FROM (SELECT e.id FROM public.workflow_executions e WHERE e.id > last_id ORDER BY e.id LIMIT 500) b;
    EXIT WHEN batch IS NULL;
    last_id := batch[array_length(batch, 1)];

    FOR target IN
      SELECT e.id AS execution_id, e.user_id, ns.key AS node_id
      FROM public.workflow_executions e
      CROSS JOIN LATERAL jsonb_each(e.node_states) AS ns(key, state)
      WHERE e.id = ANY (batch)
        AND e.status NOT IN ('pending', 'running', 'stopping')
        AND e.user_id IS NOT NULL
        AND jsonb_typeof(e.node_states) = 'object'
        AND jsonb_path_exists(e.node_states,
          '$.* ? (@.output.listResults.size() > 1 && !(exists(@.output.listResultStamps)) && exists(@.output.listResults[*] ? (@ starts with "http")))')
        AND jsonb_typeof(ns.state -> 'output' -> 'listResults') = 'array'
        AND jsonb_array_length(ns.state -> 'output' -> 'listResults') > 1
        AND NOT ((ns.state -> 'output') ? 'listResultStamps')
        AND jsonb_path_exists(ns.state, '$.output.listResults[*] ? (@ starts with "http")')
    LOOP
      visited := visited + 1;
      WITH made AS (
        SELECT pg_temp.mig459_job_url(j.output_data) AS url,
          pg_temp.mig459_stamp(j.id, j.job_type, j.input_data, j.output_data) AS stamp
        FROM public.jobs j
        WHERE j.user_id = target.user_id
          AND j.status = 'completed'
          AND j.input_data->>'node_id' = target.node_id
      ),
      sole AS (
        SELECT url, (array_agg(stamp))[1] AS stamp
        FROM made
        WHERE url LIKE 'http%'
        GROUP BY url
        HAVING count(*) = 1
      )
      SELECT
        jsonb_agg(coalesce(s.stamp, '{}'::jsonb) ORDER BY r.ord),
        count(s.stamp)
      INTO stamps, matched
      FROM public.workflow_executions e
      CROSS JOIN LATERAL jsonb_array_elements(e.node_states -> target.node_id -> 'output' -> 'listResults')
        WITH ORDINALITY AS r(url, ord)
      LEFT JOIN sole s ON jsonb_typeof(r.url) = 'string' AND s.url = r.url #>> '{}'
      WHERE e.id = target.execution_id;

      IF matched > 0 THEN
        UPDATE public.workflow_executions e
        SET node_states = jsonb_set(e.node_states, ARRAY[target.node_id, 'output', 'listResultStamps'], stamps)
        WHERE e.id = target.execution_id
          AND NOT ((e.node_states -> target.node_id -> 'output') ? 'listResultStamps');
        nodes_stamped := nodes_stamped + 1;
        rows_named := rows_named + matched;
        rows_left := rows_left + jsonb_array_length(stamps) - matched;
      ELSE
        nodes_unmatched := nodes_unmatched + 1;
        rows_unmatched := rows_unmatched + jsonb_array_length(stamps);
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE '459 pass 2 (URL-keyed, sync-HTTP and other un-slotted fan-outs): % node states visited, % stamped, % rows named, % rows left {} (no single exact job)',
    visited, nodes_stamped, rows_named, rows_left;
  RAISE NOTICE '459 pass 2: % node states (% rows) matched no job at all and keep reloading with placeholder ids',
    nodes_unmatched, rows_unmatched;
END $$;

-- Pass 3: single Apply EDL takes, from the jobs their states name. Driven
-- from the completed apply-edl jobs of ended executions (the only jobs a
-- single take can name); the state's own `jobId` is the key, checked against
-- the job's execution, node and output URL.
DO $$
DECLARE
  target record;
  takes_labelled int := 0;
BEGIN
  FOR target IN
    SELECT e.id AS execution_id, j.input_data->>'node_id' AS node_id,
      pg_temp.mig459_stamp(j.id, j.job_type, j.input_data, j.output_data) AS stamp
    FROM public.jobs j
    JOIN public.workflow_executions e ON e.id = j.workflow_execution_id
    WHERE j.job_type = 'apply-edl'
      AND j.status = 'completed'
      AND j.input_data ? 'node_id'
      AND e.status NOT IN ('pending', 'running', 'stopping')
      AND e.node_states -> (j.input_data->>'node_id') ->> 'jobId' = j.id::text
      AND jsonb_typeof(e.node_states -> (j.input_data->>'node_id') -> 'output') = 'object'
      AND NOT ((e.node_states -> (j.input_data->>'node_id') -> 'output') ? 'quality')
      AND coalesce(jsonb_array_length(CASE
            WHEN jsonb_typeof(e.node_states -> (j.input_data->>'node_id') -> 'output' -> 'listResults') = 'array'
            THEN e.node_states -> (j.input_data->>'node_id') -> 'output' -> 'listResults' END), 0) <= 1
      AND pg_temp.mig459_job_url(j.output_data) IN (
            nullif(e.node_states -> (j.input_data->>'node_id') -> 'output' ->> 'videoUrl', ''),
            nullif(e.node_states -> (j.input_data->>'node_id') -> 'output' ->> 'audioUrl', ''))
  LOOP
    UPDATE public.workflow_executions e
    SET node_states = jsonb_set(e.node_states, ARRAY[target.node_id, 'output'],
      (e.node_states -> target.node_id -> 'output')
        || jsonb_strip_nulls(jsonb_build_object('quality', target.stamp -> 'quality', 'clipKey', target.stamp -> 'clipKey')))
    WHERE e.id = target.execution_id
      AND NOT ((e.node_states -> target.node_id -> 'output') ? 'quality');
    takes_labelled := takes_labelled + 1;
  END LOOP;

  RAISE NOTICE '459 pass 3 (single Apply EDL takes): % takes labelled with the quality they were ordered at', takes_labelled;
END $$;

DROP FUNCTION IF EXISTS pg_temp.mig459_stamp(uuid, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS pg_temp.mig459_job_url(jsonb);
