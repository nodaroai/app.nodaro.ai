-- Copilot per-user memory (M1): correct the copilot once, it remembers forever.
--
-- User-scoped ONLY — no thread scope, no workspace scope. A workspace-shared
-- memory crosses users, which turns one user's "correction" into another
-- user's instruction; that needs an untrusted-wrapping design and is
-- deliberately deferred (see the brand-brain plan §6).
--
-- Writes go through the service role (the `remember` native tool + the
-- copilot routes, both ownership-checked in code). RLS gives the owner
-- SELECT and DELETE so the panel could read straight from Supabase if it
-- ever wants to; the content cap is enforced BOTH here (CHECK) and in the
-- tool (friendly message) — mutation tests cover both.

CREATE TABLE IF NOT EXISTS public.copilot_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) <= 400),
  source_thread_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The injection path reads "newest first, per user" on every turn.
CREATE INDEX IF NOT EXISTS copilot_memories_user_created_idx
  ON public.copilot_memories (user_id, created_at DESC);

-- The duplicate no-op is enforced HERE, not only by the tool's read-then-insert
-- (two concurrent turns both reading then both inserting would silently double
-- a memory — and a doubled memory doubles its preamble line every turn).
-- The code treats 23505 as "duplicate". The 50-per-user cap stays code-enforced:
-- overshooting it by one row under a race is harmless, duplicates are not.
CREATE UNIQUE INDEX IF NOT EXISTS copilot_memories_user_content_uniq
  ON public.copilot_memories (user_id, content);

ALTER TABLE public.copilot_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS copilot_memories_owner_select ON public.copilot_memories;
CREATE POLICY copilot_memories_owner_select ON public.copilot_memories
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS copilot_memories_owner_delete ON public.copilot_memories;
CREATE POLICY copilot_memories_owner_delete ON public.copilot_memories
  FOR DELETE USING (auth.uid() = user_id);

-- Supabase grants anon explicitly, so REVOKE FROM PUBLIC alone is not enough.
REVOKE ALL ON TABLE public.copilot_memories FROM PUBLIC;
REVOKE ALL ON TABLE public.copilot_memories FROM anon;
GRANT SELECT, DELETE ON TABLE public.copilot_memories TO authenticated;
