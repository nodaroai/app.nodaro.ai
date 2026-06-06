-- Preset organization: groups (folders + sections) + grouping/tags/order columns on node_presets.

CREATE TABLE IF NOT EXISTS public.node_preset_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  node_type   TEXT NOT NULL,
  name        TEXT NOT NULL,
  -- 'folder' = collapsible container; 'section' = always-open inline group header.
  kind        TEXT NOT NULL DEFAULT 'folder' CHECK (kind IN ('folder', 'section')),
  sort_order  INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_node_preset_groups_user_type
  ON public.node_preset_groups (user_id, node_type, sort_order);

ALTER TABLE public.node_preset_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS node_preset_groups_own ON public.node_preset_groups;
CREATE POLICY node_preset_groups_own ON public.node_preset_groups
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.node_preset_groups IS
  'Per-user folders/sections for organizing node_presets (kind discriminator). Single level.';

-- Grouping / tags / ordering on presets. group_id null = root; ON DELETE SET NULL so deleting a
-- folder/section moves its presets back to root rather than orphaning them.
ALTER TABLE public.node_presets
  ADD COLUMN IF NOT EXISTS group_id   UUID REFERENCES public.node_preset_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tags       JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sort_order INT   NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_node_presets_group ON public.node_presets (group_id);
