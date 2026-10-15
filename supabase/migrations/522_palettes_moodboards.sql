-- User colour palettes and moodboards (decided 2026-10-15): a person keeps
-- their own named palettes and moodboards and uses one as a DIRECTION on
-- generate-image, beside the built-in colour-look and style catalogs:
--   direction.colorLook = 'palette:<id>'   -> the palette's colours, named, in the prompt
--   direction.style     = 'moodboard:<id>' -> the moodboard's description in the prompt
--                                             and its images as style references
-- The id is what a job records; the platform resolves it on every run, so an
-- edited palette reaches the next run and a deleted one is refused (404).
--
-- Two tables, one row per palette / moodboard, owned by one person:
--   * color_palettes — a name, 2..12 colours as '#RRGGBB' (upper case: the API
--     normalizes before it writes), an optional note.
--   * moodboards     — a name, an optional description (the words that go into
--     the prompt), 1..12 images as {url, caption?}. An image is a LINK, never a
--     copy: the API stores the url the caller gave (an http(s) address that
--     passed the same SSRF gate as every reference image), and the image lives
--     as long as whatever it points at.
--
-- Personal data, reached only through the API, which scopes every query to the
-- caller: RLS on, no client grants (the migration-446 / 462 / 518 posture).
-- The CHECKs repeat the API's own validation so a writer that forgets it
-- cannot store a palette the prompt renderer would choke on.
--
-- Lists page newest first by (created_at, id) — a keyset over a column an edit
-- never moves, so paging is stable while the person edits.

CREATE TABLE IF NOT EXISTS public.color_palettes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80 AND btrim(name) <> ''),
  -- Every element '#RRGGBB' upper case, none NULL, 2..12 of them. The joined
  -- string is matched whole, so one bad element fails the row.
  colors       TEXT[] NOT NULL CHECK (
                 cardinality(colors) BETWEEN 2 AND 12
                 AND array_position(colors, NULL) IS NULL
                 AND array_to_string(colors, ',') ~ '^#[0-9A-F]{6}(,#[0-9A-F]{6})*$'
               ),
  description  TEXT CHECK (description IS NULL OR char_length(description) <= 500),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_color_palettes_user_created
  ON public.color_palettes (user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.moodboards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80 AND btrim(name) <> ''),
  description  TEXT CHECK (description IS NULL OR char_length(description) <= 1000),
  -- 1..12 objects, each with a string url and, when present, a string caption.
  -- (Lengths and the url's safety are the API's: SQL/JSON path has no string
  -- length, and a regex bound stops at 255.)
  -- CASE, not AND: Postgres does not promise to evaluate AND left to right, and
  -- jsonb_array_length raises on a non-array instead of answering false.
  images       JSONB NOT NULL CHECK (
                 CASE WHEN jsonb_typeof(images) = 'array' THEN
                   jsonb_array_length(images) BETWEEN 1 AND 12
                   AND NOT jsonb_path_exists(images, '$[*] ? (@.type() != "object")')
                   AND NOT jsonb_path_exists(images, '$[*] ? (!(exists(@.url)))')
                   AND NOT jsonb_path_exists(images, '$[*].url ? (@.type() != "string")')
                   AND NOT jsonb_path_exists(images, '$[*].caption ? (@.type() != "string")')
                 ELSE false END
               ),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moodboards_user_created
  ON public.moodboards (user_id, created_at DESC, id DESC);

ALTER TABLE public.color_palettes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moodboards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.color_palettes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.color_palettes TO service_role;
REVOKE ALL ON public.moodboards FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.moodboards TO service_role;
