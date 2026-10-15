-- ============================================================================
-- Behavioral proof: outbound webhooks (migration 521).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000052101 upward).
--
-- What it pins:
--   1. Both tables are service-role only (RLS on, no policies, no grants), the
--      plaintext secret column is gone, and the dispatcher's functions are not
--      callable by the API roles.
--   2. The capture on `jobs`: an event is recorded when a job's status moves
--      INTO completed or failed — never for pending_review (only once approval
--      completes it), never for cancelled, never twice for a re-written status,
--      never for a user with no endpoint, never for a job the jobs list hides
--      (a Component's inner run, a use-case node's hidden run) — and only for
--      active endpoints subscribed to that event. A job inserted already
--      finished counts.
--   3. An endpoint a connected app registered receives only that app's own
--      jobs, and only while the account's grant to the app is live.
--   4. The capture can never fail the job's own write (and its insert runs
--      under a short lock_timeout, so it cannot hold the write waiting).
--   5. Owner-only in the database: a delivery belongs to its endpoint's owner
--      and carries only that owner's job; at most 10 endpoints per account in
--      an environment; one endpoint per address, per account and environment.
--   6. The claim: one environment's endpoints only, a lease that keeps a
--      claimed row from being claimed again, at most N in flight per endpoint
--      and per account across claims, every waiting endpoint considered by
--      every claim (no backlog, however long, keeps another account out), and
--      the rows that must not be sent closed and reported: a switched-off
--      endpoint's queue (a test ping still goes), a revoked app's, a delivery
--      whose attempts ran out.
--   7. Recording an outcome: compare-and-set on the attempt, the lease ended,
--      the body kept until delivered, the failure streak and the automatic
--      switch-off, a ping counting for nothing; a deferral (the platform's
--      failure) giving the attempt back and counting nothing; the circuit
--      breaker resting an endpoint that does not answer; a rotation's grace,
--      the replaced secret signing beside the new one until it ends.
--   8. Deleting a job takes its data out of the log; the prune keeps 30 days;
--      deleting the account removes everything in one statement.
--
-- Run locally: see the header of collections.behavior.sql (same steps).
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, actual text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual, '<null>'), coalesce(expected, '<null>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- Runs `stmt` and passes only if it is refused with SQLSTATE `state`.
CREATE FUNCTION pg_temp.assert_refused(label text, stmt text, state text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE got text := NULL;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    got := SQLSTATE;
  END;
  IF got IS DISTINCT FROM state THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: expected SQLSTATE % got %', label, state, coalesce(got, 'success');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- How many deliveries a job has, as "<endpoint label>:<event>" sorted.
CREATE FUNCTION pg_temp.deliveries_of(p_job uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(w.description || ':' || d.event, ',' ORDER BY w.description, d.event), '')
    FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
   WHERE d.job_id = p_job
$$;

-- A = owner, B = stranger (and a developer).
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000052101', 'wh-owner@wh.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000052102', 'wh-stranger@wh.test', '{}', 'authenticated', 'authenticated');

-- Two connected apps; A granted the first one jobs:read.
INSERT INTO developer_apps (id, owner_user_id, name, redirect_uris, client_id, client_secret_hash) VALUES
  ('00000000-0000-4000-8000-000000052111', '00000000-0000-4000-8000-000000052102', 'Hooks app',  ARRAY['https://hooks.test/cb'], 'app_wh_one', 'x'),
  ('00000000-0000-4000-8000-000000052112', '00000000-0000-4000-8000-000000052102', 'Other app',  ARRAY['https://other.test/cb'], 'app_wh_two', 'x');
INSERT INTO developer_app_authorizations (app_id, user_id, scopes_granted) VALUES
  ('00000000-0000-4000-8000-000000052111', '00000000-0000-4000-8000-000000052101', ARRAY['jobs:read']);

-- A's endpoints. The description is the label the assertions read.
INSERT INTO webhooks (id, user_id, url, events, is_active, runtime_env, secret_ciphertext, secret_created_at, app_id, description) VALUES
  ('00000000-0000-4000-8000-000000052121', '00000000-0000-4000-8000-000000052101', 'https://a.test/all',    ARRAY['job.completed','job.failed'], true,  'production', 'sealed', now(), NULL, 'e1'),
  ('00000000-0000-4000-8000-000000052122', '00000000-0000-4000-8000-000000052101', 'https://a.test/failed', ARRAY['job.failed'],                 true,  'production', 'sealed', now(), NULL, 'e2'),
  ('00000000-0000-4000-8000-000000052123', '00000000-0000-4000-8000-000000052101', 'https://a.test/paused', ARRAY['job.completed','job.failed'], false, 'production', 'sealed', now(), NULL, 'e3'),
  ('00000000-0000-4000-8000-000000052124', '00000000-0000-4000-8000-000000052101', 'https://app.test/in',   ARRAY['job.completed','job.failed'], true,  'production', 'sealed', now(),
     '00000000-0000-4000-8000-000000052111', 'e4'),
  ('00000000-0000-4000-8000-000000052125', '00000000-0000-4000-8000-000000052101', 'https://a.test/stage',  ARRAY['job.completed','job.failed'], true,  'staging',    'sealed', now(), NULL, 'e5');

-- 1. Shape.
SELECT pg_temp.assert_eq('row level security is enabled on webhooks',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.webhooks'::regclass), 'true');
SELECT pg_temp.assert_eq('row level security is enabled on webhook_deliveries',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.webhook_deliveries'::regclass), 'true');
SELECT pg_temp.assert_eq('no policy of any kind on either table (the 001 / 032 client policies are gone)',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('webhooks', 'webhook_deliveries')), '0');
SELECT pg_temp.assert_eq('authenticated holds no privilege on webhooks',
  (has_table_privilege('authenticated', 'public.webhooks', 'SELECT')
   OR has_table_privilege('authenticated', 'public.webhooks', 'INSERT')
   OR has_table_privilege('authenticated', 'public.webhooks', 'UPDATE')
   OR has_table_privilege('authenticated', 'public.webhooks', 'DELETE'))::text, 'false');
SELECT pg_temp.assert_eq('authenticated holds no privilege on webhook_deliveries',
  (has_table_privilege('authenticated', 'public.webhook_deliveries', 'SELECT')
   OR has_table_privilege('authenticated', 'public.webhook_deliveries', 'INSERT')
   OR has_table_privilege('authenticated', 'public.webhook_deliveries', 'UPDATE')
   OR has_table_privilege('authenticated', 'public.webhook_deliveries', 'DELETE'))::text, 'false');
SELECT pg_temp.assert_eq('anon holds no SELECT on either table',
  (has_table_privilege('anon', 'public.webhooks', 'SELECT')
   OR has_table_privilege('anon', 'public.webhook_deliveries', 'SELECT'))::text, 'false');
SELECT pg_temp.assert_eq('the plaintext secret column no longer exists',
  (SELECT count(*)::text FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'webhooks' AND column_name = 'secret'), '0');
SELECT pg_temp.assert_eq('the API roles cannot run the dispatcher''s functions',
  (has_function_privilege('authenticated', 'public.claim_webhook_deliveries(text,integer,integer,integer,integer,integer)', 'EXECUTE')
   OR has_function_privilege('anon', 'public.claim_webhook_deliveries(text,integer,integer,integer,integer,integer)', 'EXECUTE')
   OR has_function_privilege('authenticated', 'public.record_webhook_delivery_attempt(uuid,integer,text,timestamptz,jsonb,integer,text,integer,text,integer,integer)', 'EXECUTE')
   OR has_function_privilege('anon', 'public.record_webhook_delivery_attempt(uuid,integer,text,timestamptz,jsonb,integer,text,integer,text,integer,integer)', 'EXECUTE')
   OR has_function_privilege('authenticated', 'public.prune_webhook_deliveries(integer,integer)', 'EXECUTE')
   OR has_function_privilege('anon', 'public.prune_webhook_deliveries(integer,integer)', 'EXECUTE')
   OR has_function_privilege('authenticated', 'public.webhook_endpoints_waiting(uuid,integer)', 'EXECUTE')
   OR has_function_privilege('anon', 'public.webhook_endpoints_waiting(uuid,integer)', 'EXECUTE')
   OR has_function_privilege('authenticated', 'public.rotate_webhook_secret(uuid,uuid,text,text,timestamptz)', 'EXECUTE')
   OR has_function_privilege('anon', 'public.rotate_webhook_secret(uuid,uuid,text,text,timestamptz)', 'EXECUTE'))::text, 'false');
SELECT pg_temp.assert_eq('the service role can run them',
  (has_function_privilege('service_role', 'public.claim_webhook_deliveries(text,integer,integer,integer,integer,integer)', 'EXECUTE')
   AND has_function_privilege('service_role', 'public.record_webhook_delivery_attempt(uuid,integer,text,timestamptz,jsonb,integer,text,integer,text,integer,integer)', 'EXECUTE')
   AND has_function_privilege('service_role', 'public.prune_webhook_deliveries(integer,integer)', 'EXECUTE')
   AND has_function_privilege('service_role', 'public.webhook_endpoints_waiting(uuid,integer)', 'EXECUTE')
   AND has_function_privilege('service_role', 'public.rotate_webhook_secret(uuid,uuid,text,text,timestamptz)', 'EXECUTE'))::text, 'true');
SELECT pg_temp.assert_eq('no API role can run the capture''s functions',
  (has_function_privilege('authenticated', 'public.webhooks_record_job_event(uuid,uuid,text,text,text,uuid)', 'EXECUTE')
   OR has_function_privilege('anon', 'public.webhooks_record_job_event(uuid,uuid,text,text,text,uuid)', 'EXECUTE')
   OR has_function_privilege('service_role', 'public.webhooks_record_job_event(uuid,uuid,text,text,text,uuid)', 'EXECUTE')
   OR has_function_privilege('authenticated', 'public.webhooks_capture_job_event()', 'EXECUTE')
   OR has_function_privilege('anon', 'public.webhooks_capture_job_event()', 'EXECUTE'))::text, 'false');
SELECT pg_temp.assert_eq('the capture''s insert waits on a lock for at most 200 ms',
  (SELECT array_to_string(proconfig, ',') FROM pg_proc
    WHERE oid = 'public.webhooks_record_job_event(uuid,uuid,text,text,text,uuid)'::regprocedure),
  'search_path="",lock_timeout=200ms');

-- The owner, signed in, cannot read their own endpoints (and so their
-- sealed secrets) through the API role: refused by privilege.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000052101","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000052101';
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.webhooks;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot SELECT webhooks as authenticated]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  the owner cannot SELECT webhooks as authenticated (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.webhook_deliveries;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot SELECT webhook_deliveries as authenticated]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  the owner cannot SELECT webhook_deliveries as authenticated (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    UPDATE public.webhooks SET url = 'https://attacker.test/' WHERE user_id = '00000000-0000-4000-8000-000000052101';
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot UPDATE webhooks as authenticated]: the write succeeded';
  END IF;
  RAISE NOTICE 'ok  the owner cannot UPDATE webhooks as authenticated (privilege denied)';
END $$;
RESET ROLE;

-- 2. The capture.
INSERT INTO jobs (id, user_id, status) VALUES
  ('00000000-0000-4000-8000-000000052131', '00000000-0000-4000-8000-000000052101', 'pending'),
  ('00000000-0000-4000-8000-000000052132', '00000000-0000-4000-8000-000000052101', 'processing'),
  ('00000000-0000-4000-8000-000000052133', '00000000-0000-4000-8000-000000052101', 'processing'),
  ('00000000-0000-4000-8000-000000052134', '00000000-0000-4000-8000-000000052101', 'processing'),
  ('00000000-0000-4000-8000-000000052135', '00000000-0000-4000-8000-000000052102', 'processing');

UPDATE jobs SET status = 'processing' WHERE id = '00000000-0000-4000-8000-000000052131';
SELECT pg_temp.assert_eq('pending -> processing records nothing',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052131'), '');

UPDATE jobs SET status = 'completed' WHERE id = '00000000-0000-4000-8000-000000052131';
SELECT pg_temp.assert_eq('processing -> completed: each active endpoint subscribed to job.completed, every environment',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052131'), 'e1:job.completed,e5:job.completed');

UPDATE jobs SET status = 'completed', progress = 100 WHERE id = '00000000-0000-4000-8000-000000052131';
SELECT pg_temp.assert_eq('re-writing the same status records nothing more',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052131'), 'e1:job.completed,e5:job.completed');

UPDATE jobs SET status = 'failed' WHERE id = '00000000-0000-4000-8000-000000052132';
SELECT pg_temp.assert_eq('processing -> failed: the endpoints subscribed to job.failed',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052132'), 'e1:job.failed,e2:job.failed,e5:job.failed');

UPDATE jobs SET status = 'pending_review' WHERE id = '00000000-0000-4000-8000-000000052133';
SELECT pg_temp.assert_eq('a job held for review is in flight: nothing yet',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052133'), '');
UPDATE jobs SET status = 'completed' WHERE id = '00000000-0000-4000-8000-000000052133';
SELECT pg_temp.assert_eq('approval completes it: job.completed then',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052133'), 'e1:job.completed,e5:job.completed');

UPDATE jobs SET status = 'cancelled' WHERE id = '00000000-0000-4000-8000-000000052134';
SELECT pg_temp.assert_eq('a cancelled job records nothing',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052134'), '');

UPDATE jobs SET status = 'completed' WHERE id = '00000000-0000-4000-8000-000000052135';
SELECT pg_temp.assert_eq('a user with no endpoint: nothing, and the job completes',
  (SELECT count(*)::text FROM webhook_deliveries WHERE job_id = '00000000-0000-4000-8000-000000052135')
    || '/' || (SELECT status FROM jobs WHERE id = '00000000-0000-4000-8000-000000052135'), '0/completed');

INSERT INTO jobs (id, user_id, status) VALUES
  ('00000000-0000-4000-8000-000000052136', '00000000-0000-4000-8000-000000052101', 'completed');
SELECT pg_temp.assert_eq('a job inserted already finished records its event',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052136'), 'e1:job.completed,e5:job.completed');

SELECT pg_temp.assert_eq('a recorded delivery is the owner''s, pending, due, unsent, with no body yet',
  (SELECT string_agg(DISTINCT (d.user_id = '00000000-0000-4000-8000-000000052101')::text || '/' || d.status || '/'
                     || d.attempts::text || '/' || (d.payload IS NULL)::text || '/' || (d.next_retry_at IS NOT NULL)::text, ',')
     FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
    WHERE w.user_id IN ('00000000-0000-4000-8000-000000052101', '00000000-0000-4000-8000-000000052102')),
  'true/pending/0/true/true');

-- 2b. A job the jobs list does not show sends nothing: one of a Component
--     node's inner run, one of a use-case node's hidden run (GET /v1/jobs's
--     rule). A job of an ordinary run does.
INSERT INTO projects (id, user_id, name) VALUES
  ('00000000-0000-4000-8000-000000052171', '00000000-0000-4000-8000-000000052101', 'wh project');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('00000000-0000-4000-8000-000000052172', '00000000-0000-4000-8000-000000052171', '00000000-0000-4000-8000-000000052101', 'wh workflow');
INSERT INTO workflow_executions (id, workflow_id, user_id, status) VALUES
  ('00000000-0000-4000-8000-000000052173', '00000000-0000-4000-8000-000000052172', '00000000-0000-4000-8000-000000052101', 'running'),
  ('00000000-0000-4000-8000-000000052174', '00000000-0000-4000-8000-000000052172', '00000000-0000-4000-8000-000000052101', 'running'),
  ('00000000-0000-4000-8000-000000052175', '00000000-0000-4000-8000-000000052172', '00000000-0000-4000-8000-000000052101', 'running');
UPDATE workflow_executions SET is_component_execution = true WHERE id = '00000000-0000-4000-8000-000000052174';
UPDATE workflow_executions SET trigger_type = 'use_case' WHERE id = '00000000-0000-4000-8000-000000052175';
INSERT INTO jobs (id, user_id, status, workflow_execution_id) VALUES
  ('00000000-0000-4000-8000-000000052181', '00000000-0000-4000-8000-000000052101', 'processing', '00000000-0000-4000-8000-000000052173'),
  ('00000000-0000-4000-8000-000000052182', '00000000-0000-4000-8000-000000052101', 'processing', '00000000-0000-4000-8000-000000052174'),
  ('00000000-0000-4000-8000-000000052183', '00000000-0000-4000-8000-000000052101', 'processing', '00000000-0000-4000-8000-000000052175');
UPDATE jobs SET status = 'completed'
 WHERE id IN ('00000000-0000-4000-8000-000000052181', '00000000-0000-4000-8000-000000052182', '00000000-0000-4000-8000-000000052183');
SELECT pg_temp.assert_eq('a job of an ordinary workflow run sends its event',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052181'), 'e1:job.completed,e5:job.completed');
SELECT pg_temp.assert_eq('a job of a Component node''s inner run sends nothing (and still completes)',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052182')
    || '/' || (SELECT status FROM jobs WHERE id = '00000000-0000-4000-8000-000000052182'), '/completed');
SELECT pg_temp.assert_eq('a job of a use-case node''s hidden run sends nothing',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052183'), '');
-- Out of the way of the counts below (their deliveries close as job_deleted).
DELETE FROM jobs
 WHERE id IN ('00000000-0000-4000-8000-000000052181', '00000000-0000-4000-8000-000000052182', '00000000-0000-4000-8000-000000052183');

-- 3. An app's endpoint: only that app's own jobs, only while its grant is live.
INSERT INTO jobs (id, user_id, status, source, source_detail) VALUES
  ('00000000-0000-4000-8000-000000052137', '00000000-0000-4000-8000-000000052101', 'processing', 'app', '00000000-0000-4000-8000-000000052111'),
  ('00000000-0000-4000-8000-000000052138', '00000000-0000-4000-8000-000000052101', 'processing', 'app', '00000000-0000-4000-8000-000000052112'),
  ('00000000-0000-4000-8000-000000052139', '00000000-0000-4000-8000-000000052101', 'processing', 'app', '00000000-0000-4000-8000-000000052111');
UPDATE jobs SET status = 'completed' WHERE id = '00000000-0000-4000-8000-000000052137';
SELECT pg_temp.assert_eq('the app''s own job reaches its endpoint (and the account''s)',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052137'), 'e1:job.completed,e4:job.completed,e5:job.completed');
UPDATE jobs SET status = 'completed' WHERE id = '00000000-0000-4000-8000-000000052138';
SELECT pg_temp.assert_eq('another app''s job does not reach it',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052138'), 'e1:job.completed,e5:job.completed');
SELECT pg_temp.assert_eq('nor does the account''s own job (job 1 above)',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052131'), 'e1:job.completed,e5:job.completed');
UPDATE developer_app_authorizations SET revoked_at = now()
 WHERE app_id = '00000000-0000-4000-8000-000000052111' AND user_id = '00000000-0000-4000-8000-000000052101';
UPDATE jobs SET status = 'completed' WHERE id = '00000000-0000-4000-8000-000000052139';
SELECT pg_temp.assert_eq('once the account revokes the app, its endpoint receives nothing',
  pg_temp.deliveries_of('00000000-0000-4000-8000-000000052139'), 'e1:job.completed,e5:job.completed');

-- 4. The capture can never fail the job's own write: make every delivery
--    insert impossible, then finish a job.
ALTER TABLE webhook_deliveries ADD CONSTRAINT tmp_refuse_every_delivery CHECK (false) NOT VALID;
INSERT INTO jobs (id, user_id, status) VALUES
  ('00000000-0000-4000-8000-000000052140', '00000000-0000-4000-8000-000000052101', 'processing');
UPDATE jobs SET status = 'completed' WHERE id = '00000000-0000-4000-8000-000000052140';
SELECT pg_temp.assert_eq('the job completes even when its event cannot be recorded',
  (SELECT status FROM jobs WHERE id = '00000000-0000-4000-8000-000000052140')
    || '/' || pg_temp.deliveries_of('00000000-0000-4000-8000-000000052140'), 'completed/');
ALTER TABLE webhook_deliveries DROP CONSTRAINT tmp_refuse_every_delivery;

-- 5. Owner-only, and the cap.
SELECT pg_temp.assert_refused('a delivery cannot claim another owner than its endpoint''s',
  $s$INSERT INTO webhook_deliveries (webhook_id, user_id, event, next_retry_at)
     VALUES ('00000000-0000-4000-8000-000000052121', '00000000-0000-4000-8000-000000052102', 'ping', now())$s$, '42501');
SELECT pg_temp.assert_refused('a delivery cannot carry a stranger''s job',
  $s$INSERT INTO webhook_deliveries (webhook_id, user_id, job_id, event, next_retry_at)
     VALUES ('00000000-0000-4000-8000-000000052121', '00000000-0000-4000-8000-000000052101',
             '00000000-0000-4000-8000-000000052135', 'job.completed', now())$s$, '42501');
SELECT pg_temp.assert_refused('a pending delivery always says when it is due',
  $s$INSERT INTO webhook_deliveries (webhook_id, user_id, event)
     VALUES ('00000000-0000-4000-8000-000000052121', '00000000-0000-4000-8000-000000052101', 'ping')$s$, '23514');
SELECT pg_temp.assert_refused('an endpoint that is on must hold a secret',
  $s$INSERT INTO webhooks (user_id, url, is_active, runtime_env)
     VALUES ('00000000-0000-4000-8000-000000052102', 'https://b.test/x', true, 'production')$s$, '23514');
SELECT pg_temp.assert_refused('only the two job events can be subscribed',
  $s$INSERT INTO webhooks (user_id, url, events, runtime_env, secret_ciphertext)
     VALUES ('00000000-0000-4000-8000-000000052102', 'https://b.test/x', ARRAY['ping'], 'production', 'sealed')$s$, '23514');
-- A has four production endpoints (e1-e4) and one in staging (e5).
INSERT INTO webhooks (user_id, url, runtime_env, secret_ciphertext)
SELECT '00000000-0000-4000-8000-000000052101', 'https://a.test/more/' || n, 'production', 'sealed'
  FROM generate_series(1, 6) AS n;
SELECT pg_temp.assert_eq('ten endpoints fit in an environment',
  (SELECT count(*)::text FROM webhooks
    WHERE user_id = '00000000-0000-4000-8000-000000052101' AND runtime_env = 'production'), '10');
SELECT pg_temp.assert_refused('an eleventh there is refused (53400)',
  $s$INSERT INTO webhooks (user_id, url, runtime_env, secret_ciphertext)
     VALUES ('00000000-0000-4000-8000-000000052101', 'https://a.test/eleventh', 'production', 'sealed')$s$, '53400');
INSERT INTO webhooks (user_id, url, runtime_env, secret_ciphertext) VALUES
  ('00000000-0000-4000-8000-000000052101', 'https://a.test/more/staging', 'staging', 'sealed');
SELECT pg_temp.assert_eq('... while another environment counts its own (the list a user sees is the limit they meet)',
  (SELECT count(*)::text FROM webhooks
    WHERE user_id = '00000000-0000-4000-8000-000000052101' AND runtime_env = 'staging'), '2');
DELETE FROM webhooks WHERE url LIKE 'https://a.test/more/%';

-- One endpoint per address, per account (or connected app) and environment.
SELECT pg_temp.assert_refused('a second endpoint on an address the account already uses here is refused (23505)',
  $s$INSERT INTO webhooks (user_id, url, runtime_env, secret_ciphertext)
     VALUES ('00000000-0000-4000-8000-000000052101', 'https://a.test/all', 'production', 'sealed')$s$, '23505');
INSERT INTO webhooks (user_id, url, runtime_env, secret_ciphertext, is_active, app_id, description) VALUES
  ('00000000-0000-4000-8000-000000052101', 'https://a.test/all', 'production', 'sealed', false,
   '00000000-0000-4000-8000-000000052112', 'same-address-app'),
  ('00000000-0000-4000-8000-000000052101', 'https://a.test/all', 'staging', 'sealed', false, NULL, 'same-address-env');
INSERT INTO webhooks (user_id, url, is_active, description) VALUES
  ('00000000-0000-4000-8000-000000052102', 'https://b.test/old', false, 'legacy-1'),
  ('00000000-0000-4000-8000-000000052102', 'https://b.test/old', false, 'legacy-2');
SELECT pg_temp.assert_eq('... while a connected app''s, another environment''s and rows older than 521 are their own',
  (SELECT count(*)::text FROM webhooks
    WHERE description IN ('same-address-app', 'same-address-env', 'legacy-1', 'legacy-2')), '4');
SELECT pg_temp.assert_refused('... until a rotation gives them this environment: then they collide',
  $s$UPDATE webhooks SET runtime_env = 'production', secret_ciphertext = 'sealed'
      WHERE description IN ('legacy-1', 'legacy-2')$s$, '23505');
DELETE FROM webhooks WHERE description IN ('same-address-app', 'same-address-env', 'legacy-1', 'legacy-2');

-- 6. The claim. Due now for production: e1 x7 (jobs 1, 2, 3, 6, 7, 8, 9),
--    e2 x1 (job 2), e4 x1 (job 7, for the app whose grant section 3
--    revoked). Staging (e5) has its own seven.
SELECT pg_temp.assert_eq('production has nine due deliveries before any claim',
  (SELECT count(*)::text FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
    WHERE w.runtime_env = 'production' AND d.status = 'pending' AND d.user_id = '00000000-0000-4000-8000-000000052101'), '9');

CREATE TEMP TABLE claim1 AS
  SELECT * FROM claim_webhook_deliveries('production', 25, 5, 60);
SELECT pg_temp.assert_eq('a claim takes this environment''s deliveries only, at most five per endpoint',
  (SELECT string_agg(label || '=' || n, ',' ORDER BY label) FROM (
     SELECT w.description AS label, count(*)::text AS n
       FROM claim1 c JOIN webhooks w ON w.id = c.webhook_id
      WHERE c.closed_reason IS NULL GROUP BY w.description) x), 'e1=5,e2=1');
SELECT pg_temp.assert_eq('the revoked app''s delivery is closed instead of sent, and the claim says so',
  (SELECT string_agg(w.description || ':' || c.closed_reason || '/' || (c.url IS NULL)::text
                     || '/' || (c.secret_ciphertext IS NULL)::text, ',')
     FROM claim1 c JOIN webhooks w ON w.id = c.webhook_id WHERE c.closed_reason IS NOT NULL),
  'e4:app_revoked/true/true');
SELECT pg_temp.assert_eq('... it ends with no body and no lease',
  (SELECT d.status || '/' || d.last_error || '/' || (d.payload IS NULL)::text || '/'
          || (d.next_retry_at IS NULL)::text || '/' || (d.lease_until IS NULL)::text
     FROM webhook_deliveries d JOIN claim1 c ON c.delivery_id = d.id WHERE c.closed_reason IS NOT NULL),
  'failed/app_revoked/true/true/true');
SELECT pg_temp.assert_eq('the claim hands back what the sender needs and counts the attempt',
  (SELECT string_agg(DISTINCT c.attempts::text || '/' || (c.url LIKE 'https://%')::text || '/' || c.secret_ciphertext
                     || '/' || c.runtime_env, ',') FROM claim1 c WHERE c.closed_reason IS NULL), '1/true/sealed/production');
SELECT pg_temp.assert_eq('a claimed row is leased about a minute ahead, and due again when the lease ends',
  (SELECT bool_and(d.lease_until > clock_timestamp() + interval '50 seconds'
                   AND d.lease_until < clock_timestamp() + interval '70 seconds'
                   AND d.next_retry_at = d.lease_until)::text
     FROM webhook_deliveries d JOIN claim1 c ON c.delivery_id = d.id WHERE c.closed_reason IS NULL), 'true');

CREATE TEMP TABLE claim2 AS
  SELECT * FROM claim_webhook_deliveries('production', 25, 5, 60);
SELECT pg_temp.assert_eq('while five of e1''s deliveries are in flight, a second claim leaves its other two waiting (and takes no leased row)',
  (SELECT count(*)::text FROM claim2)
    || '/' || (SELECT count(*)::text FROM webhook_deliveries
                WHERE webhook_id = '00000000-0000-4000-8000-000000052121' AND status = 'pending'
                  AND lease_until IS NULL AND next_retry_at <= clock_timestamp()), '0/2');
SELECT pg_temp.assert_eq('staging claims its own seven',
  (SELECT count(*)::text FROM claim_webhook_deliveries('staging', 25, 10, 60) WHERE closed_reason IS NULL), '7');

-- A switched-off endpoint: its waiting deliveries end; a test ping still goes.
UPDATE webhooks SET is_active = false WHERE description = 'e2';
UPDATE webhook_deliveries SET next_retry_at = now() - interval '1 second'
 WHERE webhook_id = '00000000-0000-4000-8000-000000052122';
INSERT INTO webhook_deliveries (id, webhook_id, user_id, event, next_retry_at) VALUES
  ('00000000-0000-4000-8000-000000052151', '00000000-0000-4000-8000-000000052123',
   '00000000-0000-4000-8000-000000052101', 'ping', now() - interval '1 second');
CREATE TEMP TABLE claim3 AS
  SELECT * FROM claim_webhook_deliveries('production', 25, 5, 60);
SELECT pg_temp.assert_eq('the switched-off endpoint''s delivery is closed, not sent',
  (SELECT status || '/' || last_error || '/' || (next_retry_at IS NULL)::text || '/' || (lease_until IS NULL)::text
     FROM webhook_deliveries WHERE webhook_id = '00000000-0000-4000-8000-000000052122'),
  'failed/endpoint_disabled/true/true');
SELECT pg_temp.assert_eq('... and the claim says so',
  (SELECT string_agg(c.closed_reason, ',') FROM claim3 c
    WHERE c.webhook_id = '00000000-0000-4000-8000-000000052122'), 'endpoint_disabled');
SELECT pg_temp.assert_eq('a test ping to a paused endpoint is claimed',
  (SELECT string_agg(delivery_id::text, ',') FROM claim3 WHERE closed_reason IS NULL), '00000000-0000-4000-8000-000000052151');

-- A delivery that has spent every attempt, its last one never recorded (the
-- sender died mid-send), is closed rather than claimed a ninth time.
INSERT INTO webhooks (id, user_id, url, runtime_env, secret_ciphertext, description) VALUES
  ('00000000-0000-4000-8000-000000052126', '00000000-0000-4000-8000-000000052101', 'https://a.test/sixth', 'production', 'sealed', 'e6');
INSERT INTO webhook_deliveries (id, webhook_id, user_id, job_id, event, attempts, next_retry_at, payload) VALUES
  ('00000000-0000-4000-8000-000000052152', '00000000-0000-4000-8000-000000052126',
   '00000000-0000-4000-8000-000000052101', '00000000-0000-4000-8000-000000052137', 'job.completed', 8,
   now() - interval '1 second', to_jsonb('{"id":"last"}'::text));
CREATE TEMP TABLE claim4 AS
  SELECT * FROM claim_webhook_deliveries('production', 25, 5, 60, 8);
SELECT pg_temp.assert_eq('a delivery with every attempt spent is not claimed again: it is closed, and the claim says so',
  (SELECT string_agg(coalesce(c.closed_reason, 'SENT'), ',') FROM claim4 c), 'attempts_exhausted');
SELECT pg_temp.assert_eq('... keeping the body of its last attempt, like any final failure',
  (SELECT status || '/' || last_error || '/' || (next_retry_at IS NULL)::text || '/' || (payload #>> '{}')
     FROM webhook_deliveries WHERE id = '00000000-0000-4000-8000-000000052152'), 'failed/attempts_exhausted/true/{"id":"last"}');
DELETE FROM webhooks WHERE description = 'e6';

-- 6b. Fairness, in an environment of its own. C has two endpoints with five
--     deliveries in flight each (its whole share) and ten more waiting since
--     long ago; D has two waiting since a minute ago; E has three endpoints
--     and nothing in flight.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000052103', 'wh-busy@wh.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000052104', 'wh-quiet@wh.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000052105', 'wh-wide@wh.test',  '{}', 'authenticated', 'authenticated');
INSERT INTO webhooks (id, user_id, url, runtime_env, secret_ciphertext, description) VALUES
  ('00000000-0000-4000-8000-000000052161', '00000000-0000-4000-8000-000000052103', 'https://c.test/1', 'fair', 'sealed', 'c1'),
  ('00000000-0000-4000-8000-000000052162', '00000000-0000-4000-8000-000000052103', 'https://c.test/2', 'fair', 'sealed', 'c2'),
  ('00000000-0000-4000-8000-000000052163', '00000000-0000-4000-8000-000000052104', 'https://d.test/1', 'fair', 'sealed', 'd1'),
  ('00000000-0000-4000-8000-000000052164', '00000000-0000-4000-8000-000000052105', 'https://x.test/1', 'fair', 'sealed', 'x1'),
  ('00000000-0000-4000-8000-000000052165', '00000000-0000-4000-8000-000000052105', 'https://x.test/2', 'fair', 'sealed', 'x2'),
  ('00000000-0000-4000-8000-000000052166', '00000000-0000-4000-8000-000000052105', 'https://x.test/3', 'fair', 'sealed', 'x3');
INSERT INTO webhook_deliveries (webhook_id, user_id, event, attempts, next_retry_at, lease_until)
SELECT e.id, e.user_id, 'job.failed', 1, now() + interval '60 seconds', now() + interval '60 seconds'
  FROM webhooks e CROSS JOIN generate_series(1, 5)
 WHERE e.description IN ('c1', 'c2');
INSERT INTO webhook_deliveries (webhook_id, user_id, event, next_retry_at)
SELECT e.id, e.user_id, 'job.failed', now() - interval '10 minutes' - make_interval(secs => n)
  FROM webhooks e CROSS JOIN generate_series(1, 5) AS n
 WHERE e.description IN ('c1', 'c2');
INSERT INTO webhook_deliveries (webhook_id, user_id, event, next_retry_at)
SELECT e.id, e.user_id, 'job.failed', now() - interval '1 minute'
  FROM webhooks e CROSS JOIN generate_series(1, 2)
 WHERE e.description = 'd1';

CREATE FUNCTION pg_temp.claimed_by_endpoint(p_claim text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE out text;
BEGIN
  EXECUTE format(
    'SELECT coalesce(string_agg(label || ''='' || n, '','' ORDER BY label), '''') FROM (
       SELECT w.description AS label, count(*)::text AS n FROM %I c JOIN webhooks w ON w.id = c.webhook_id
        WHERE c.closed_reason IS NULL GROUP BY w.description) x', p_claim) INTO out;
  RETURN out;
END $$;

CREATE TEMP TABLE fair1 AS
  SELECT * FROM claim_webhook_deliveries('fair', 25, 5, 60, 8, 10);
SELECT pg_temp.assert_eq('an account at its in-flight limit is left out: its older backlog does not hold up another account',
  pg_temp.claimed_by_endpoint('fair1'), 'd1=2');

-- Three of c1's five finish: c1 has room for three, and so does C.
SELECT pg_temp.assert_eq('an outcome ends the lease (three of c1''s deliveries delivered)',
  (SELECT string_agg(record_webhook_delivery_attempt(d.id, 1, 'delivered'), ',')
     FROM (SELECT id FROM webhook_deliveries
            WHERE webhook_id = '00000000-0000-4000-8000-000000052161' AND lease_until IS NOT NULL
            ORDER BY id LIMIT 3) d), 'delivered,delivered,delivered');
CREATE TEMP TABLE fair2 AS
  SELECT * FROM claim_webhook_deliveries('fair', 25, 5, 60, 8, 10);
SELECT pg_temp.assert_eq('a claim fills only the room what is in flight leaves: three of c1''s, none of c2''s',
  pg_temp.claimed_by_endpoint('fair2'), 'c1=3');

-- E, with nothing in flight, can fill fifteen places by endpoint but only ten by account.
INSERT INTO webhook_deliveries (webhook_id, user_id, event, next_retry_at)
SELECT e.id, e.user_id, 'job.completed', now() - make_interval(secs => n)
  FROM webhooks e CROSS JOIN generate_series(1, 5) AS n
 WHERE e.description IN ('x1', 'x2', 'x3');
CREATE TEMP TABLE fair3 AS
  SELECT * FROM claim_webhook_deliveries('fair', 25, 5, 60, 8, 10);
SELECT pg_temp.assert_eq('one claim gives an account at most its own share, whatever room its endpoints have',
  (SELECT count(*)::text || '/' || (max(n) <= 5)::text FROM (
     SELECT c.webhook_id, count(*) AS n FROM fair3 c WHERE c.closed_reason IS NULL GROUP BY c.webhook_id) x)
    || '/' || (SELECT count(*)::text FROM fair3 WHERE closed_reason IS NULL), '3/true/10');

-- F has a backlog longer than any window, older than everything else and with
-- nothing in flight; G has one event, newer. One claim serves both.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000052106', 'wh-flood@wh.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000052107', 'wh-calm@wh.test',  '{}', 'authenticated', 'authenticated');
INSERT INTO webhooks (id, user_id, url, runtime_env, secret_ciphertext, description) VALUES
  ('00000000-0000-4000-8000-000000052167', '00000000-0000-4000-8000-000000052106', 'https://f.test/1', 'flood', 'sealed', 'f1'),
  ('00000000-0000-4000-8000-000000052168', '00000000-0000-4000-8000-000000052107', 'https://g.test/1', 'flood', 'sealed', 'g1');
INSERT INTO webhook_deliveries (webhook_id, user_id, event, next_retry_at)
SELECT '00000000-0000-4000-8000-000000052167', '00000000-0000-4000-8000-000000052106', 'job.completed',
       now() - interval '1 hour' + make_interval(secs => n)
  FROM generate_series(1, 2500) AS n;
INSERT INTO webhook_deliveries (webhook_id, user_id, event, next_retry_at) VALUES
  ('00000000-0000-4000-8000-000000052168', '00000000-0000-4000-8000-000000052107', 'job.completed', now() - interval '1 second');
CREATE TEMP TABLE flood1 AS
  SELECT * FROM claim_webhook_deliveries('flood', 25, 5, 60, 8, 10);
SELECT pg_temp.assert_eq('no backlog, however long and old, keeps another account''s event out of a claim',
  pg_temp.claimed_by_endpoint('flood1'), 'f1=5,g1=1');

-- The endpoints a claim looks at: each with something waiting, once, from
-- any starting point round to it again, as many as asked.
SELECT pg_temp.assert_eq('every endpoint with something waiting is found once, from any starting point',
  (SELECT count(*)::text || '/' || count(DISTINCT x)::text
     FROM webhook_endpoints_waiting('00000000-0000-4000-8000-000000052165', 100000) AS x)
    || '/' || ((SELECT array_agg(x ORDER BY x) FROM webhook_endpoints_waiting('00000000-0000-4000-8000-000000052165', 100000) AS x)
             = (SELECT array_agg(DISTINCT d.webhook_id ORDER BY d.webhook_id) FROM webhook_deliveries d WHERE d.status = 'pending'))::text,
  (SELECT count(DISTINCT d.webhook_id)::text || '/' || count(DISTINCT d.webhook_id)::text || '/true'
     FROM webhook_deliveries d WHERE d.status = 'pending'));
SELECT pg_temp.assert_eq('... starting at the point it is given, as many as asked',
  (SELECT string_agg(x::text, ',') FROM webhook_endpoints_waiting('00000000-0000-4000-8000-000000052165', 2) AS x),
  '00000000-0000-4000-8000-000000052165,00000000-0000-4000-8000-000000052166');

-- 7. Recording outcomes, on e1's five claimed deliveries (attempt 1 each).
--    Each call is its own statement and the row is read in the next one: a
--    statement does not see what a function it calls changed.
CREATE TEMP TABLE picked AS
  SELECT c.delivery_id, row_number() OVER (ORDER BY c.delivery_id) AS n
    FROM claim1 c WHERE c.webhook_id = '00000000-0000-4000-8000-000000052121';

SELECT pg_temp.assert_eq('a retry stays pending',
  record_webhook_delivery_attempt((SELECT delivery_id FROM picked WHERE n = 1), 1, 'retry',
    clock_timestamp() + interval '30 seconds', to_jsonb('{"id":"first"}'::text), 503, 'busy', 120, 'http_503', 50), 'pending');
SELECT pg_temp.assert_eq('... keeping the body sent, the answer and when it is due again, its lease over',
  (SELECT status || '/' || response_status::text || '/' || response_body || '/'
          || duration_ms::text || '/' || last_error || '/' || (next_retry_at > clock_timestamp())::text
          || '/' || (lease_until IS NULL)::text
     FROM webhook_deliveries WHERE id = (SELECT delivery_id FROM picked WHERE n = 1)),
  'pending/503/busy/120/http_503/true/true');
-- The body is kept as the exact text that was sent (a JSON string, never a
-- re-encoded object), so a retry sends those same bytes again.
SELECT pg_temp.assert_eq('... the kept body is the exact text sent',
  (SELECT jsonb_typeof(payload) || '/' || (payload #>> '{}')
     FROM webhook_deliveries WHERE id = (SELECT delivery_id FROM picked WHERE n = 1)),
  'string/{"id":"first"}');
SELECT pg_temp.assert_eq('an outcome for an attempt that is not the current one changes nothing',
  coalesce(record_webhook_delivery_attempt((SELECT delivery_id FROM picked WHERE n = 1), 7, 'delivered'), '<null>'), '<null>');
SELECT pg_temp.assert_eq('a second outcome for the same attempt applies',
  record_webhook_delivery_attempt((SELECT delivery_id FROM picked WHERE n = 1), 1, 'retry',
    clock_timestamp() + interval '2 minutes', to_jsonb('{"id":"second"}'::text), 500, NULL, 80, 'http_500', 50), 'pending');
SELECT pg_temp.assert_eq('... but never replaces the body kept from the first',
  (SELECT payload #>> '{}' FROM webhook_deliveries WHERE id = (SELECT delivery_id FROM picked WHERE n = 1)), '{"id":"first"}');

UPDATE webhooks SET consecutive_failures = 3 WHERE description = 'e1';
SELECT pg_temp.assert_eq('a delivery is recorded as delivered',
  record_webhook_delivery_attempt((SELECT delivery_id FROM picked WHERE n = 1), 1, 'delivered',
    NULL, NULL, 204, '', 95, NULL, 50), 'delivered');
SELECT pg_temp.assert_eq('... drops its kept body and is stamped',
  (SELECT (payload IS NULL)::text || '/' || (delivered_at IS NOT NULL)::text || '/' || (next_retry_at IS NULL)::text
     FROM webhook_deliveries WHERE id = (SELECT delivery_id FROM picked WHERE n = 1)), 'true/true/true');
SELECT pg_temp.assert_eq('... and resets the endpoint''s failure streak',
  (SELECT consecutive_failures::text FROM webhooks WHERE description = 'e1'), '0');

UPDATE webhooks SET consecutive_failures = 48 WHERE description = 'e1';
SELECT pg_temp.assert_eq('a final failure is recorded as failed',
  record_webhook_delivery_attempt((SELECT delivery_id FROM picked WHERE n = 2), 1, 'failed',
    NULL, to_jsonb('{"id":"kept"}'::text), 410, 'gone', 50, 'http_410', 50), 'failed');
SELECT pg_temp.assert_eq('... counts against the endpoint, still on below the threshold',
  (SELECT consecutive_failures::text || '/' || is_active::text FROM webhooks WHERE description = 'e1'), '49/true');
SELECT pg_temp.assert_eq('... and keeps the body it failed with',
  (SELECT payload #>> '{}' FROM webhook_deliveries WHERE id = (SELECT delivery_id FROM picked WHERE n = 2)), '{"id":"kept"}');
SELECT pg_temp.assert_eq('the failure that reaches the threshold',
  record_webhook_delivery_attempt((SELECT delivery_id FROM picked WHERE n = 3), 1, 'failed',
    NULL, NULL, NULL, NULL, 10000, 'timeout', 50), 'failed');
SELECT pg_temp.assert_eq('... switches the endpoint off, with the reason',
  (SELECT consecutive_failures::text || '/' || is_active::text || '/' || disabled_reason || '/'
          || (disabled_at IS NOT NULL)::text FROM webhooks WHERE description = 'e1'),
  '50/false/consecutive_failures/true');
SELECT pg_temp.assert_eq('a skipped delivery is closed',
  record_webhook_delivery_attempt((SELECT delivery_id FROM picked WHERE n = 4), 1, 'skipped',
    NULL, to_jsonb('{"id":"never"}'::text), NULL, NULL, NULL, 'job_deleted', 50), 'failed');
SELECT pg_temp.assert_eq('... keeps no body and counts nothing',
  (SELECT (payload IS NULL)::text FROM webhook_deliveries WHERE id = (SELECT delivery_id FROM picked WHERE n = 4))
    || '/' || (SELECT consecutive_failures::text FROM webhooks WHERE description = 'e1'), 'true/50');
SELECT pg_temp.assert_eq('a test ping''s failure is recorded',
  record_webhook_delivery_attempt('00000000-0000-4000-8000-000000052151', 1, 'failed',
    NULL, NULL, 500, NULL, 30, 'http_500', 1), 'failed');
SELECT pg_temp.assert_eq('... and counts for nothing, even with a threshold of one',
  (SELECT consecutive_failures::text || '/' || is_active::text || '/' || coalesce(disabled_reason, 'none')
     FROM webhooks WHERE description = 'e3'), '0/false/none');
SELECT pg_temp.assert_refused('an unknown outcome is refused',
  $s$SELECT record_webhook_delivery_attempt('00000000-0000-4000-8000-000000052151', 1, 'maybe')$s$, '22023');

-- 7b. An attempt the platform could not make (the job unreadable, the secret
--     not openable) is deferred: the attempt is given back, nothing counts
--     against the endpoint, and the delivery is due again later.
INSERT INTO webhooks (id, user_id, url, runtime_env, secret_ciphertext, description) VALUES
  ('00000000-0000-4000-8000-000000052191', '00000000-0000-4000-8000-000000052102', 'https://b.test/one', 'production', 'sealed', 'b1'),
  ('00000000-0000-4000-8000-000000052193', '00000000-0000-4000-8000-000000052102', 'https://b.test/two', 'production', 'sealed', 'b2');
INSERT INTO webhook_deliveries (id, webhook_id, user_id, event, attempts, next_retry_at, lease_until) VALUES
  ('00000000-0000-4000-8000-000000052192', '00000000-0000-4000-8000-000000052191', '00000000-0000-4000-8000-000000052102',
   'job.failed', 3, now() + interval '60 seconds', now() + interval '60 seconds');
SELECT pg_temp.assert_eq('a deferred attempt stays pending',
  record_webhook_delivery_attempt('00000000-0000-4000-8000-000000052192', 3, 'deferred',
    clock_timestamp() + interval '5 minutes', NULL, NULL, NULL, NULL, 'signing_unavailable', 50, 5), 'pending');
SELECT pg_temp.assert_eq('... gives its attempt back, ends its lease, waits, and says why',
  (SELECT attempts::text || '/' || (lease_until IS NULL)::text || '/'
          || (next_retry_at > clock_timestamp() + interval '4 minutes')::text || '/' || last_error
     FROM webhook_deliveries WHERE id = '00000000-0000-4000-8000-000000052192'), '2/true/true/signing_unavailable');
SELECT pg_temp.assert_eq('... and counts nothing against the endpoint',
  (SELECT consecutive_failures::text || '/' || circuit_failures::text FROM webhooks
    WHERE id = '00000000-0000-4000-8000-000000052191'), '0/0');
SELECT pg_temp.assert_eq('a late outcome for the attempt it gave back changes nothing',
  coalesce(record_webhook_delivery_attempt('00000000-0000-4000-8000-000000052192', 3, 'delivered'), '<null>'), '<null>');
SELECT pg_temp.assert_refused('a deferral says when the delivery is due again',
  $s$SELECT record_webhook_delivery_attempt('00000000-0000-4000-8000-000000052192', 2, 'deferred')$s$, '22023');

-- 7c. The circuit breaker. Attempts that get no HTTP answer at all count;
--     every fifth rests the endpoint (a minute, then twice as long each time,
--     an hour at most); any HTTP answer closes it again. While it rests its
--     deliveries wait, attempts unspent; a test ping still goes.
INSERT INTO webhook_deliveries (id, webhook_id, user_id, event, attempts, next_retry_at, lease_until)
SELECT ('00000000-0000-4000-8000-0000000522' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-4000-8000-000000052191', '00000000-0000-4000-8000-000000052102',
       'job.failed', 1, now() + interval '60 seconds', now() + interval '60 seconds'
  FROM generate_series(1, 6) AS n;
SELECT pg_temp.assert_eq('four attempts with no answer are counted, the endpoint not yet resting',
  (SELECT string_agg(record_webhook_delivery_attempt(d.id, 1, 'retry', clock_timestamp() + interval '30 seconds',
                       NULL, NULL, NULL, 10000, 'timeout', 50, 5), ',' ORDER BY d.id)
     FROM webhook_deliveries d
    WHERE d.id IN ('00000000-0000-4000-8000-000000052201', '00000000-0000-4000-8000-000000052202',
                   '00000000-0000-4000-8000-000000052203', '00000000-0000-4000-8000-000000052204')),
  'pending,pending,pending,pending');
SELECT pg_temp.assert_eq('... (four, still open)',
  (SELECT circuit_failures::text || '/' || (circuit_open_until IS NULL)::text FROM webhooks
    WHERE id = '00000000-0000-4000-8000-000000052191'), '4/true');
SELECT pg_temp.assert_eq('the fifth...',
  record_webhook_delivery_attempt('00000000-0000-4000-8000-000000052205', 1, 'retry', clock_timestamp() + interval '30 seconds',
    NULL, NULL, NULL, 10000, 'connection_refused', 50, 5), 'pending');
SELECT pg_temp.assert_eq('... rests it for a minute',
  (SELECT circuit_failures::text || '/'
          || (circuit_open_until BETWEEN clock_timestamp() + interval '50 seconds' AND clock_timestamp() + interval '70 seconds')::text
     FROM webhooks WHERE id = '00000000-0000-4000-8000-000000052191'), '5/true');
INSERT INTO webhook_deliveries (id, webhook_id, user_id, event, next_retry_at) VALUES
  ('00000000-0000-4000-8000-000000052207', '00000000-0000-4000-8000-000000052191', '00000000-0000-4000-8000-000000052102',
   'job.failed', now() - interval '1 second'),
  ('00000000-0000-4000-8000-000000052208', '00000000-0000-4000-8000-000000052191', '00000000-0000-4000-8000-000000052102',
   'ping', now() - interval '1 second');
CREATE TEMP TABLE resting AS
  SELECT * FROM claim_webhook_deliveries('production', 25, 5, 60, 8, 10);
SELECT pg_temp.assert_eq('while it rests, its due delivery waits (attempt unspent) and a test ping still goes',
  (SELECT string_agg(r.delivery_id::text, ',') FROM resting r
    WHERE r.webhook_id = '00000000-0000-4000-8000-000000052191' AND r.closed_reason IS NULL)
    || '/' || (SELECT attempts::text FROM webhook_deliveries WHERE id = '00000000-0000-4000-8000-000000052207'),
  '00000000-0000-4000-8000-000000052208/0');
SELECT pg_temp.assert_eq('the ping''s answer is recorded (a 503: tried once, failed)',
  record_webhook_delivery_attempt('00000000-0000-4000-8000-000000052208', 1, 'failed', NULL, NULL, 503, 'not yet', 40, 'http_503', 50, 5),
  'failed');
SELECT pg_temp.assert_eq('... and any HTTP answer, a 503 included, closes the circuit',
  (SELECT circuit_failures::text || '/' || (circuit_open_until IS NULL)::text FROM webhooks WHERE id = '00000000-0000-4000-8000-000000052191'), '0/true');
CREATE TEMP TABLE reopened AS
  SELECT * FROM claim_webhook_deliveries('production', 25, 5, 60, 8, 10);
SELECT pg_temp.assert_eq('... and the waiting delivery is claimed again',
  (SELECT string_agg(r.delivery_id::text, ',') FROM reopened r
    WHERE r.webhook_id = '00000000-0000-4000-8000-000000052191' AND r.closed_reason IS NULL), '00000000-0000-4000-8000-000000052207');
UPDATE webhooks SET circuit_failures = 9 WHERE id = '00000000-0000-4000-8000-000000052191';
SELECT pg_temp.assert_eq('the tenth...',
  record_webhook_delivery_attempt('00000000-0000-4000-8000-000000052206', 1, 'retry', clock_timestamp() + interval '30 seconds',
    NULL, NULL, NULL, 10000, 'timeout', 50, 5), 'pending');
SELECT pg_temp.assert_eq('... rests it twice as long as the one before',
  (SELECT (circuit_open_until BETWEEN clock_timestamp() + interval '110 seconds' AND clock_timestamp() + interval '130 seconds')::text
     FROM webhooks WHERE id = '00000000-0000-4000-8000-000000052191'), 'true');
UPDATE webhooks SET circuit_failures = 99999 WHERE id = '00000000-0000-4000-8000-000000052191';
SELECT pg_temp.assert_eq('after a long run of them...',
  record_webhook_delivery_attempt('00000000-0000-4000-8000-000000052207', 1, 'retry', clock_timestamp() + interval '30 seconds',
    NULL, NULL, NULL, 10000, 'timeout', 50, 5), 'pending');
SELECT pg_temp.assert_eq('... a rest is an hour at most',
  (SELECT (circuit_open_until BETWEEN clock_timestamp() + interval '3590 seconds' AND clock_timestamp() + interval '3610 seconds')::text
     FROM webhooks WHERE id = '00000000-0000-4000-8000-000000052191'), 'true');

-- 7d. After a rotation the replaced secret signs beside the new one until its
--     grace ends; the prune wipes it then.
UPDATE webhooks SET previous_secret_ciphertext = 'sealed-before', previous_secret_expires_at = now() + interval '1 day'
 WHERE id = '00000000-0000-4000-8000-000000052193';
INSERT INTO webhook_deliveries (id, webhook_id, user_id, event, next_retry_at) VALUES
  ('00000000-0000-4000-8000-000000052211', '00000000-0000-4000-8000-000000052193', '00000000-0000-4000-8000-000000052102',
   'job.completed', now() - interval '1 second');
CREATE TEMP TABLE graced AS
  SELECT * FROM claim_webhook_deliveries('production', 25, 5, 60, 8, 10);
SELECT pg_temp.assert_eq('during the grace, a claimed delivery carries both secrets',
  (SELECT secret_ciphertext || '+' || previous_secret_ciphertext FROM graced
    WHERE delivery_id = '00000000-0000-4000-8000-000000052211'), 'sealed+sealed-before');
UPDATE webhooks SET previous_secret_expires_at = now() - interval '1 second'
 WHERE id = '00000000-0000-4000-8000-000000052193';
INSERT INTO webhook_deliveries (id, webhook_id, user_id, event, next_retry_at) VALUES
  ('00000000-0000-4000-8000-000000052212', '00000000-0000-4000-8000-000000052193', '00000000-0000-4000-8000-000000052102',
   'job.completed', now() - interval '1 second');
CREATE TEMP TABLE ungraced AS
  SELECT * FROM claim_webhook_deliveries('production', 25, 5, 60, 8, 10);
SELECT pg_temp.assert_eq('after it, only the new one',
  (SELECT secret_ciphertext || '+' || coalesce(previous_secret_ciphertext, 'none') FROM ungraced
    WHERE delivery_id = '00000000-0000-4000-8000-000000052212'), 'sealed+none');
SELECT pg_temp.assert_eq('the prune (nothing old enough yet)...', prune_webhook_deliveries(30, 1000)::text, '0');
SELECT pg_temp.assert_eq('... wipes a secret whose grace has passed',
  (SELECT (previous_secret_ciphertext IS NULL AND previous_secret_expires_at IS NULL)::text FROM webhooks
    WHERE id = '00000000-0000-4000-8000-000000052193'), 'true');

-- 7e. The rotation itself: the replaced secret moves aside in the database
--     (the API never reads a ciphertext), kept only when asked for, and only
--     one sealed for the same environment.
SELECT pg_temp.assert_eq('a rotation with a grace keeps the replaced secret until then',
  (rotate_webhook_secret('00000000-0000-4000-8000-000000052193', '00000000-0000-4000-8000-000000052102', 'production',
     'sealed-2', clock_timestamp() + interval '1 day') > clock_timestamp() + interval '23 hours')::text, 'true');
SELECT pg_temp.assert_eq('... (the new secret signs, the old one beside it)',
  (SELECT secret_ciphertext || '+' || previous_secret_ciphertext FROM webhooks
    WHERE id = '00000000-0000-4000-8000-000000052193'), 'sealed-2+sealed');
SELECT pg_temp.assert_eq('a rotation without one ends the replaced secret at once',
  coalesce(rotate_webhook_secret('00000000-0000-4000-8000-000000052193', '00000000-0000-4000-8000-000000052102', 'production',
     'sealed-3', NULL)::text, 'none'), 'none');
SELECT pg_temp.assert_eq('... (nothing kept)',
  (SELECT secret_ciphertext || '+' || coalesce(previous_secret_ciphertext, 'none') FROM webhooks
    WHERE id = '00000000-0000-4000-8000-000000052193'), 'sealed-3+none');
INSERT INTO webhooks (id, user_id, url, is_active, disabled_reason, disabled_at, description) VALUES
  ('00000000-0000-4000-8000-000000052194', '00000000-0000-4000-8000-000000052102', 'https://b.test/old', false,
   'legacy_secret', now(), 'b-legacy');
SELECT pg_temp.assert_eq('an endpoint older than signing gets its first secret here, keeps none, and is no longer paused for it',
  coalesce(rotate_webhook_secret('00000000-0000-4000-8000-000000052194', '00000000-0000-4000-8000-000000052102', 'production',
     'sealed-first', clock_timestamp() + interval '1 day')::text, 'none'), 'none');
SELECT pg_temp.assert_eq('... (this environment, its secret, no reason)',
  (SELECT runtime_env || '/' || secret_ciphertext || '/' || coalesce(previous_secret_ciphertext, 'none') || '/'
          || coalesce(disabled_reason, 'none') || '/' || (secret_created_at IS NOT NULL)::text
     FROM webhooks WHERE id = '00000000-0000-4000-8000-000000052194'), 'production/sealed-first/none/none/true');
SELECT pg_temp.assert_refused('a rotation for another owner finds nothing (P0002)',
  $s$SELECT rotate_webhook_secret('00000000-0000-4000-8000-000000052193', '00000000-0000-4000-8000-000000052101',
       'production', 'stolen', NULL)$s$, 'P0002');

-- 8. A deleted job takes its data out of the log.
INSERT INTO jobs (id, user_id, status) VALUES
  ('00000000-0000-4000-8000-000000052141', '00000000-0000-4000-8000-000000052101', 'processing');
UPDATE webhooks SET is_active = true, disabled_reason = NULL, disabled_at = NULL, consecutive_failures = 0
 WHERE description = 'e1';
UPDATE jobs SET status = 'failed' WHERE id = '00000000-0000-4000-8000-000000052141';
UPDATE webhook_deliveries SET payload = to_jsonb('{"id":"copy"}'::text)
 WHERE job_id = '00000000-0000-4000-8000-000000052141';
CREATE TEMP TABLE deleted_job_deliveries AS
  SELECT id FROM webhook_deliveries WHERE job_id = '00000000-0000-4000-8000-000000052141';
SELECT pg_temp.assert_eq('the job about to be deleted has deliveries with a kept body (e1 and e5)',
  (SELECT count(*)::text FROM webhook_deliveries
    WHERE id IN (SELECT id FROM deleted_job_deliveries) AND payload IS NOT NULL), '2');
DELETE FROM jobs WHERE id = '00000000-0000-4000-8000-000000052141';
SELECT pg_temp.assert_eq('deleting the job drops every kept copy and closes what was not sent',
  (SELECT string_agg(DISTINCT (job_id IS NULL)::text || '/' || (payload IS NULL)::text || '/' || status || '/' || last_error, ',')
     FROM webhook_deliveries WHERE id IN (SELECT id FROM deleted_job_deliveries)), 'true/true/failed/job_deleted');

-- The prune keeps 30 days.
UPDATE webhook_deliveries SET created_at = now() - interval '31 days'
 WHERE id = (SELECT delivery_id FROM picked WHERE n = 2);
SELECT pg_temp.assert_eq('the prune removes what is older than the window',
  prune_webhook_deliveries(30, 1000)::text, '1');
SELECT pg_temp.assert_eq('... and only that',
  (SELECT count(*)::text FROM webhook_deliveries WHERE id = (SELECT delivery_id FROM picked WHERE n = 2))
    || '/' || (SELECT (count(*) > 0)::text FROM webhook_deliveries), '0/true');

-- Deleting the account removes its endpoints and deliveries in one statement.
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000052101';
SELECT pg_temp.assert_eq('deleting the owner removes every endpoint and delivery of theirs',
  (SELECT count(*)::text FROM webhooks WHERE user_id = '00000000-0000-4000-8000-000000052101')
    || '/' || (SELECT count(*)::text FROM webhook_deliveries WHERE user_id = '00000000-0000-4000-8000-000000052101'), '0/0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
