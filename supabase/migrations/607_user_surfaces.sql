-- 607_user_surfaces.sql
--
-- Which surfaces each account has used -- the app, the studio, the browser
-- extension, an MCP client, the CLI -- kept for good. The admin's "Signed in
-- now" list (backend ee/lib/presence.ts) notes the same thing in Redis for
-- fifteen minutes and nowhere else, so "who ever signed in from the extension,
-- and when" had no answer: an extension sign-in is an ordinary Google account,
-- and only a job it runs leaves a trace (jobs.source).
--
-- One row per account, source and detail: the source as `deriveJobSource`
-- names the caller (a closed set, kept in step with JOB_SOURCES less
-- `internal`; a later kind is added by dropping and re-adding the check), the
-- detail its specific identity -- a host, an MCP client, a client package with
-- its version, so an extension user has a row per version they signed in from;
-- count by source. The server touches a row at most about once an hour per
-- process (several replicas may each touch once); `touches` counts those
-- touches, not requests. Nothing is reachable through PostgREST: the server's
-- role writes through the function below, and an administrator reads with it.
--
-- The detail is the caller's own word (a client header, an MCP client name,
-- an Origin host), so the function caps an account at 50 rows: one account
-- rotating the value could otherwise grow the table a row per request. A
-- surface beyond the cap is not recorded; the rows that exist keep counting.
-- The detail is cut at 80 characters as `source_detail` is (a Host with a
-- port can run a few over; two such notes then share a row, harmlessly).
--
-- Idempotent: CI re-applies the newest migration. Proof:
-- supabase/tests/user-surfaces.behavior.sql.

CREATE TABLE IF NOT EXISTS public.user_surfaces (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source text NOT NULL,
  detail text NOT NULL DEFAULT '' CHECK (char_length(detail) <= 80),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- The server's hourly touches, not requests (see above).
  touches integer NOT NULL DEFAULT 1 CHECK (touches >= 1),
  PRIMARY KEY (user_id, source, detail),
  CONSTRAINT user_surfaces_source CHECK (source IN ('mcp', 'app', 'cli', 'sdk', 'extension', 'web', 'api'))
);

-- The administrator's questions: who used a surface, and who was there lately.
CREATE INDEX IF NOT EXISTS user_surfaces_source_idx
  ON public.user_surfaces (source, last_seen_at DESC);

ALTER TABLE public.user_surfaces ENABLE ROW LEVEL SECURITY;
-- Nothing through PostgREST; the server's role by name, never by default.
REVOKE ALL ON public.user_surfaces FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_surfaces TO service_role;

-- The server's one write: a known surface is touched (last_seen_at moves, the
-- touch counts); a new one is inserted while the account is under its cap of
-- 50 rows, and otherwise not recorded. The INSERT keeps its ON CONFLICT for
-- two first sightings racing.
CREATE OR REPLACE FUNCTION public.touch_user_surface(p_user_id uuid, p_source text, p_detail text) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_detail text := left(coalesce(p_detail, ''), 80);
BEGIN
  UPDATE public.user_surfaces
     SET last_seen_at = now(), touches = touches + 1
   WHERE user_id = p_user_id AND source = p_source AND detail = v_detail;
  IF FOUND THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM public.user_surfaces WHERE user_id = p_user_id) >= 50 THEN
    RETURN;
  END IF;
  INSERT INTO public.user_surfaces (user_id, source, detail)
  VALUES (p_user_id, p_source, v_detail)
  -- The existing row, by the statement's own target name: resolved by the
  -- statement, not by the (empty) search path.
  ON CONFLICT (user_id, source, detail) DO UPDATE
    SET last_seen_at = now(), touches = user_surfaces.touches + 1;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_user_surface(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_user_surface(uuid, text, text) TO service_role;
