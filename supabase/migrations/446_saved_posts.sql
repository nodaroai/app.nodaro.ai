-- Saved posts: the inspiration wall. A person saves a post they found (a
-- Social Search result) with a note and tags. `post` is a snapshot of the post
-- as it was when saved (packages/shared/src/social-search.ts `SocialPost`);
-- its still is copied into the person's storage (`thumbnail_asset_id`, an
-- `assets` row with in_library = false) so the wall outlives the platform's
-- signed image links. One save per post per person.
--
-- Personal data. Reached only through the API, which checks every post
-- snapshot before storing it and scopes every query to the caller, so the
-- table is closed to direct client access (RLS on, no client grants).

CREATE TABLE IF NOT EXISTS public.saved_posts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_id             TEXT NOT NULL CHECK (char_length(post_id) BETWEEN 1 AND 300),
  platform            TEXT NOT NULL,
  url                 TEXT NOT NULL CHECK (char_length(url) <= 2000),
  post                JSONB NOT NULL,
  thumbnail_asset_id  UUID REFERENCES public.assets(id) ON DELETE SET NULL,
  thumbnail_url       TEXT,
  note                TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  tags                TEXT[] NOT NULL DEFAULT '{}'::text[],
  source              TEXT NOT NULL DEFAULT 'api' CHECK (source IN ('picker', 'competitors', 'manual', 'api')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_posts_user_post
  ON public.saved_posts (user_id, post_id);

CREATE INDEX IF NOT EXISTS idx_saved_posts_user_created
  ON public.saved_posts (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_saved_posts_tags
  ON public.saved_posts USING GIN (tags);

ALTER TABLE public.saved_posts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.saved_posts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.saved_posts TO service_role;

COMMENT ON TABLE public.saved_posts IS
  'Per-user saved social posts (the inspiration wall): a snapshot of each post, a note, tags, and a copied still.';
