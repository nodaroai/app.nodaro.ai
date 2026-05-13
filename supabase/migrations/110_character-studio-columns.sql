-- Character Studio: add angles (was never persisted), motions, voice, personality
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS angles      JSONB DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS motions     JSONB DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS voice       JSONB,
  ADD COLUMN IF NOT EXISTS personality JSONB;
