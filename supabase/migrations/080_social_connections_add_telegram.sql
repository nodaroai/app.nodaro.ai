-- Add 'telegram' to social_connections platform CHECK constraint
ALTER TABLE social_connections DROP CONSTRAINT IF EXISTS social_connections_platform_check;
ALTER TABLE social_connections ADD CONSTRAINT social_connections_platform_check
  CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'facebook', 'telegram'));
