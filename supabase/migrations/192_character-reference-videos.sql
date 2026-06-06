-- supabase/migrations/192_character-reference-videos.sql
--
-- Persist user-uploaded reference VIDEOS on the Character row, keyed by a
-- caller-owned label (e.g. emotion takes: "angry" / "nervous" / "tired" /
-- "in-love" / "happy"). Mirrors `real_life_refs_by_variant` (images, migration
-- 117): same per-variant JSONB map shape, same caps enforced at the API
-- boundary (max 20 keys, 5 URLs each). Stores R2 URLs only — the upload path
-- already returns URLs; this is persistence on the row so the saved clips can
-- be read back and passed to generate-video's `referenceVideoUrls` input.

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS reference_videos_by_variant JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.characters.reference_videos_by_variant IS
  'Per-label slot of user-uploaded reference VIDEO URLs (R2). Keyed lowercased+trimmed (e.g. "angry"). Mirrors real_life_refs_by_variant (images). Max 20 keys, 5 videos each. Fed to generate-video referenceVideoUrls by reading off the row.';
