-- Per-user favorite voices: a premade voice, a Voice Library voice or one of the
-- user's own clones, starred from any client (an app, the SDK, the CLI, an
-- agent) and read back by all of them, newest first.
--
-- Service-role only, like saved_posts (446) and collections (462): the API
-- routes (backend/src/routes/voice-favorites.ts) are the one way in, each
-- scoped to the caller. No client role holds a privilege on the table, so RLS
-- is on with no policies and a browser cannot reach the rows through PostgREST
-- (past the per-user cap, or with values the routes refuse).
-- supabase/tests/voice-favorites.behavior.sql proves it as the roles.
CREATE TABLE IF NOT EXISTS public.voice_favorites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The voice as text-to-speech takes it: a premade voice's id, a Voice Library
  -- voice's id, or a clone's ElevenLabs voice id. No FK — a library voice is not
  -- a row of ours, and a clone's row may go while the star stays harmless.
  voice_id    TEXT NOT NULL CHECK (char_length(voice_id) BETWEEN 1 AND 200),
  voice_type  TEXT NOT NULL CHECK (voice_type IN ('premade', 'library', 'custom')),
  -- The snapshot the client starred the voice by, so a favorites list renders
  -- with no second lookup; refreshed on every re-star (upsert).
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  preview_url TEXT CHECK (preview_url IS NULL OR char_length(preview_url) <= 2048),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, voice_id)
);

-- The one query: a user's favorites, newest first.
CREATE INDEX IF NOT EXISTS idx_voice_favorites_user_created
  ON public.voice_favorites (user_id, created_at DESC);

ALTER TABLE public.voice_favorites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.voice_favorites FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.voice_favorites TO service_role;

COMMENT ON TABLE public.voice_favorites IS
  'Per-user favorite voices (a premade voice, a Voice Library voice or an own clone) with the name and preview they were starred by. Service-role only: read and written through /v1/voices/favorites.';
