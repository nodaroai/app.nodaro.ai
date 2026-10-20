-- Trends catalog (decided 2026-10-20, Trends Part A): a trend is a ready-made
-- Cast Swap recipe — a source clip, its slots and its prompt parts — that a
-- person runs with their own pictures. Admins build and publish trends; users
-- browse the published ones, run them and keep favorites.
--
-- Three tables:
--   * trends          — one row per trend: its slug (the public address), its
--     catalog status, tags, badges and order, and two version numbers. Editing
--     a trend writes its draft version; publishing points published_version at
--     it. What users see is always published_version, so editing a published
--     trend changes nothing for them until it is republished.
--   * trend_versions  — each version's full snapshot as JSON (slots, examples,
--     hidden source clip, references and prompt parts). Never edited once
--     published: a run keeps reading its own version after the trend moves on
--     or is unpublished.
--   * trend_favorites — a user's saved trends, newest first.
--
-- The slug is a path segment and can never be 'runs': /v1/trends/runs is the
-- run list, and a trend at that slug would be unreachable.
--
-- A trend version holds hidden data (the source clip, slot role names, fixed
-- references, the trend prompt) that never leaves the server. Every table here
-- is reached only through the API, which decides what is public and scopes
-- favorites to the caller: RLS on, no client grants (the 518 posture).

CREATE TABLE IF NOT EXISTS public.trends (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$' AND slug <> 'runs'),
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'unpublished')),
  tags               TEXT[] NOT NULL DEFAULT '{}',
  badges             TEXT[] NOT NULL DEFAULT '{}' CHECK (badges <@ ARRAY['trending', 'new']::TEXT[]),
  sort_order         INT NOT NULL DEFAULT 0,
  -- The version the admin edits, and the one users see (NULL = never published).
  draft_version      INT NOT NULL DEFAULT 1,
  published_version  INT,
  created_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The catalog's keyset: published trends in their order.
CREATE INDEX IF NOT EXISTS idx_trends_status_sort
  ON public.trends (status, sort_order, id);

CREATE TABLE IF NOT EXISTS public.trend_versions (
  trend_id      UUID NOT NULL REFERENCES public.trends(id) ON DELETE CASCADE,
  version       INT NOT NULL,
  data          JSONB NOT NULL,
  -- A new value on every write of `data`: the admin's draft writes are
  -- guarded on the revision they read (optimistic concurrency).
  revision      UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at  TIMESTAMPTZ,
  PRIMARY KEY (trend_id, version)
);

CREATE TABLE IF NOT EXISTS public.trend_favorites (
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  trend_id    UUID NOT NULL REFERENCES public.trends(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, trend_id)
);

-- A user's favorites list, newest first.
CREATE INDEX IF NOT EXISTS idx_trend_favorites_user_created
  ON public.trend_favorites (user_id, created_at DESC);

ALTER TABLE public.trends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trend_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trend_favorites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trends FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.trends TO service_role;
REVOKE ALL ON public.trend_versions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.trend_versions TO service_role;
REVOKE ALL ON public.trend_favorites FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.trend_favorites TO service_role;

COMMENT ON TABLE public.trends IS
  'Trend catalog: one row per trend. Users see published_version only; editing writes draft_version.';
COMMENT ON TABLE public.trend_versions IS
  'Each trend version''s full snapshot (holds hidden data: source clip, role names, references, prompt). Server only.';
COMMENT ON TABLE public.trend_favorites IS
  'A user''s favorite trends.';
