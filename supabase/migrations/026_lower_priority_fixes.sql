-- Migration 026: Lower priority fixes from database audit
-- Fixes: entity table FKs, characters schema gaps, last_daily_reset type,
--        suno-separate pricing entry, gallery_reports INSERT policy

-- ============================================================
-- 1. INTEGRITY: Add missing columns to characters table
--    Migration 001 creates characters with: project_id, name, description,
--    reference_image_url, visual_traits.
--    Migration 004 expects: node_id, workflow_id, gender, style, base_outfit,
--    source_image_url, character_sheet, expressions, poses, lighting_variations.
--    Since both use IF NOT EXISTS, whichever ran first determines the schema.
--    Ensure all expected columns exist.
-- ============================================================

ALTER TABLE characters ADD COLUMN IF NOT EXISTS node_id TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS workflow_id UUID;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS style TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS base_outfit TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS source_image_url TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS character_sheet JSONB DEFAULT '[]';
ALTER TABLE characters ADD COLUMN IF NOT EXISTS expressions JSONB DEFAULT '[]';
ALTER TABLE characters ADD COLUMN IF NOT EXISTS poses JSONB DEFAULT '[]';
ALTER TABLE characters ADD COLUMN IF NOT EXISTS lighting_variations JSONB DEFAULT '[]';
ALTER TABLE characters ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Migration 018 adds user_id IF NOT EXISTS — ensure it's here too
ALTER TABLE characters ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

-- ============================================================
-- 2. INTEGRITY: Add FK constraints on entity table workflow_id columns
--    These are nullable references that currently have no FK enforcement.
-- ============================================================

-- characters.workflow_id → workflows
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'characters' AND constraint_name = 'characters_workflow_id_fkey' AND constraint_schema = 'public'
  ) THEN
    ALTER TABLE characters
      ADD CONSTRAINT characters_workflow_id_fkey
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL;
  END IF;
END $$;

-- faces.workflow_id → workflows
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'faces' AND constraint_name = 'faces_workflow_id_fkey' AND constraint_schema = 'public'
  ) THEN
    ALTER TABLE faces
      ADD CONSTRAINT faces_workflow_id_fkey
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL;
  END IF;
END $$;

-- locations.workflow_id → workflows
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'locations' AND constraint_name = 'locations_workflow_id_fkey' AND constraint_schema = 'public'
  ) THEN
    ALTER TABLE locations
      ADD CONSTRAINT locations_workflow_id_fkey
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL;
  END IF;
END $$;

-- objects.workflow_id → workflows
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'objects' AND constraint_name = 'objects_workflow_id_fkey' AND constraint_schema = 'public'
  ) THEN
    ALTER TABLE objects
      ADD CONSTRAINT objects_workflow_id_fkey
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 3. INTEGRITY: Normalize last_daily_reset column type
--    Migration 017 defines it as DATE, but later code writes TIMESTAMPTZ.
--    Standardize on DATE (the time component is not needed).
-- ============================================================

-- Ensure the column is DATE type (no-op if already DATE)
ALTER TABLE profiles
  ALTER COLUMN last_daily_reset TYPE DATE
  USING last_daily_reset::DATE;

-- ============================================================
-- 4. BILLING: Align suno-separate model_pricing entry
--    The credit guard uses "suno-separate" but DB has "suno-separate-vocal".
--    Rename so admin pricing changes take effect.
-- ============================================================

UPDATE model_pricing
  SET model_identifier = 'suno-separate'
  WHERE model_identifier = 'suno-separate-vocal'
  AND NOT EXISTS (
    SELECT 1 FROM model_pricing WHERE model_identifier = 'suno-separate'
  );

-- ============================================================
-- 5. SECURITY: Remove overly permissive gallery_reports INSERT policy
--    WITH CHECK (true) allows any anonymous PostgREST user to insert.
--    Backend uses service_role for inserts, so no RLS INSERT needed.
-- ============================================================

DROP POLICY IF EXISTS "Anyone can insert reports" ON gallery_reports;

-- ============================================================
-- 6. INTEGRITY: Add indexes on entity table node_id for lookup queries
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_faces_node_id ON faces(node_id) WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_locations_node_id ON locations(node_id) WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_objects_node_id ON objects(node_id) WHERE node_id IS NOT NULL;

-- ============================================================
-- 7. BILLING: Add 'subscription_created' to credit_transactions source CHECK
--    Migration 025 defined the CHECK without this value; provision-credits.ts
--    now uses it to distinguish initial subscription from renewals.
-- ============================================================

ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_source_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_source_check
  CHECK (source IN (
    'subscription_created', 'subscription_renewal', 'one_time_purchase', 'admin_adjustment',
    'usage', 'refund', 'paddle_refund', 'expiry',
    -- Legacy values that may exist in older rows
    'purchase', 'subscription', 'admin', 'renewal', 'topup', 'adjustment'
  ));
