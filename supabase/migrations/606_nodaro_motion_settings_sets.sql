-- Nodaro Motion's stored settings sets: named copies of every setting the
-- Admin → Nodaro Motion page edits, kept to load as a draft, export and import
-- (backend/src/ee/routes/admin-nodaro-motion-settings-sets.ts).
--
-- `settings` is keyed by the page's sections (NODARO_MOTION_SETTINGS_SECTIONS,
-- backend/src/ee/routes/admin-nodaro-motion.ts), each value the body that
-- section's save route takes, as it stores it. `format_version` is the shape
-- of `settings` when the set was saved: a set from an older version is read
-- through the server's upgrades, so it never has to be rewritten here.
--
-- A table of its own, not app_settings: a set is never a live setting. Every
-- backend process keeps app_settings in memory and reads it again on each write
-- there (605's version trigger); nothing reads these rows but the admin page.
-- Loading a set fills the page as a draft, and each section is saved through
-- its own route, so nothing here ever changes what runs do.
--
-- `live_at` is when the admin page last saw the live settings match the set
-- (what the page names as live, and as "edited" afterwards).
--
-- Read and written by the API with the service role only: RLS on with no
-- policy, and revoked from anon and authenticated (the 548 posture).
--
-- Re-runnable: CI re-applies the newest migration to prove idempotency.

CREATE TABLE IF NOT EXISTS public.nodaro_motion_settings_sets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  format_version  INTEGER NOT NULL CHECK (format_version >= 1),
  settings        JSONB NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  live_at         TIMESTAMPTZ
);

-- One set per name, case aside: the list shows names, and an import names its set.
CREATE UNIQUE INDEX IF NOT EXISTS nodaro_motion_settings_sets_name_key
  ON public.nodaro_motion_settings_sets (lower(btrim(name)));

ALTER TABLE public.nodaro_motion_settings_sets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nodaro_motion_settings_sets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.nodaro_motion_settings_sets TO service_role;

COMMENT ON TABLE public.nodaro_motion_settings_sets IS
  'Named copies of every Nodaro Motion admin setting (one key per admin section, each the body of its save route). '
  'Never read by runs: the admin page loads a set as a draft and saves it through each section''s own route.';
