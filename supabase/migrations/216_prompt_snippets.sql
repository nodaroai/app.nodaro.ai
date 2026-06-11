-- Prompt snippets: per-user reusable inline prompt fragments.
-- Factory snippets are code-defined in @nodaro/shared and are NOT stored here.
-- Scoping: target = which field menu (prompt/negative); media = node modalities
***REDACTED-OSS-SCRUB***

CREATE TABLE IF NOT EXISTS public.prompt_snippets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  text        TEXT NOT NULL,
  target      TEXT NOT NULL DEFAULT 'prompt' CHECK (target IN ('prompt', 'negative')),
  media       TEXT[] NOT NULL DEFAULT '{}'::text[],
  category    TEXT,
  sort_order  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_snippets_user
  ON public.prompt_snippets (user_id, created_at DESC);

-- One snippet name per user, case-insensitive (mirrors node_presets).
CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_snippets_user_name
  ON public.prompt_snippets (user_id, LOWER(name));

ALTER TABLE public.prompt_snippets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prompt_snippets_own ON public.prompt_snippets;
CREATE POLICY prompt_snippets_own ON public.prompt_snippets
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.prompt_snippets IS
  'Per-user reusable inline prompt fragments (slash-menu snippets). text is the exact fragment inserted into prompts.';
