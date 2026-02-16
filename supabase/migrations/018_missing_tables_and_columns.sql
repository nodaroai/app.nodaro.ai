-- Migration 018: Add tables and columns that exist in production but had no migration.
-- These were previously created manually via SQL Editor.
-- All statements are idempotent for safe re-execution.

-- ============================================================
-- 1. TABLES — faces, locations, objects, admin_alerts, tier_config
-- ============================================================

-- Faces (face references for character generation)
CREATE TABLE IF NOT EXISTS faces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  workflow_id UUID,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  style TEXT,
  source_image_url TEXT,
  expressions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Locations (location consistency across scenes)
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  workflow_id UUID,
  node_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  style TEXT,
  main_image_url TEXT,
  time_of_day JSONB,
  weather JSONB,
  angles JSONB,
  custom_variations JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  source_image_url TEXT,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE
);

-- Objects (prop/object consistency across scenes)
CREATE TABLE IF NOT EXISTS objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  workflow_id UUID,
  node_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  style TEXT,
  main_image_url TEXT,
  angles JSONB,
  materials JSONB,
  variations JSONB,
  custom_variations JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  source_image_url TEXT,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE
);

-- Admin alerts (cost monitoring)
CREATE TABLE IF NOT EXISTS admin_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  is_resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tier configuration (credit limits per plan)
CREATE TABLE IF NOT EXISTS tier_config (
  tier TEXT PRIMARY KEY,
  monthly_credits INTEGER NOT NULL,
  daily_credit_limit INTEGER,
  price_usd DECIMAL(10,2) NOT NULL,
  features JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. MISSING COLUMNS on existing tables
-- ============================================================

-- characters: user_id for direct ownership queries
ALTER TABLE characters ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

-- jobs: usage_log_id linking job to its credit reservation
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS usage_log_id UUID;

-- ============================================================
-- 3. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_faces_user_id ON faces(user_id);
CREATE INDEX IF NOT EXISTS idx_faces_project_id ON faces(project_id);
CREATE INDEX IF NOT EXISTS idx_faces_node_id ON faces(node_id);

CREATE INDEX IF NOT EXISTS idx_locations_user_id ON locations(user_id);
CREATE INDEX IF NOT EXISTS idx_locations_project_id ON locations(project_id);
CREATE INDEX IF NOT EXISTS idx_locations_node_id ON locations(node_id);

CREATE INDEX IF NOT EXISTS idx_objects_user_id ON objects(user_id);
CREATE INDEX IF NOT EXISTS idx_objects_project_id ON objects(project_id);
CREATE INDEX IF NOT EXISTS idx_objects_node_id ON objects(node_id);

CREATE INDEX IF NOT EXISTS idx_admin_alerts_type ON admin_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_resolved ON admin_alerts(is_resolved) WHERE is_resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_characters_user_id ON characters(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_usage_log_id ON jobs(usage_log_id);

-- ============================================================
-- 4. RLS
-- ============================================================

ALTER TABLE faces ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tier_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'faces' AND policyname = 'Users can CRUD own faces') THEN
    CREATE POLICY "Users can CRUD own faces" ON faces
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'locations' AND policyname = 'Users can CRUD own locations') THEN
    CREATE POLICY "Users can CRUD own locations" ON locations
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Users can CRUD own objects') THEN
    CREATE POLICY "Users can CRUD own objects" ON objects
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'admin_alerts' AND policyname = 'Admins can manage alerts') THEN
    CREATE POLICY "Admins can manage alerts" ON admin_alerts
      FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tier_config' AND policyname = 'Anyone can read tier config') THEN
    CREATE POLICY "Anyone can read tier config" ON tier_config
      FOR SELECT USING (true);
  END IF;
END $$;
