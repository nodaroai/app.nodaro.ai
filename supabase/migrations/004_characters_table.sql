-- Characters table for character consistency across scenes
CREATE TABLE IF NOT EXISTS public.characters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    workflow_id UUID,
    node_id TEXT,

    name TEXT NOT NULL,
    description TEXT,
    gender TEXT,
    style TEXT,
    base_outfit TEXT,
    source_image_url TEXT,

    -- Generated assets
    character_sheet JSONB,           -- {frontView, sideView, backView, combinedSheet}
    expressions JSONB DEFAULT '[]',  -- [{name, url}]
    poses JSONB DEFAULT '[]',        -- [{name, url}]
    lighting_variations JSONB DEFAULT '[]',  -- [{name, url}]

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure node_id column exists (may be missing if table was created by an earlier migration)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'characters' AND column_name = 'node_id'
  ) THEN
    ALTER TABLE public.characters ADD COLUMN node_id TEXT;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_characters_project_id ON public.characters(project_id);
CREATE INDEX IF NOT EXISTS idx_characters_node_id ON public.characters(node_id);

-- RLS
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own characters via project" ON public.characters
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND user_id = auth.uid())
    );
