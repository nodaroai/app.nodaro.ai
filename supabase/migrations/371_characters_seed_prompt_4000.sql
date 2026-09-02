-- App-reports triage 2026-09-01 (internal planning doc, §4.5, decisions
-- 3 + 7). Raise the character seed-prompt ceiling 2000 -> 4000.
--
-- WHY. `seed_prompt` is the user-authored identity scaffold the Character
-- Studio composes into every portrait prompt. Migration 117 capped it at 2000
-- and `routes/characters.ts` mirrors that cap so the API returns a clean 400
-- instead of a Postgres 23514. One 2026-08-31 app-report row is a 4000-ish
-- studio-authored seed prompt rejected at the boundary.
--
-- SCOPE. CHARACTER ONLY. The object / creature / location entity family keeps
-- its 2000-char `seedPromptHint` (four entity-studio specs standardised it);
-- see the comment on `routes/characters.ts` seedPrompt.
--
-- ORDERING. This migration MUST reach production BEFORE the app that accepts
-- 4000 chars. Raising the Zod cap first turns today's honest 400 into a 500.
--
-- `canonical_description` (also added by 117, capped 4000) is unchanged.
-- `characters` is the ONLY table with a `seed_prompt` CHECK
-- (`git grep seed_prompt supabase/migrations/` confirms), so this file is
-- the complete change.

ALTER TABLE public.characters
  DROP CONSTRAINT IF EXISTS characters_seed_prompt_check;
ALTER TABLE public.characters
  DROP CONSTRAINT IF EXISTS characters_seed_prompt_4000_check;
ALTER TABLE public.characters
  ADD CONSTRAINT characters_seed_prompt_4000_check
  CHECK (seed_prompt IS NULL OR char_length(seed_prompt) <= 4000);

COMMENT ON COLUMN public.characters.seed_prompt IS
  'User-authored identity scaffold folded into portrait prompts. Max 4000 chars (raised from 2000, migration 371). Character-only: entity seedPromptHint stays at 2000.';
