-- 521_outbound_webhooks.sql
--
-- Outbound webhooks (decided 2026-10-15): when one of your jobs ends —
-- `job.completed` or `job.failed` — Nodaro POSTs it to the https endpoints you
-- registered, signed with each endpoint's own secret, retried with backoff,
-- every attempt kept in a delivery log. Routes: /v1/webhook-endpoints
-- (backend/src/routes/webhook-endpoints.ts). Sender: the dispatcher loop in the
-- API process (backend/src/lib/webhooks/dispatcher.ts).
--
-- `public.webhooks` and `public.webhook_deliveries` have existed since 001,
-- unread and unwritten by any code. This brings both to the current posture
-- and gives them the columns the feature needs.
--
-- SERVICE ROLE ONLY (the 446 / 462 posture): RLS on, no policies, no
-- privileges for the API roles. 001 / 032 let a signed-in user read and write
-- their own `webhooks` rows — plaintext secret included — and read their
-- deliveries straight through PostgREST; those policies go. Every access is
-- the backend's, scoped to the caller.
--
-- THE SECRET IS NEVER STORED IN PLAINTEXT. Signing needs the raw secret, so it
-- is encrypted, not hashed: AES-256-GCM under a per-environment subkey of the
-- instance key, bound to its row as associated data
-- (backend/src/lib/webhooks/secret.ts over lib/instance-cipher.ts :: boundCipher,
-- the plugin_account_secrets scheme). The plaintext `secret` column is wiped
-- and dropped. It is shown to its owner twice only: in the response that
-- creates the endpoint and in the one that rotates its secret.
--
-- ONE ENVIRONMENT PER ENDPOINT. Staging and production share this database.
-- An endpoint belongs to the environment whose server created it
-- (`runtime_env`, lib/runtime-env.ts): only that environment lists it, sends
-- its deliveries (`claim_webhook_deliveries` filters on it) and can open its
-- secret (the subkey is that environment's). Events are recorded for every
-- endpoint of the job's owner, whichever build wrote the job's status.
--
-- EVENTS ARE CAPTURED IN THE DATABASE, so no lane that ends a job can skip
-- them: the worker funnels, the in-route settlements, the settle RPCs, review
-- approval, a job inserted already finished. A trigger on `jobs` writes one
-- outbox row per active, subscribed endpoint of the owner when `status` moves
-- INTO `completed` or `failed`:
--   * `pending_review` is in flight: nothing fires until approval completes it;
--   * `cancelled` fires nothing;
--   * a job the jobs list does not show fires nothing: one of a Component
--     node's inner run or of a use-case node's hidden run (GET /v1/jobs's
--     rule — the node that started the run reports for it);
--   * re-writing the same status fires nothing (OLD IS DISTINCT FROM NEW);
--   * a user with no endpoint pays one probe of idx_webhooks_user_id;
--   * the capture can never fail the job's own write, nor hold it waiting on
--     a lock for more than 200 ms: an error is caught and raised as a WARNING
--     (the job wins over its notification).
-- No index on `jobs` is added (the trigger reads `webhooks` by user_id, which
-- 031 indexed), so nothing here needs a file of its own (see 379's header).
--
-- AN ENDPOINT A CONNECTED APP REGISTERED (`app_id`) receives only the jobs
-- that app submitted itself (`jobs.source = 'app'`, `source_detail` = the app
-- id, lib/job-source.ts), and only while the account's grant to that app is
-- live and includes `jobs:read`. Jobs of a workflow run the app started are
-- written by the orchestrator (`source = 'internal'`) and do not reach it.
--
-- Deliveries are claimed by the dispatcher with FOR UPDATE SKIP LOCKED and a
-- lease (`lease_until`, and `next_retry_at` pushed to the same time), so
-- several replicas never send one delivery twice at once; a sender that dies
-- mid-send leaves a row that comes back when its lease ends (at-least-once;
-- receivers de-duplicate on the delivery id).
--
-- NO ACCOUNT CAN HOLD UP ANOTHER'S DELIVERIES. A receiver that never answers
-- holds a send for its whole timeout, so the leases are counted: at most
-- p_per_endpoint deliveries of one endpoint and p_per_account of one account
-- are in flight at once, across every replica. Every claim looks at every
-- endpoint with something waiting and takes each one's oldest rows within its
-- room, so no backlog, however long or old, keeps another account's events
-- out. An endpoint that answers nothing at all trips a circuit breaker and
-- rests (its deliveries wait together, attempts unspent); a failure on
-- Nodaro's side (the job unreadable, the secret not openable) defers the
-- delivery without spending its attempt or counting against the endpoint.
--
-- Rows written before this migration (none are expected): an endpoint keeps
-- its URL and events but is paused with `disabled_reason = 'legacy_secret'`
-- and no environment, visible from every environment, until its owner rotates
-- its secret; a delivery is closed and never sent.

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------

ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can CRUD own webhooks" ON public.webhooks;
DROP POLICY IF EXISTS "Users can view own webhook deliveries" ON public.webhook_deliveries;

REVOKE ALL ON public.webhooks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.webhook_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.webhooks TO service_role;
GRANT ALL ON public.webhook_deliveries TO service_role;

-- ---------------------------------------------------------------------------
-- 2. webhooks.
-- ---------------------------------------------------------------------------

ALTER TABLE public.webhooks
  ADD COLUMN IF NOT EXISTS description TEXT,
  -- base64(iv || gcm-tag || ciphertext); NULL only on a legacy row.
  ADD COLUMN IF NOT EXISTS secret_ciphertext TEXT,
  -- When the current secret was issued (creation or rotation).
  ADD COLUMN IF NOT EXISTS secret_created_at TIMESTAMPTZ,
  -- The environment that created the endpoint; NULL only on a legacy row.
  ADD COLUMN IF NOT EXISTS runtime_env TEXT,
  -- The connected app that registered it; NULL = the account itself.
  ADD COLUMN IF NOT EXISTS app_id UUID REFERENCES public.developer_apps(id) ON DELETE CASCADE,
  -- Deliveries in a row that failed for good (every retry used). Reset by a
  -- success; at the dispatcher's threshold the endpoint is switched off.
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
  -- Why the PLATFORM switched it off; NULL when its owner did (or it is on).
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- After a rotation, the secret it replaced keeps signing (beside the new
  -- one) until this time, so a receiver can be switched over without a gap.
  -- Same sealing and binding as `secret_ciphertext`.
  ADD COLUMN IF NOT EXISTS previous_secret_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS previous_secret_expires_at TIMESTAMPTZ,
  -- The circuit breaker: attempts in a row that got no HTTP answer at all (a
  -- timeout, a refused connection, an address that is not public). Every
  -- CIRCUIT_AFTER of them rest the endpoint until circuit_open_until — its
  -- deliveries wait together, their attempts unspent — longer each time, up
  -- to an hour. Any HTTP answer resets it.
  ADD COLUMN IF NOT EXISTS circuit_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS circuit_open_until TIMESTAMPTZ;

-- Legacy rows: paused, no environment, events kept to the two that exist.
UPDATE public.webhooks
   SET is_active = false,
       disabled_reason = 'legacy_secret',
       disabled_at = NOW()
 WHERE secret_ciphertext IS NULL
   AND disabled_reason IS DISTINCT FROM 'legacy_secret';

UPDATE public.webhooks
   SET events = COALESCE(
         NULLIF(ARRAY(SELECT DISTINCT e FROM unnest(events) AS e
                       WHERE e IN ('job.completed', 'job.failed') ORDER BY e), '{}'::text[]),
         ARRAY['job.completed', 'job.failed'])
 WHERE events IS NULL
    OR cardinality(events) = 0
    OR NOT (events <@ ARRAY['job.completed', 'job.failed']::text[]);

-- The plaintext secret: wiped (new row versions carry no value), then dropped.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'webhooks' AND column_name = 'secret') THEN
    EXECUTE 'UPDATE public.webhooks SET secret = NULL WHERE secret IS NOT NULL';
  END IF;
END $$;
ALTER TABLE public.webhooks DROP COLUMN IF EXISTS secret;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.webhooks'::regclass AND conname = 'webhooks_events_valid') THEN
    ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_events_valid
      CHECK (cardinality(events) >= 1 AND events <@ ARRAY['job.completed', 'job.failed']::text[]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.webhooks'::regclass AND conname = 'webhooks_secret_has_env') THEN
    ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_secret_has_env
      CHECK (secret_ciphertext IS NULL OR runtime_env IS NOT NULL);
  END IF;
  -- An endpoint that is on can sign: the dispatcher never claims one it cannot.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.webhooks'::regclass AND conname = 'webhooks_active_has_secret') THEN
    ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_active_has_secret
      CHECK (NOT is_active OR secret_ciphertext IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.webhooks'::regclass AND conname = 'webhooks_runtime_env_shape') THEN
    ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_runtime_env_shape
      CHECK (runtime_env IS NULL OR char_length(runtime_env) BETWEEN 1 AND 64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.webhooks'::regclass AND conname = 'webhooks_description_length') THEN
    ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_description_length
      CHECK (description IS NULL OR char_length(description) <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.webhooks'::regclass AND conname = 'webhooks_disabled_reason_valid') THEN
    ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_disabled_reason_valid
      CHECK (disabled_reason IS NULL OR disabled_reason IN ('consecutive_failures', 'legacy_secret'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.webhooks'::regclass AND conname = 'webhooks_consecutive_failures_nonnegative') THEN
    ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_consecutive_failures_nonnegative
      CHECK (consecutive_failures >= 0 AND circuit_failures >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.webhooks'::regclass AND conname = 'webhooks_previous_secret_expires') THEN
    ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_previous_secret_expires
      CHECK ((previous_secret_ciphertext IS NULL) = (previous_secret_expires_at IS NULL));
  END IF;
END $$;

-- At most 10 endpoints per account in each environment — the ones that
-- environment lists, so the limit a user meets is the list they see: its own
-- endpoints, and those older than this migration (no environment yet, listed
-- everywhere). The bound on what one finished job fans out to. Serialized per
-- owner and environment, so two concurrent creates cannot both take the tenth
-- place. The route maps SQLSTATE 53400 to `400 limit_reached`
-- (MAX_ENDPOINTS_PER_ACCOUNT in lib/webhooks/endpoints.ts states the same
-- number; a test holds the two together).
CREATE OR REPLACE FUNCTION public.webhooks_enforce_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('public.webhooks:' || NEW.user_id::text || ':' || coalesce(NEW.runtime_env, ''), 0));
  IF (SELECT count(*) FROM public.webhooks w
       WHERE w.user_id = NEW.user_id
         AND (w.runtime_env IS NULL OR w.runtime_env IS NOT DISTINCT FROM NEW.runtime_env)) >= 10 THEN
    RAISE EXCEPTION 'an account has at most 10 webhook endpoints in an environment' USING ERRCODE = '53400';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.webhooks_enforce_cap() FROM PUBLIC, anon, authenticated;

-- CREATE OR REPLACE TRIGGER (not DROP + CREATE) throughout this file: it
-- takes SHARE ROW EXCLUSIVE, never the ACCESS EXCLUSIVE a DROP TRIGGER takes,
-- which on `jobs` (section 4) would stall every read of the table until the
-- migration commits.
CREATE OR REPLACE TRIGGER trg_webhooks_enforce_cap
  BEFORE INSERT ON public.webhooks
  FOR EACH ROW EXECUTE FUNCTION public.webhooks_enforce_cap();

-- One endpoint per address, per account (or connected app) and environment:
-- ten endpoints on one address would send every event ten times to whoever
-- is there. The routes store the address normalized, so spelling variants of
-- one address collide, and map SQLSTATE 23505 to `409 url_taken`. A row older
-- than this migration has no environment and is left out until its secret is
-- rotated (rotation gives it one, and can then collide).
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhooks_address
  ON public.webhooks (user_id, runtime_env, url, app_id) NULLS NOT DISTINCT
  WHERE runtime_env IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. webhook_deliveries — the outbox and the delivery log in one table.
-- ---------------------------------------------------------------------------

ALTER TABLE public.webhook_deliveries
  -- The endpoint's (= the job's) owner, so every query scopes itself by
  -- user_id like any tenant table. No FK of its own: the row already goes
  -- with its endpoint (webhook_id ON DELETE CASCADE), and an FK here would
  -- lock `profiles` for the length of this migration.
  ADD COLUMN IF NOT EXISTS user_id UUID,
  -- pending (waiting or being sent) | delivered | failed (for good).
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
  -- A short fixed text from the dispatcher (never a raw transport error).
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  -- While a sender holds the delivery: when its lease ends. Set by the claim,
  -- cleared by every outcome and every close; a lease still in the future is a
  -- delivery in flight (the claim counts them). One left behind by a sender
  -- that died simply runs out.
  ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;

-- Legacy rows (no owner yet): owned, closed, never sent.
UPDATE public.webhook_deliveries d
   SET user_id = w.user_id,
       status = CASE WHEN d.delivered_at IS NOT NULL THEN 'delivered' ELSE 'failed' END,
       next_retry_at = NULL,
       last_error = CASE WHEN d.delivered_at IS NOT NULL THEN d.last_error ELSE 'legacy' END
  FROM public.webhooks w
 WHERE w.id = d.webhook_id
   AND d.user_id IS NULL;

ALTER TABLE public.webhook_deliveries ALTER COLUMN user_id SET NOT NULL;
-- The exact text of the body sent (a JSON string, never a re-encoded object),
-- kept from the first recorded attempt so a retry sends the same bytes; NULL
-- until then and once delivered. A sender cut off between sending and
-- recording leaves none, and the next attempt builds the body again.
ALTER TABLE public.webhook_deliveries ALTER COLUMN payload DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.webhook_deliveries'::regclass AND conname = 'webhook_deliveries_status_valid') THEN
    ALTER TABLE public.webhook_deliveries ADD CONSTRAINT webhook_deliveries_status_valid
      CHECK (status IN ('pending', 'delivered', 'failed'));
  END IF;
  -- A pending row always says when it is due; one with no time would never be sent.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.webhook_deliveries'::regclass AND conname = 'webhook_deliveries_pending_is_due') THEN
    ALTER TABLE public.webhook_deliveries ADD CONSTRAINT webhook_deliveries_pending_is_due
      CHECK (status <> 'pending' OR next_retry_at IS NOT NULL);
  END IF;
  -- NOT VALID: enforced on every new or changed row; a legacy row's event is
  -- left as it was written.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.webhook_deliveries'::regclass AND conname = 'webhook_deliveries_event_valid') THEN
    ALTER TABLE public.webhook_deliveries ADD CONSTRAINT webhook_deliveries_event_valid
      CHECK (event IN ('job.completed', 'job.failed', 'ping')) NOT VALID;
  END IF;
END $$;

-- The claim's reads: each endpoint with something waiting (one probe per
-- endpoint, however long its queue), and that endpoint's oldest due rows.
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
  ON public.webhook_deliveries (webhook_id, next_retry_at, id) WHERE status = 'pending';
-- What is in flight (a lease is set only while a sender holds the row).
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_leased
  ON public.webhook_deliveries (lease_until) INCLUDE (webhook_id, user_id)
  WHERE status = 'pending' AND lease_until IS NOT NULL;
-- 001's version also held every row that failed for good, forever.
DROP INDEX IF EXISTS public.idx_webhook_deliveries_next_retry;
-- The delivery log's keyset (and the cascade from an endpoint).
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_log
  ON public.webhook_deliveries (webhook_id, created_at DESC, id DESC);
DROP INDEX IF EXISTS public.idx_webhook_deliveries_webhook_id;
-- The retention prune.
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at
  ON public.webhook_deliveries (created_at);

-- A delivery belongs to its endpoint's owner and carries only that owner's
-- job, enforced here as well as in the API.
CREATE OR REPLACE FUNCTION public.webhook_deliveries_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.webhooks w WHERE w.id = NEW.webhook_id AND w.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'a webhook delivery belongs to its endpoint''s owner' USING ERRCODE = '42501';
  END IF;
  IF NEW.job_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.job_id AND j.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'a webhook delivery carries only its owner''s job' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.webhook_deliveries_owner_guard() FROM PUBLIC, anon, authenticated;

-- Column-scoped on UPDATE, and job_id is left out on purpose: after the
-- insert it changes only through 001's FK (SET NULL when the job is deleted).
-- When an account is deleted, that SET NULL can reach a delivery whose
-- endpoint the same statement already removed, and a guard on job_id would
-- abort the whole deletion.
CREATE OR REPLACE TRIGGER trg_webhook_deliveries_owner_guard
  BEFORE INSERT OR UPDATE OF webhook_id, user_id ON public.webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.webhook_deliveries_owner_guard();

-- A deleted job takes its data out of the log: 001's FK sets job_id to NULL,
-- and that update drops the kept body and closes a delivery not yet sent.
CREATE OR REPLACE FUNCTION public.webhook_deliveries_job_deleted()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.job_id IS NULL AND OLD.job_id IS NOT NULL THEN
    NEW.payload := NULL;
    IF NEW.status = 'pending' THEN
      NEW.status := 'failed';
      NEW.next_retry_at := NULL;
      NEW.lease_until := NULL;
      NEW.last_error := 'job_deleted';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.webhook_deliveries_job_deleted() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_webhook_deliveries_job_deleted
  BEFORE UPDATE OF job_id ON public.webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.webhook_deliveries_job_deleted();

-- ---------------------------------------------------------------------------
-- The dispatcher's three calls. Service role only.
-- ---------------------------------------------------------------------------

-- Every endpoint with a delivery waiting, once each, starting at p_from and
-- wrapping round, at most p_limit of them: a loose scan of the due index, one
-- probe per endpoint however long its queue. The claim starts it at a random
-- point, so when more endpoints wait than one claim looks at, none is always
-- last.
CREATE OR REPLACE FUNCTION public.webhook_endpoints_waiting(p_from uuid, p_limit integer)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH RECURSIVE upward AS (
    (SELECT d.webhook_id AS id FROM public.webhook_deliveries d
      WHERE d.status = 'pending' AND d.webhook_id >= p_from
      ORDER BY d.webhook_id LIMIT 1)
    UNION ALL
    SELECT (SELECT d.webhook_id FROM public.webhook_deliveries d
             WHERE d.status = 'pending' AND d.webhook_id > u.id
             ORDER BY d.webhook_id LIMIT 1)
      FROM upward u WHERE u.id IS NOT NULL
  ), wrapped AS (
    (SELECT d.webhook_id AS id FROM public.webhook_deliveries d
      WHERE d.status = 'pending' AND d.webhook_id < p_from
      ORDER BY d.webhook_id LIMIT 1)
    UNION ALL
    SELECT (SELECT d.webhook_id FROM public.webhook_deliveries d
             WHERE d.status = 'pending' AND d.webhook_id > r.id AND d.webhook_id < p_from
             ORDER BY d.webhook_id LIMIT 1)
      FROM wrapped r WHERE r.id IS NOT NULL
  )
  SELECT x.id FROM (
    SELECT u.id FROM upward u WHERE u.id IS NOT NULL
    UNION ALL
    SELECT r.id FROM wrapped r WHERE r.id IS NOT NULL
  ) x
  LIMIT greatest(p_limit, 0)
$$;

-- Claim up to p_limit due deliveries of THIS environment's endpoints and lease
-- them: `lease_until` and `next_retry_at` move p_lease_seconds ahead and
-- `attempts` counts the attempt now, so a sender that dies mid-send is retried
-- after the lease and still spends its attempt.
--
-- Fair by construction: every claim looks at every endpoint that has
-- something waiting (up to 2,000, from a random point) and takes each one's
-- OLDEST due rows, no more than its room — p_per_endpoint less what it already
-- has in flight — then no more than each account's room — p_per_account less
-- what the account has in flight in this environment — and only then the
-- oldest p_limit of all. What is in flight is counted across every replica and
-- every claim (the leases), so a receiver that never answers holds its own
-- places and nobody else's, and no backlog, however long, can keep another
-- account's events out of a claim.
--
-- An endpoint resting behind its circuit breaker (circuit_open_until) is
-- passed over, its deliveries waiting together with their attempts unspent —
-- except a test ping, which is how its owner checks the receiver is back.
--
-- Rows that must not be sent are closed here (each endpoint's oldest 500 a
-- claim; closing takes no place) and handed back with `closed_reason`, so the
-- dispatcher claims again at once while a backlog of them drains:
--   attempts_exhausted — every attempt spent (one for a test ping), the last
--     one never recorded: not even a sender that dies on every try can make a
--     delivery go round forever;
--   endpoint_disabled — the endpoint was switched off (by its owner, or after
--     its failures); a test ping still goes;
--   app_revoked — the endpoint belongs to a connected app whose grant (with
--     jobs:read) the account has revoked since: the app receives nothing more.
-- A leased row comes with the endpoint's secret and, while a rotation's grace
-- lasts, the one it replaced (both sign). clock_timestamp(), never now(): a
-- claim must compare against real time, not its transaction's start (389).
CREATE OR REPLACE FUNCTION public.claim_webhook_deliveries(
  p_runtime_env text,
  p_limit integer DEFAULT 25,
  p_per_endpoint integer DEFAULT 5,
  p_lease_seconds integer DEFAULT 60,
  p_max_attempts integer DEFAULT 8,
  p_per_account integer DEFAULT 10
)
RETURNS TABLE (
  delivery_id uuid,
  webhook_id uuid,
  user_id uuid,
  job_id uuid,
  event text,
  payload jsonb,
  attempts integer,
  created_at timestamptz,
  url text,
  secret_ciphertext text,
  previous_secret_ciphertext text,
  runtime_env text,
  closed_reason text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_per_endpoint integer := greatest(p_per_endpoint, 1);
  v_per_account integer := greatest(p_per_account, 1);
  v_max_attempts integer := greatest(p_max_attempts, 1);
  v_lease interval := make_interval(secs => greatest(p_lease_seconds, 30));
  v_waiting uuid[];
  v_leased_at timestamptz;
BEGIN
  v_waiting := ARRAY(SELECT public.webhook_endpoints_waiting(gen_random_uuid(), 2000));
  -- One reading of the clock for every row this claim leases: the lease and
  -- the next due time are the same instant.
  v_leased_at := clock_timestamp();

  RETURN QUERY
  WITH endpoint AS MATERIALIZED (
    SELECT w.id, w.user_id AS account_id, w.is_active,
           w.secret_ciphertext IS NULL AS unsigned,
           coalesce(w.circuit_open_until > v_now, false) AS resting,
           (w.app_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.developer_app_authorizations a
              WHERE a.app_id = w.app_id
                AND a.user_id = w.user_id
                AND a.revoked_at IS NULL
                AND 'jobs:read' = ANY (a.scopes_granted)
           )) AS revoked
      FROM unnest(v_waiting) AS waiting(id)
      JOIN public.webhooks w ON w.id = waiting.id
     WHERE w.runtime_env = p_runtime_env
  ), busy_endpoint AS MATERIALIZED (
    SELECT l.webhook_id AS endpoint_id, count(*)::integer AS n
      FROM public.webhook_deliveries l
     WHERE l.status = 'pending' AND l.lease_until > v_now
     GROUP BY l.webhook_id
  ), busy_account AS MATERIALIZED (
    -- This environment's senders only: staging and production share the
    -- database but each sends its own endpoints' deliveries.
    SELECT l.user_id AS account_id, count(*)::integer AS n
      FROM public.webhook_deliveries l
      JOIN public.webhooks w ON w.id = l.webhook_id
     WHERE l.status = 'pending' AND l.lease_until > v_now
       AND w.runtime_env = p_runtime_env
     GROUP BY l.user_id
  ), closing AS MATERIALIZED (
    -- An endpoint switched off (its test pings excepted), never signed, or
    -- whose app lost its grant: its due rows end here.
    SELECT c.id, c.reason
      FROM endpoint e
     CROSS JOIN LATERAL (
       SELECT d.id, CASE WHEN e.revoked THEN 'app_revoked' ELSE 'endpoint_disabled' END AS reason
         FROM public.webhook_deliveries d
        WHERE d.webhook_id = e.id
          AND d.status = 'pending'
          AND d.next_retry_at <= v_now
          AND (e.revoked OR e.unsigned OR d.event <> 'ping')
        ORDER BY d.next_retry_at, d.id
        LIMIT 500
     ) c
     WHERE e.revoked OR e.unsigned OR NOT e.is_active
     LIMIT 5000
  ), candidate AS MATERIALIZED (
    -- Every other endpoint's oldest due rows, as many as its room.
    SELECT c.id, c.account_id, c.due_at, c.exhausted
      FROM endpoint e
     CROSS JOIN LATERAL (
       SELECT d.id, d.user_id AS account_id, d.next_retry_at AS due_at,
              d.attempts >= CASE WHEN d.event = 'ping' THEN 1 ELSE v_max_attempts END AS exhausted
         FROM public.webhook_deliveries d
        WHERE d.webhook_id = e.id
          AND d.status = 'pending'
          AND d.next_retry_at <= v_now
          AND (d.event = 'ping' OR (e.is_active AND NOT e.resting))
        ORDER BY d.next_retry_at, d.id
        LIMIT greatest(v_per_endpoint - coalesce((SELECT b.n FROM busy_endpoint b WHERE b.endpoint_id = e.id), 0), 0)
     ) c
     WHERE NOT e.revoked AND NOT e.unsigned
  ), account_share AS MATERIALIZED (
    SELECT r.id, r.due_at
      FROM (
        SELECT c.id, c.due_at,
               row_number() OVER (PARTITION BY c.account_id ORDER BY c.due_at, c.id) AS rn,
               coalesce((SELECT b.n FROM busy_account b WHERE b.account_id = c.account_id), 0) AS busy
          FROM candidate c
         WHERE NOT c.exhausted
      ) r
     WHERE r.rn <= v_per_account - r.busy
  ), to_close AS (
    -- The status and due time are checked again on the locked row itself, so
    -- a row another replica took since this statement's snapshot is skipped,
    -- never handled twice.
    SELECT d.id, x.reason
      FROM public.webhook_deliveries d
      JOIN (
        SELECT k.id, k.reason FROM closing k
        UNION ALL
        SELECT c.id, 'attempts_exhausted' FROM candidate c WHERE c.exhausted
      ) x ON x.id = d.id
     WHERE d.status = 'pending'
       AND d.next_retry_at <= clock_timestamp()
     FOR UPDATE OF d SKIP LOCKED
  ), to_send AS (
    SELECT d.id
      FROM public.webhook_deliveries d
      JOIN account_share s ON s.id = d.id
     WHERE d.status = 'pending'
       AND d.next_retry_at <= clock_timestamp()
     ORDER BY s.due_at, d.id
     LIMIT greatest(least(p_limit, 100), 0)
     FOR UPDATE OF d SKIP LOCKED
  ), closed AS (
    -- A delivery whose attempts ran out keeps the body it was sent with, like
    -- any final failure; one that was never going to be sent again keeps none.
    UPDATE public.webhook_deliveries d
       SET status = 'failed',
           next_retry_at = NULL,
           lease_until = NULL,
           payload = CASE WHEN c.reason = 'attempts_exhausted' THEN d.payload END,
           last_error = c.reason
      FROM to_close c
     WHERE d.id = c.id
    RETURNING d.id AS id, d.webhook_id AS endpoint_id, d.user_id AS account_id, d.job_id AS job,
              d.event AS ev, d.attempts AS tries, d.created_at AS at, c.reason AS reason
  ), leased AS (
    UPDATE public.webhook_deliveries d
       SET attempts = d.attempts + 1,
           next_retry_at = v_leased_at + v_lease,
           lease_until = v_leased_at + v_lease,
           last_attempt_at = v_leased_at
      FROM to_send t, public.webhooks w
     WHERE d.id = t.id
       AND w.id = d.webhook_id
    RETURNING d.id AS id, d.webhook_id AS endpoint_id, d.user_id AS account_id, d.job_id AS job,
              d.event AS ev, d.payload AS body, d.attempts AS tries, d.created_at AS at,
              w.url AS address, w.secret_ciphertext AS sealed,
              CASE WHEN w.previous_secret_expires_at > clock_timestamp() THEN w.previous_secret_ciphertext END AS sealed_before,
              w.runtime_env AS env
  )
  SELECT l.id, l.endpoint_id, l.account_id, l.job, l.ev, l.body, l.tries, l.at,
         l.address, l.sealed, l.sealed_before, l.env, NULL::text
    FROM leased l
  UNION ALL
  SELECT c.id, c.endpoint_id, c.account_id, c.job, c.ev, NULL::jsonb, c.tries, c.at,
         NULL::text, NULL::text, NULL::text, NULL::text, c.reason
    FROM closed c;
END;
$$;

-- Record one attempt's outcome:
--   'delivered';
--   'retry'    — failed, tried again at p_next_retry_at;
--   'failed'   — failed for good (its last attempt);
--   'skipped'  — nothing to send: the job is gone;
--   'deferred' — not attempted, for a reason on the platform's side (the job
--                could not be read, the secret could not be opened): the
--                attempt is given back, the delivery waits until
--                p_next_retry_at, and nothing counts against the endpoint.
-- A compare-and-set on the attempt it claimed, so an outcome that arrives
-- after its lease was taken over changes nothing (returns NULL). Every outcome
-- ends the lease. The body is kept from the first recorded attempt and
-- dropped once delivered.
--
-- The endpoint's two counters:
--   consecutive_failures — deliveries in a row that failed for good. A success
--     resets it; at p_disable_after the endpoint is switched off, with the
--     reason. Test pings count for neither.
--   circuit_failures — attempts in a row that got no HTTP answer at all. Any
--     answer resets it (and closes the circuit); every p_circuit_after of them
--     rest the endpoint for a minute, twice as long each time, an hour at most
--     (circuit_open_until; the claim passes it over meanwhile).
CREATE OR REPLACE FUNCTION public.record_webhook_delivery_attempt(
  p_delivery_id uuid,
  p_attempt integer,
  p_outcome text,
  p_next_retry_at timestamptz DEFAULT NULL,
  p_payload jsonb DEFAULT NULL,
  p_response_status integer DEFAULT NULL,
  p_response_body text DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_disable_after integer DEFAULT 50,
  p_circuit_after integer DEFAULT 5
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_webhook uuid;
  v_event text;
  v_status text;
  v_circuit_after integer := greatest(p_circuit_after, 1);
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('delivered', 'retry', 'failed', 'skipped', 'deferred') THEN
    RAISE EXCEPTION 'unknown webhook delivery outcome: %', p_outcome USING ERRCODE = '22023';
  END IF;
  IF p_outcome IN ('retry', 'deferred') AND p_next_retry_at IS NULL THEN
    RAISE EXCEPTION 'a retry needs the time it is due' USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'deferred' THEN
    UPDATE public.webhook_deliveries d
       SET attempts = d.attempts - 1,
           next_retry_at = p_next_retry_at,
           lease_until = NULL,
           response_status = NULL,
           response_body = NULL,
           duration_ms = NULL,
           last_error = left(p_error, 500)
     WHERE d.id = p_delivery_id
       AND d.attempts = p_attempt
       AND d.status = 'pending'
    RETURNING d.status INTO v_status;
    RETURN v_status;
  END IF;

  UPDATE public.webhook_deliveries d
     SET status = CASE p_outcome WHEN 'delivered' THEN 'delivered' WHEN 'retry' THEN 'pending' ELSE 'failed' END,
         delivered_at = CASE WHEN p_outcome = 'delivered' THEN clock_timestamp() ELSE d.delivered_at END,
         next_retry_at = CASE WHEN p_outcome = 'retry' THEN p_next_retry_at ELSE NULL END,
         -- The attempt is over: the delivery is no longer in flight.
         lease_until = NULL,
         payload = CASE WHEN p_outcome IN ('delivered', 'skipped') THEN NULL ELSE COALESCE(d.payload, p_payload) END,
         response_status = p_response_status,
         response_body = left(p_response_body, 2048),
         duration_ms = p_duration_ms,
         last_error = left(p_error, 500)
   WHERE d.id = p_delivery_id
     AND d.attempts = p_attempt
     AND d.status = 'pending'
  RETURNING d.webhook_id, d.event, d.status INTO v_webhook, v_event, v_status;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- The circuit breaker: any HTTP answer closes it; an attempt with none counts.
  IF p_response_status IS NOT NULL THEN
    UPDATE public.webhooks w
       SET circuit_failures = 0, circuit_open_until = NULL
     WHERE w.id = v_webhook
       AND (w.circuit_failures <> 0 OR w.circuit_open_until IS NOT NULL);
  ELSIF p_outcome IN ('retry', 'failed') THEN
    UPDATE public.webhooks w
       SET circuit_failures = w.circuit_failures + 1,
           circuit_open_until = CASE
             WHEN (w.circuit_failures + 1) % v_circuit_after = 0
               THEN clock_timestamp()
                    + make_interval(secs => least(60 * power(2, least((w.circuit_failures + 1) / v_circuit_after - 1, 6)), 3600))
             ELSE w.circuit_open_until
           END
     WHERE w.id = v_webhook;
  END IF;

  IF v_event = 'ping' OR p_outcome IN ('retry', 'skipped') THEN
    RETURN v_status;
  END IF;

  IF p_outcome = 'delivered' THEN
    UPDATE public.webhooks w
       SET consecutive_failures = 0
     WHERE w.id = v_webhook AND w.consecutive_failures <> 0;
  ELSE
    UPDATE public.webhooks w
       SET consecutive_failures = w.consecutive_failures + 1,
           is_active = CASE WHEN w.consecutive_failures + 1 >= p_disable_after THEN false ELSE w.is_active END,
           disabled_reason = CASE WHEN w.is_active AND w.consecutive_failures + 1 >= p_disable_after
                                  THEN 'consecutive_failures' ELSE w.disabled_reason END,
           disabled_at = CASE WHEN w.is_active AND w.consecutive_failures + 1 >= p_disable_after
                              THEN clock_timestamp() ELSE w.disabled_at END,
           updated_at = CASE WHEN w.is_active AND w.consecutive_failures + 1 >= p_disable_after
                             THEN clock_timestamp() ELSE w.updated_at END
     WHERE w.id = v_webhook;
  END IF;
  RETURN v_status;
END;
$$;

-- The delivery log is kept 30 days (the dispatcher's KEEP_DAYS), oldest first,
-- p_limit rows a call (the dispatcher calls again until a call comes back
-- short). A rotation's previous secret is wiped once its grace has passed.
CREATE OR REPLACE FUNCTION public.prune_webhook_deliveries(
  p_keep_days integer DEFAULT 30,
  p_limit integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.webhooks w
     SET previous_secret_ciphertext = NULL, previous_secret_expires_at = NULL
   WHERE w.previous_secret_expires_at <= clock_timestamp();

  DELETE FROM public.webhook_deliveries d
   WHERE d.id IN (
     SELECT o.id
       FROM public.webhook_deliveries o
      WHERE o.created_at < clock_timestamp() - make_interval(days => greatest(p_keep_days, 1))
      ORDER BY o.created_at
      LIMIT greatest(least(p_limit, 10000), 0)
   );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- A new signing secret for an endpoint (the route seals it; the plaintext
-- never reaches the database). With p_previous_expires_at, the secret it
-- replaces moves aside and keeps signing until then — but only one sealed for
-- this same environment (an endpoint older than signing has none). It happens
-- here so that no read in the API ever selects a ciphertext. Returns how long
-- the previous secret is kept (NULL: not kept). An endpoint older than
-- signing takes this environment, and loses the reason it was paused.
CREATE OR REPLACE FUNCTION public.rotate_webhook_secret(
  p_webhook_id uuid,
  p_user_id uuid,
  p_runtime_env text,
  p_secret_ciphertext text,
  p_previous_expires_at timestamptz DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_kept_until timestamptz;
BEGIN
  IF p_secret_ciphertext IS NULL OR p_runtime_env IS NULL THEN
    RAISE EXCEPTION 'a rotation needs the sealed secret and its environment' USING ERRCODE = '22023';
  END IF;
  UPDATE public.webhooks w
     SET previous_secret_ciphertext = CASE
           WHEN p_previous_expires_at > clock_timestamp() AND w.secret_ciphertext IS NOT NULL
                AND w.runtime_env = p_runtime_env THEN w.secret_ciphertext END,
         previous_secret_expires_at = CASE
           WHEN p_previous_expires_at > clock_timestamp() AND w.secret_ciphertext IS NOT NULL
                AND w.runtime_env = p_runtime_env THEN p_previous_expires_at END,
         secret_ciphertext = p_secret_ciphertext,
         secret_created_at = clock_timestamp(),
         runtime_env = p_runtime_env,
         disabled_reason = CASE WHEN w.disabled_reason = 'legacy_secret' THEN NULL ELSE w.disabled_reason END,
         disabled_at = CASE WHEN w.disabled_reason = 'legacy_secret' THEN NULL ELSE w.disabled_at END,
         updated_at = clock_timestamp()
   WHERE w.id = p_webhook_id
     AND w.user_id = p_user_id
  RETURNING w.previous_secret_expires_at INTO v_kept_until;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such webhook endpoint' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_kept_until;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_webhook_secret(uuid, uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_webhook_secret(uuid, uuid, text, text, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.webhook_endpoints_waiting(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webhook_endpoints_waiting(uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_webhook_deliveries(text, integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_webhook_deliveries(text, integer, integer, integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.record_webhook_delivery_attempt(uuid, integer, text, timestamptz, jsonb, integer, text, integer, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_delivery_attempt(uuid, integer, text, timestamptz, jsonb, integer, text, integer, text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.prune_webhook_deliveries(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_webhook_deliveries(integer, integer) TO service_role;

COMMENT ON TABLE public.webhooks IS
  'Outbound webhook endpoints: an https URL per account that receives job.completed / job.failed, signed with a per-endpoint secret (AES-256-GCM, per environment, bound to the row). Service role only.';
COMMENT ON TABLE public.webhook_deliveries IS
  'Outbox and delivery log of outbound webhooks: one row per event per endpoint, its attempts, the receiver''s answer. Kept 30 days. Service role only.';
COMMENT ON COLUMN public.webhooks.runtime_env IS
  'The environment that created the endpoint; only it lists the endpoint, sends to it and can open its secret. NULL only on a row older than migration 521.';
COMMENT ON COLUMN public.webhooks.app_id IS
  'The connected app that registered the endpoint; it then receives only the jobs that app submitted. NULL = the account itself.';

-- ---------------------------------------------------------------------------
-- 4. The capture on `jobs`. Last in the file: its triggers take SHARE ROW
--    EXCLUSIVE on `jobs` (writes wait, reads do not) until this commits.
-- ---------------------------------------------------------------------------

-- The outbox insert for one finished job, on its own so that it, and only it,
-- runs under a short lock_timeout: whatever it might wait on (an endpoint row
-- being deleted, DDL on webhook_deliveries), the job's own write does not wait
-- with it — after 200 ms the wait fails, the caller below catches it, and the
-- job's write goes on (the event is lost, with a WARNING). Called only from
-- the trigger function, as that function's owner.
--
-- A job the jobs list does not show sends nothing: a job of a Component
-- node's inner run or of a use-case node's hidden run is shown — and so
-- reported — only through the node that started it (the same rule as
-- GET /v1/jobs in routes/jobs.ts; webhook-endpoints.test.ts holds the two
-- together).
CREATE OR REPLACE FUNCTION public.webhooks_record_job_event(
  p_job_id uuid,
  p_user_id uuid,
  p_event text,
  p_source text,
  p_source_detail text,
  p_execution_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '200ms'
AS $$
BEGIN
  IF p_execution_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workflow_executions e
     WHERE e.id = p_execution_id
       AND (e.is_component_execution IS TRUE OR e.trigger_type = 'use_case')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.webhook_deliveries (webhook_id, user_id, job_id, event, status, next_retry_at)
  SELECT w.id, w.user_id, p_job_id, p_event, 'pending', clock_timestamp()
    FROM public.webhooks w
   WHERE w.user_id = p_user_id
     AND w.is_active
     AND p_event = ANY (w.events)
     AND (
       w.app_id IS NULL
       OR (
         p_source = 'app'
         AND p_source_detail = w.app_id::text
         AND EXISTS (
           SELECT 1 FROM public.developer_app_authorizations a
            WHERE a.app_id = w.app_id
              AND a.user_id = p_user_id
              AND a.revoked_at IS NULL
              AND 'jobs:read' = ANY (a.scopes_granted)
         )
       )
     );
END;
$$;

-- Nobody calls it but the trigger (the service role included: an event is
-- recorded when a job ends, never on request).
REVOKE ALL ON FUNCTION public.webhooks_record_job_event(uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- SECURITY DEFINER so the capture works whichever role ends the job (the
-- service role, a settle RPC's owner): `webhooks` has RLS and no policies.
CREATE OR REPLACE FUNCTION public.webhooks_capture_job_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event text := 'job.' || NEW.status;
BEGIN
  -- The common case, a user with no endpoint: one index probe and no
  -- subtransaction — which is why the probe stays outside the guarded block
  -- below (a plain read of an indexed table; it waits only behind DDL that
  -- takes ACCESS EXCLUSIVE on `webhooks`, like any read of it would).
  IF NOT EXISTS (SELECT 1 FROM public.webhooks w WHERE w.user_id = NEW.user_id AND w.is_active) THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM public.webhooks_record_job_event(NEW.id, NEW.user_id, v_event, NEW.source, NEW.source_detail, NEW.workflow_execution_id);
  EXCEPTION WHEN OTHERS THEN
    -- The job's own write must never fail, or wait, for its notification.
    RAISE WARNING 'webhooks: could not record % for job % (SQLSTATE %): %', v_event, NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.webhooks_capture_job_event() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_jobs_webhook_event
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (NEW.status IN ('completed', 'failed') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.webhooks_capture_job_event();

-- A job inserted already finished (a mirrored cloud job) ends there.
CREATE OR REPLACE TRIGGER trg_jobs_webhook_event_insert
  AFTER INSERT ON public.jobs
  FOR EACH ROW
  WHEN (NEW.status IN ('completed', 'failed'))
  EXECUTE FUNCTION public.webhooks_capture_job_event();
