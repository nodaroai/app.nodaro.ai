-- Add prompt_templates JSONB column to profiles
-- Stores user-level template overrides (key -> template string)
-- Empty object means "use all system defaults"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS prompt_templates JSONB DEFAULT '{}';
