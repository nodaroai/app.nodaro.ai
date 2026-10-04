-- Did it work? "I did this" on an action card (competitor tracking, 447).
--
-- competitor_card_actions: one row per card a person acted on. `card` keeps
-- what the card said then (its words, numbers, brand, the posts it rested
-- on), because cards change with every scan. `post_url` is the person's own
-- post that came of it, when they link one (`linked_at`: when). A mark whose
-- card left the wall keeps its row under a suffixed `card_id`, so the card
-- can be marked anew if it comes back. `verdict` is the first verdict a
-- scan of their own brand reached for that post, stored once so it never
-- changes as the post keeps growing; `seen_at` is when they first saw it.
-- `subject_id` is the tracked brand the card was about (null for a card about
-- the whole market); removing that brand keeps the mark.
--
-- Personal data, reached only through the competitors plugin's routes (the
-- service role), like tracked_competitors (447): RLS on and no client grants.
-- One mark per card per person.

CREATE TABLE IF NOT EXISTS public.competitor_card_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  card_id     TEXT NOT NULL CHECK (char_length(card_id) BETWEEN 1 AND 320),
  card_kind   TEXT NOT NULL CHECK (char_length(card_kind) BETWEEN 1 AND 40),
  card        JSONB NOT NULL DEFAULT '{}'::jsonb,
  subject_id  UUID REFERENCES public.tracked_competitors(id) ON DELETE SET NULL,
  post_url    TEXT CHECK (post_url IS NULL OR char_length(post_url) <= 1000),
  linked_at   TIMESTAMPTZ,
  acted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verdict     JSONB,
  seen_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_competitor_card_actions_user_card UNIQUE (user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_competitor_card_actions_user_acted
  ON public.competitor_card_actions (user_id, acted_at DESC);

CREATE INDEX IF NOT EXISTS idx_competitor_card_actions_subject
  ON public.competitor_card_actions (subject_id)
  WHERE subject_id IS NOT NULL;

ALTER TABLE public.competitor_card_actions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.competitor_card_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.competitor_card_actions TO service_role;

COMMENT ON TABLE public.competitor_card_actions IS
  'Per-user marks on action cards they acted on: what the card said, the post that came of it, and its first verdict.';
