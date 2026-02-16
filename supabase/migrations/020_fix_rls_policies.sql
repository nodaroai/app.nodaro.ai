-- Migration 020: Add missing RLS policies to match production
-- Adds granular asset policies (INSERT/UPDATE/DELETE with library_item + admin)
-- and fixes faces to use per-operation policies instead of ALL.

-- ============================================================
-- 1. ASSETS — granular library + admin policies
-- ============================================================

-- Users can view own, shared, and library assets
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'assets' AND policyname = 'Users can view own and shared assets') THEN
    CREATE POLICY "Users can view own and shared assets" ON assets
      FOR SELECT USING (
        user_id = auth.uid() OR is_shared = true OR is_library_item = true
      );
  END IF;
END $$;

-- Users can insert assets (library items require admin)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'assets' AND policyname = 'Users can insert assets with restrictions') THEN
    CREATE POLICY "Users can insert assets with restrictions" ON assets
      FOR INSERT WITH CHECK (
        user_id = auth.uid() AND (is_library_item = false OR (is_library_item = true AND is_admin()))
      );
  END IF;
END $$;

-- Users can update own assets, admins can update library items
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'assets' AND policyname = 'Users can update own assets or admins can update library') THEN
    CREATE POLICY "Users can update own assets or admins can update library" ON assets
      FOR UPDATE USING (
        user_id = auth.uid() OR (is_library_item = true AND is_admin())
      ) WITH CHECK (
        user_id = auth.uid() OR (is_library_item = true AND is_admin())
      );
  END IF;
END $$;

-- Users can delete own assets, admins can delete library items
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'assets' AND policyname = 'Users can delete own assets or admins can delete library') THEN
    CREATE POLICY "Users can delete own assets or admins can delete library" ON assets
      FOR DELETE USING (
        user_id = auth.uid() OR (is_library_item = true AND is_admin())
      );
  END IF;
END $$;

-- ============================================================
-- 2. FACES — per-operation policies (replace ALL from migration 018)
-- ============================================================

-- Drop the ALL policy from migration 018 if it exists
DROP POLICY IF EXISTS "Users can CRUD own faces" ON faces;

-- Recreate as 4 separate per-operation policies matching production
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'faces' AND policyname = 'Users can view own faces') THEN
    CREATE POLICY "Users can view own faces" ON faces
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'faces' AND policyname = 'Users can insert own faces') THEN
    CREATE POLICY "Users can insert own faces" ON faces
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'faces' AND policyname = 'Users can update own faces') THEN
    CREATE POLICY "Users can update own faces" ON faces
      FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'faces' AND policyname = 'Users can delete own faces') THEN
    CREATE POLICY "Users can delete own faces" ON faces
      FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;
