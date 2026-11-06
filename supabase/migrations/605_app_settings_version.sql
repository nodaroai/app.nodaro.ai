-- A version number for app_settings, moved by the database on every write.
--
-- Every backend process (the API, each worker, each replica) keeps the app
-- settings in memory: getAppSettings() (backend/src/lib/app-settings.ts) and
-- the smaller config readers built the same way. They share one database but
-- not memory, so a save made through one process used to reach the others
-- only when their cache expired, up to 60 s later: a run started seconds
-- after an admin saved a setting could still run on the old value.
--
-- Each cache now remembers the version it was read at and, before trusting
-- what it holds, reads this one row (at most about once a second per process,
-- lib/app-settings-version.ts). A different number means a write happened
-- somewhere, and the cache reads the settings again.
--
-- WHY A TRIGGER. The version is moved here, in the database, by every
-- statement that writes app_settings: the admin routes, the stores in lib/,
-- the trend catalog stamp, scripts, a hand edit in the SQL editor, a later
-- migration. A writer cannot forget to move it, because no writer moves it.
-- `updated_at` could not serve: a delete leaves no row behind, and several
-- writers upsert without setting it.
--
-- Per STATEMENT, not per row, so a TRUNCATE moves it too, and a write that
-- matched no row (an optimistic-concurrency miss) moves it harmlessly: the
-- caches read once more and find nothing changed.
--
-- Read by the service role only. RLS is on with no policy, and the table is
-- revoked from anon and authenticated; the trigger function is SECURITY
-- DEFINER so the bump never depends on the writer's own rights.
--
-- Re-runnable: CI re-applies the newest migration to prove idempotency.

CREATE TABLE IF NOT EXISTS public.app_settings_version (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version BIGINT NOT NULL DEFAULT 0
);

INSERT INTO public.app_settings_version (id, version) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_settings_version ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_settings_version FROM PUBLIC;
REVOKE ALL ON public.app_settings_version FROM anon;
REVOKE ALL ON public.app_settings_version FROM authenticated;
GRANT SELECT ON public.app_settings_version TO service_role;

COMMENT ON TABLE public.app_settings_version IS
  'One row: a number every write to app_settings moves (trigger app_settings_bump_version). '
  'Backend processes compare it with the number their in-memory settings were read at.';

-- An upsert, so a deleted version row comes back on the next write instead
-- of leaving every cache on its TTL.
CREATE OR REPLACE FUNCTION public.bump_app_settings_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.app_settings_version AS v (id, version) VALUES (1, 1)
    ON CONFLICT (id) DO UPDATE SET version = v.version + 1;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.bump_app_settings_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_app_settings_version() FROM anon;
REVOKE ALL ON FUNCTION public.bump_app_settings_version() FROM authenticated;

DROP TRIGGER IF EXISTS app_settings_bump_version ON public.app_settings;
CREATE TRIGGER app_settings_bump_version
  AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.app_settings
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_app_settings_version();
