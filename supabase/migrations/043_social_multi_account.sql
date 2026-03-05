-- Allow multiple social accounts per platform per user
-- Drop old unique constraint (one account per platform)
ALTER TABLE social_connections DROP CONSTRAINT IF EXISTS social_connections_user_id_platform_key;

-- Add new unique constraint: prevent duplicate connections to the same platform account
ALTER TABLE social_connections ADD CONSTRAINT social_connections_user_id_platform_user_id_key
  UNIQUE(user_id, platform, platform_user_id);

-- Add display_name for user-friendly labeling
ALTER TABLE social_connections ADD COLUMN IF NOT EXISTS display_name TEXT;
