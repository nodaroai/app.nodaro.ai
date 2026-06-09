-- Per-user favorites for node presets (factory presets AND user presets).
-- Replaces the static "Popular" band in the preset dropdown with a user-driven
-- "Favorites" band. Structure mirrors 055_gallery_favorites.sql, but user_id
-- references public.profiles(id) to match the sibling node_presets table
-- (191_node_presets.sql), NOT auth.users.
CREATE TABLE IF NOT EXISTS node_preset_favorites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  node_type   TEXT NOT NULL,
  -- Polymorphic: a factory preset id ("generate-image/character-board") OR a
  -- user-preset uuid (as text). No FK — a factory id is not a node_presets row.
  -- Orphaned ids are skipped by the dropdown resolver; user-preset deletes are
  -- cleaned up explicitly in DELETE /v1/node-presets/:id.
  preset_id   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, node_type, preset_id)
);

-- Fast lookup of a user's favorites for one node type (the dropdown query).
CREATE INDEX IF NOT EXISTS idx_node_preset_favorites_user_nodetype
  ON node_preset_favorites (user_id, node_type);

-- RLS: a user may only see/modify their own favorites. Policies compare
-- auth.uid() = user_id only (they never query profiles → no RLS-recursion trap).
ALTER TABLE node_preset_favorites ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'node_preset_favorites' AND policyname = 'Users can read own preset favorites') THEN
    CREATE POLICY "Users can read own preset favorites" ON node_preset_favorites FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'node_preset_favorites' AND policyname = 'Users can insert own preset favorites') THEN
    CREATE POLICY "Users can insert own preset favorites" ON node_preset_favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'node_preset_favorites' AND policyname = 'Users can delete own preset favorites') THEN
    CREATE POLICY "Users can delete own preset favorites" ON node_preset_favorites FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;
