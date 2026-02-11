-- 015: Face asset type
-- No schema changes needed - face nodes use the existing jobs table
-- and the existing characters table (with category = 'face').
-- The CharacterDefinition.category field in the frontend JSONB
-- already supports "face" as a value.
-- This migration is a no-op placeholder for documentation.

SELECT 1;
