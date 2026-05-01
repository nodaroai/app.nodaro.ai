-- Add mcp_preferences JSONB column to profiles for per-user MCP defaults.
--
-- Stores sticky picks for model / aspect ratio / resolution / quality across
-- image, video, audio MCP tools. Sparse — only contains keys the user has
-- explicitly set; missing keys fall through to the catalog default.
--
-- Resolution order at MCP call time:
--   explicit tool argument > user's saved pref > catalog default
--
-- Schema (deep-merged on PATCH /v1/user/preferences):
--   {
--     "image": { "model"?, "aspectRatio"?, "resolution"?, "quality"? },
--     "video": { "model"?, "aspectRatio"?, "duration"?, "resolution"? },
--     "audio": { "ttsModel"?, "musicModel"? }
--   }
--
-- We don't enforce a JSON schema check at the DB level because the field set
-- evolves with the catalog — the backend Zod gate at the PATCH route is the
-- right place to validate values. Empty `{}` default keeps reads simple.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS mcp_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN profiles.mcp_preferences IS
  'Per-user MCP tool defaults (image/video/audio model + aspect_ratio + resolution + quality). Sparse JSONB. Missing keys fall back to catalog defaults. Updated via PATCH /v1/user/preferences and the in-widget "Save as default" chip.';
