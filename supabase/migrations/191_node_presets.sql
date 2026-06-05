-- Node presets: per-user named snapshots of a node's reusable configuration.
-- Factory presets are code-defined in @nodaro/shared and are NOT stored here.

CREATE TABLE IF NOT EXISTS public.node_presets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  node_type   TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_node_presets_user_type
  ON public.node_presets (user_id, node_type, created_at DESC);

-- One preset name per (user, node_type), case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS uq_node_presets_user_type_name
  ON public.node_presets (user_id, node_type, LOWER(name));

ALTER TABLE public.node_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS node_presets_own ON public.node_presets;
CREATE POLICY node_presets_own ON public.node_presets
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.node_presets IS
  'Per-user named node configuration presets. data is capture-shaped (no runtime/label/fieldMappings).';
