-- App marketplace: add discovery columns, favorites, triggers, indexes

-- New columns on published_apps for marketplace discovery
ALTER TABLE published_apps ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other';
ALTER TABLE published_apps ADD COLUMN IF NOT EXISTS output_types TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE published_apps ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE published_apps ADD COLUMN IF NOT EXISTS preview_media_url TEXT;
ALTER TABLE published_apps ADD COLUMN IF NOT EXISTS preview_media_type TEXT;
ALTER TABLE published_apps ADD COLUMN IF NOT EXISTS supports_remix BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE published_apps ADD COLUMN IF NOT EXISTS creator_display_name TEXT;
ALTER TABLE published_apps ADD COLUMN IF NOT EXISTS total_run_count INT NOT NULL DEFAULT 0;
ALTER TABLE published_apps ADD COLUMN IF NOT EXISTS favorite_count INT NOT NULL DEFAULT 0;

-- Full-text search vector (weighted: name A, description B, tags C)
ALTER TABLE published_apps ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'C')
  ) STORED;

-- App favorites table (follows gallery_favorites pattern)
CREATE TABLE IF NOT EXISTS app_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id UUID NOT NULL REFERENCES published_apps(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_app_favorites_user_id ON app_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_app_favorites_app_id ON app_favorites(app_id);

-- RLS for app_favorites
ALTER TABLE app_favorites ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_favorites' AND policyname = 'Users can read own app favorites') THEN
    CREATE POLICY "Users can read own app favorites" ON app_favorites FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_favorites' AND policyname = 'Users can insert own app favorites') THEN
    CREATE POLICY "Users can insert own app favorites" ON app_favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_favorites' AND policyname = 'Users can delete own app favorites') THEN
    CREATE POLICY "Users can delete own app favorites" ON app_favorites FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- Trigger: increment total_run_count on app_runs INSERT
CREATE OR REPLACE FUNCTION increment_app_run_count() RETURNS TRIGGER AS $$
BEGIN
  UPDATE published_apps SET total_run_count = total_run_count + 1 WHERE id = NEW.app_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_increment_app_run_count ON app_runs;
CREATE TRIGGER trg_increment_app_run_count
  AFTER INSERT ON app_runs
  FOR EACH ROW
  EXECUTE FUNCTION increment_app_run_count();

-- Trigger: update favorite_count on app_favorites INSERT/DELETE
CREATE OR REPLACE FUNCTION update_app_favorite_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE published_apps SET favorite_count = favorite_count + 1 WHERE id = NEW.app_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE published_apps SET favorite_count = favorite_count - 1 WHERE id = OLD.app_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_app_favorite_count ON app_favorites;
CREATE TRIGGER trg_update_app_favorite_count
  AFTER INSERT OR DELETE ON app_favorites
  FOR EACH ROW
  EXECUTE FUNCTION update_app_favorite_count();

-- Indexes for marketplace browsing
CREATE INDEX IF NOT EXISTS idx_published_apps_browse
  ON published_apps(created_at DESC)
  WHERE is_listed = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_published_apps_category
  ON published_apps(category)
  WHERE is_listed = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_published_apps_tags
  ON published_apps USING GIN(tags)
  WHERE is_listed = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_published_apps_search_vector
  ON published_apps USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_published_apps_popular
  ON published_apps(total_run_count DESC)
  WHERE is_listed = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_published_apps_favorited
  ON published_apps(favorite_count DESC)
  WHERE is_listed = true AND is_active = true;

-- Backfill creator_display_name from profiles for existing rows
UPDATE published_apps pa
SET creator_display_name = COALESCE(NULLIF(p.full_name, ''), p.email)
FROM profiles p
WHERE pa.creator_id = p.id
  AND pa.creator_display_name IS NULL;
