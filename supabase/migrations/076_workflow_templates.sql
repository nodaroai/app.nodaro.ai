-- Workflow templates: discoverable, cloneable workflow snapshots

-- workflow_templates table
CREATE TABLE IF NOT EXISTS workflow_templates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id           UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  creator_id            UUID NOT NULL REFERENCES auth.users(id),
  slug                  TEXT UNIQUE,
  name                  TEXT NOT NULL,
  description           TEXT CHECK (char_length(description) <= 500),
  markdown_description  TEXT,
  snapshot_nodes        JSONB NOT NULL DEFAULT '[]',
  snapshot_edges        JSONB NOT NULL DEFAULT '[]',
  snapshot_settings     JSONB NOT NULL DEFAULT '{}',
  node_types_used       TEXT[] NOT NULL DEFAULT '{}',
  providers_used        TEXT[] NOT NULL DEFAULT '{}',
  node_count            INT NOT NULL DEFAULT 0,
  estimated_credits     INT NOT NULL DEFAULT 0,
  complexity            TEXT NOT NULL DEFAULT 'simple' CHECK (complexity IN ('simple', 'intermediate', 'advanced')),
  category              TEXT NOT NULL DEFAULT 'other',
  output_types          TEXT[] NOT NULL DEFAULT '{}',
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  preview_media_url     TEXT,
  preview_media_type    TEXT,
  creator_display_name  TEXT,
  clone_count           INT NOT NULL DEFAULT 0,
  favorite_count        INT NOT NULL DEFAULT 0,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  is_listed             BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_vector         tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig, coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(immutable_array_to_string(tags, ' '), '')), 'C')
  ) STORED
);

-- template_favorites table
CREATE TABLE IF NOT EXISTS template_favorites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id   UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, template_id)
);

-- Backref: link cloned workflows to their source template
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES workflow_templates(id);

-- -------------------------------------------------------
-- Indexes: workflow_templates
-- -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_wf_templates_slug
  ON workflow_templates(slug)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_wf_templates_creator_id
  ON workflow_templates(creator_id);

CREATE INDEX IF NOT EXISTS idx_wf_templates_workflow_id
  ON workflow_templates(workflow_id);

CREATE INDEX IF NOT EXISTS idx_wf_templates_browse
  ON workflow_templates(created_at DESC)
  WHERE is_listed = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_wf_templates_tags
  ON workflow_templates USING GIN(tags)
  WHERE is_listed = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_wf_templates_node_types
  ON workflow_templates USING GIN(node_types_used);

CREATE INDEX IF NOT EXISTS idx_wf_templates_providers
  ON workflow_templates USING GIN(providers_used);

CREATE INDEX IF NOT EXISTS idx_wf_templates_search_vector
  ON workflow_templates USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_wf_templates_popular
  ON workflow_templates(clone_count DESC)
  WHERE is_listed = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_wf_templates_favorited
  ON workflow_templates(favorite_count DESC)
  WHERE is_listed = true AND is_active = true;

-- Indexes: template_favorites
CREATE INDEX IF NOT EXISTS idx_template_favorites_user_id ON template_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_template_favorites_template_id ON template_favorites(template_id);

-- -------------------------------------------------------
-- RLS: workflow_templates
-- -------------------------------------------------------
ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workflow_templates' AND policyname = 'Anyone can read active templates') THEN
    CREATE POLICY "Anyone can read active templates"
      ON workflow_templates FOR SELECT
      USING (is_active = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workflow_templates' AND policyname = 'Creator can manage own templates') THEN
    CREATE POLICY "Creator can manage own templates"
      ON workflow_templates FOR ALL
      USING (creator_id = auth.uid());
  END IF;
END $$;

-- -------------------------------------------------------
-- RLS: template_favorites
-- -------------------------------------------------------
ALTER TABLE template_favorites ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'template_favorites' AND policyname = 'Users can read own template favorites') THEN
    CREATE POLICY "Users can read own template favorites"
      ON template_favorites FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'template_favorites' AND policyname = 'Users can insert own template favorites') THEN
    CREATE POLICY "Users can insert own template favorites"
      ON template_favorites FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'template_favorites' AND policyname = 'Users can delete own template favorites') THEN
    CREATE POLICY "Users can delete own template favorites"
      ON template_favorites FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- -------------------------------------------------------
-- Trigger: update favorite_count on template_favorites INSERT/DELETE
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION update_template_favorite_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE workflow_templates SET favorite_count = favorite_count + 1 WHERE id = NEW.template_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE workflow_templates SET favorite_count = favorite_count - 1 WHERE id = OLD.template_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_template_favorite_count ON template_favorites;
CREATE TRIGGER trg_update_template_favorite_count
  AFTER INSERT OR DELETE ON template_favorites
  FOR EACH ROW
  EXECUTE FUNCTION update_template_favorite_count();

-- -------------------------------------------------------
-- Trigger: updated_at on workflow_templates
-- -------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at ON workflow_templates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON workflow_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
