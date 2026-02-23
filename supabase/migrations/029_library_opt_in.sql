-- Add opt-in library flag to assets table
-- Assets only appear in Media Library when explicitly saved (in_library = true)
-- Note: is_library_item remains unchanged (admin-promoted shared library items)

ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS in_library BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_assets_in_library ON public.assets(in_library) WHERE in_library = TRUE;
