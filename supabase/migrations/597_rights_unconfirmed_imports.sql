-- Imports started WITHOUT a content rights confirmation, and how many did carry
-- one: what an administrator reads before turning `content_rights_required` on.
--
-- An import without a confirmation goes ahead only while the setting is off
-- (with it on, the import gate refuses it). The gate's spend half, the one
-- funnel every import passes right before its fetch, writes one row for each
-- (and so does its check of a plugin's own download outside any job, which
-- has no spend half and no account):
-- the lane, the way in and the connected app it came through, and only the
-- HOST of the link (a full link can carry a name or a token). No account is
-- kept: nothing here reads one, and the request is kept only as a hash under
-- a key of the server's, which no job or run id can be matched against. A
-- retry of the same request (a job tried again) is the same import: one row
-- per request and host. A download with no request (a plugin's outside any
-- job) is a row for each attempt. Rows are kept 90 days, the longest window the admin
-- screen reads; the server deletes older ones daily. An import that carried a
-- confirmation is already recorded as that confirmation's `consumed` event
-- (577), a ticked box or one derived from a standing authorization (579).
--
-- Counting starts with this migration: `rights_import_share_start` holds
-- when, and the share never reaches back past it, so confirmations recorded
-- since 577 are not set against a count that did not exist yet.
--
-- Written and read by the server only (service role): no policy grants a
-- client anything here.

CREATE TABLE IF NOT EXISTS public.rights_unconfirmed_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Where the import was made: route, run, mcp, admin, plugin.
  lane text NOT NULL CHECK (char_length(lane) BETWEEN 1 AND 40),
  -- How the request came in: a person's session, an API key, a connected app, an agent; null for none.
  via text CHECK (via IS NULL OR via IN ('session', 'api', 'app', 'mcp')),
  app_id text CHECK (app_id IS NULL OR char_length(app_id) <= 200),
  -- The request, as a keyed hash (64 hex characters).
  request_id text CHECK (request_id IS NULL OR char_length(request_id) <= 200),
  host text NOT NULL CHECK (char_length(host) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rights_unconfirmed_imports_request_once
  ON public.rights_unconfirmed_imports (request_id, host) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rights_unconfirmed_imports_created_idx
  ON public.rights_unconfirmed_imports (created_at);

ALTER TABLE public.rights_unconfirmed_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rights_unconfirmed_imports FROM anon, authenticated;

-- When counting began: one row, written once (a re-applied migration keeps it).
CREATE TABLE IF NOT EXISTS public.rights_import_share_start (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.rights_import_share_start (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.rights_import_share_start ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rights_import_share_start FROM anon, authenticated;

-- The share reads the imports that carried a confirmation by when they were
-- spent; `rights_events` is never trimmed, so without this it reads them all.
CREATE INDEX IF NOT EXISTS rights_events_consumed_created_idx
  ON public.rights_events (created_at) WHERE kind = 'consumed';

-- The share of imports that carried a declaration from `p_since`, or from when
-- counting began if that is later, as ONE value (never cut short by a row
-- limit): { counting_since, since, rows }. Each row is { declaration, lane, via,
-- app_id, imports }, the most first: `declaration` is the confirmation's kind
-- for imports that carried one (`checkbox`, `derived`; one row each, no lane,
-- way in or app) and `none` for imports that did not, by lane, way in and app.
CREATE OR REPLACE FUNCTION public.content_rights_import_share(p_since timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH win AS (
    SELECT s.started_at, greatest(p_since, s.started_at) AS since
      FROM (SELECT (SELECT started_at FROM public.rights_import_share_start WHERE id) AS started_at) s
  ), counted AS (
    SELECT c.kind AS declaration, NULL::text AS lane, NULL::text AS via, NULL::text AS app_id, count(*) AS imports
      FROM public.rights_events e
      JOIN public.content_rights_confirmations c ON c.id = e.confirmation_id
     WHERE e.kind = 'consumed' AND e.created_at >= (SELECT since FROM win)
     GROUP BY c.kind
    UNION ALL
    SELECT 'none', u.lane, u.via, u.app_id, count(*)
      FROM public.rights_unconfirmed_imports u
     WHERE u.created_at >= (SELECT since FROM win)
     GROUP BY u.lane, u.via, u.app_id
  )
  SELECT jsonb_build_object(
    'counting_since', (SELECT started_at FROM win),
    'since', (SELECT since FROM win),
    'rows', coalesce(
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.imports DESC, r.declaration, r.lane, r.via, r.app_id) FROM counted r),
      '[]'::jsonb
    )
  )
$$;

REVOKE ALL ON FUNCTION public.content_rights_import_share(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.content_rights_import_share(timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.content_rights_import_share(timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.content_rights_import_share(timestamptz) TO service_role;
