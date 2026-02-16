-- Migration 006: Add library columns to assets table
-- These columns are required by admin.ts promote/demote endpoints

-- Whether this asset is promoted to the shared library (admin only)
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS is_library_item BOOLEAN NOT NULL DEFAULT FALSE;

-- Source of the upload: manual_upload, api, generation, library
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS upload_source TEXT DEFAULT 'manual_upload';

-- Performance indexes for library queries
CREATE INDEX IF NOT EXISTS idx_assets_user_type ON public.assets(user_id, type);
CREATE INDEX IF NOT EXISTS idx_assets_is_library_item ON public.assets(is_library_item) WHERE is_library_item = TRUE;

-- RLS: Users can view shared library items (read-only)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'assets' AND policyname = 'Users can view library items') THEN
    CREATE POLICY "Users can view library items" ON public.assets
        FOR SELECT USING (is_library_item = TRUE);
  END IF;
END $$;
