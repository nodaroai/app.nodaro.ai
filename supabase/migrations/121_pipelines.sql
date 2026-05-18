-- Migration 121 — Story-to-Video pipeline schema (Phase 1A)
-- Architecture spec §9; LLM spec v4.0.

-- 1. Core pipeline row ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  workflow_id uuid REFERENCES workflows(id) ON DELETE SET NULL,
  workflow_execution_id uuid REFERENCES workflow_executions(id) ON DELETE SET NULL,
  root_node_id text NOT NULL,

  pipeline_type text NOT NULL
    CHECK (pipeline_type IN ('story_to_video', 'song_to_music_video')),
  activation_mode text NOT NULL
    CHECK (activation_mode IN ('interactive', 'programmatic')),
  mode text NOT NULL
    CHECK (mode IN ('manual', 'auto', 'guided')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','awaiting_approval','completed','failed','cancelled','forked')),
  current_stage text
    CHECK (current_stage IN ('script','characters','objects','locations',
                              'shot_list','scene_images','animate_audio_edit',
                              'post_merge','final')),

  input_prompt text NOT NULL CHECK (char_length(input_prompt) <= 4000),
  target_duration_seconds integer NOT NULL CHECK (target_duration_seconds BETWEEN 5 AND 600),
  format text NOT NULL
    CHECK (format IN ('trailer','short_film','music_video','reel','commercial')),
  output_resolution text NOT NULL DEFAULT '1080p'
    CHECK (output_resolution IN ('720p','1080p','4K')),
  language text NOT NULL DEFAULT 'en',

  style_directives jsonb,
  config jsonb,

  upfront_credit_estimate integer NOT NULL DEFAULT 0,
  reserved_credits integer NOT NULL DEFAULT 0,
  spent_credits integer NOT NULL DEFAULT 0,
  max_cost_credits integer,

  director_replan_count int NOT NULL DEFAULT 0 CHECK (director_replan_count <= 1),
  storyboard_critic_runs int NOT NULL DEFAULT 0 CHECK (storyboard_critic_runs <= 2),

  CONSTRAINT pipelines_programmatic_not_guided
    CHECK (NOT (activation_mode = 'programmatic' AND mode = 'guided')),

  forked_at timestamptz,
  fork_reason text CHECK (fork_reason IN ('user_takeover', 'drift_unrecoverable')),

  branched_from_pipeline_id uuid REFERENCES pipelines(id) ON DELETE SET NULL,
  branched_from_stage text CHECK (branched_from_stage IN
    ('script','characters','objects','locations','shot_list','scene_images','animate_audio_edit','post_merge')),

  triggered_by_node_id text,
  trigger_payload jsonb,

  final_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  failure_reason text,
  cancelled_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipelines_user_status_idx ON pipelines (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS pipelines_workflow_idx ON pipelines (workflow_id) WHERE workflow_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.pipelines;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pipelines
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2. Pipeline stages ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_name text NOT NULL
    CHECK (stage_name IN ('script','characters','objects','locations',
                          'shot_list','scene_images','animate_audio_edit',
                          'post_merge')),
  stage_order int NOT NULL CHECK (stage_order BETWEEN 1 AND 8),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','awaiting_approval','approved',
                      'rejected','failed','cancelled')),
  output jsonb,
  critic_feedback jsonb,
  user_edits jsonb,

  tool_retry_count   int NOT NULL DEFAULT 0 CHECK (tool_retry_count   <= 5),
  critic_retry_count int NOT NULL DEFAULT 0 CHECK (critic_retry_count <= 2),
  resume_count       int NOT NULL DEFAULT 0 CHECK (resume_count       <= 3),

  started_at timestamptz,
  completed_at timestamptz,

  UNIQUE (pipeline_id, stage_name)
);

CREATE INDEX IF NOT EXISTS pipeline_stages_pipeline_idx ON pipeline_stages (pipeline_id, stage_order);

-- Trigger: keeps pipelines.current_stage in sync. Architecture §9.1 sync_pipeline_current_stage().
CREATE OR REPLACE FUNCTION sync_pipeline_current_stage() RETURNS trigger
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE pipelines SET current_stage = (
    CASE
      WHEN EXISTS (SELECT 1 FROM pipeline_stages
                   WHERE pipeline_id = NEW.pipeline_id
                     AND status IN ('running','awaiting_approval'))
        THEN (SELECT stage_name FROM pipeline_stages
              WHERE pipeline_id = NEW.pipeline_id
                AND status IN ('running','awaiting_approval')
              ORDER BY stage_order LIMIT 1)
      WHEN EXISTS (SELECT 1 FROM pipeline_stages
                   WHERE pipeline_id = NEW.pipeline_id
                     AND status = 'approved'
                     AND stage_name = 'animate_audio_edit')
        THEN 'final'
      ELSE NULL
    END
  ) WHERE id = NEW.pipeline_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pipeline_stages_sync_current_stage ON pipeline_stages;
CREATE TRIGGER pipeline_stages_sync_current_stage
  AFTER INSERT OR UPDATE OF status ON pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION sync_pipeline_current_stage();

-- 3. Stage attempts ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipeline_stage_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_stage_id uuid NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  attempt_n int NOT NULL CHECK (attempt_n >= 0),
  trigger text NOT NULL CHECK (trigger IN (
    'initial','critic_retry','resume','user_edit','chat_refine','director_replan'
  )),
  output jsonb,
  critic_feedback jsonb,
  llm_calls_count int NOT NULL DEFAULT 0,
  credits_spent int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_stage_id, attempt_n)
);

CREATE INDEX IF NOT EXISTS pipeline_stage_attempts_stage_idx
  ON pipeline_stage_attempts (pipeline_stage_id, attempt_n);

-- 4. Entities ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipeline_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  entity_type text NOT NULL
    CHECK (entity_type IN ('character','object','location','scene')),
  entity_key text NOT NULL
    CHECK (entity_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','generating','awaiting_approval','approved','rejected','failed')),
  main_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  last_frame_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  metadata jsonb,

  is_forked boolean NOT NULL DEFAULT false,
  forked_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, entity_type, entity_key)
);

CREATE INDEX IF NOT EXISTS pipeline_entities_pipeline_idx ON pipeline_entities (pipeline_id);

-- 5. Entity variants + nodes ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipeline_entity_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES pipeline_entities(id) ON DELETE CASCADE,
  variant_key text NOT NULL,
  asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','generating','awaiting_approval','approved','rejected','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, variant_key)
);

CREATE TABLE IF NOT EXISTS pipeline_entity_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES pipeline_entities(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  role text NOT NULL,
  pipeline_state text NOT NULL DEFAULT 'pipeline_owned_running'
    CHECK (pipeline_state IN (
      'pipeline_owned_running','pipeline_owned_awaiting_approval',
      'pipeline_owned_approved','pipeline_orphaned'
    )),
  last_change_source text NOT NULL DEFAULT 'engine'
    CHECK (last_change_source IN ('engine','engine_chat_apply','user_canvas_edit')),
  last_change_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_entity_nodes_node_idx ON pipeline_entity_nodes (node_id);

-- Cascade entity fork: when is_forked flips true, mark all bound nodes orphaned.
-- Architecture §5.6 + §9.2.
CREATE OR REPLACE FUNCTION cascade_entity_fork() RETURNS trigger
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_forked = true AND OLD.is_forked = false THEN
    NEW.forked_at = COALESCE(NEW.forked_at, now());
    UPDATE pipeline_entity_nodes
      SET pipeline_state = 'pipeline_orphaned'
      WHERE entity_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pipeline_entities_cascade_fork ON pipeline_entities;
CREATE TRIGGER pipeline_entities_cascade_fork
  BEFORE UPDATE OF is_forked ON pipeline_entities
  FOR EACH ROW EXECUTE FUNCTION cascade_entity_fork();

-- 6. LLM call log ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS llm_prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  task text NOT NULL,
  version int NOT NULL,
  system_prompt text NOT NULL,
  user_prompt_template text NOT NULL,
  output_schema_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id),
  UNIQUE (role, task, version)
);

CREATE INDEX IF NOT EXISTS llm_prompt_versions_active_idx
  ON llm_prompt_versions (role, task) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS llm_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid REFERENCES pipelines(id) ON DELETE SET NULL,
  stage_id uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL,
  task text NOT NULL,
  model_id text NOT NULL,
  prompt_version_id uuid REFERENCES llm_prompt_versions(id),
  input_tokens int,
  output_tokens int,
  cache_creation_input_tokens int,
  cache_read_input_tokens int,
  cost_usd numeric(10, 6),
  duration_ms int,
  success boolean NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_calls_pipeline_idx ON llm_calls (pipeline_id, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_calls_user_idx ON llm_calls (user_id, created_at DESC);

-- 7. ALTERs on jobs/assets ──────────────────────────────────────────────────────

ALTER TABLE jobs   ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES pipelines(id) ON DELETE SET NULL;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES pipelines(id) ON DELETE SET NULL;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS pipeline_entity_id uuid REFERENCES pipeline_entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jobs_pipeline_idx   ON jobs (pipeline_id)   WHERE pipeline_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS assets_pipeline_idx ON assets (pipeline_id) WHERE pipeline_id IS NOT NULL;

CREATE OR REPLACE FUNCTION assets_enforce_pipeline_denorm() RETURNS trigger
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.pipeline_entity_id IS NOT NULL THEN
    SELECT pipeline_id INTO NEW.pipeline_id
    FROM pipeline_entities WHERE id = NEW.pipeline_entity_id;
    IF NEW.pipeline_id IS NULL THEN
      RAISE EXCEPTION 'pipeline_entity_id % does not exist', NEW.pipeline_entity_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assets_pipeline_denorm ON assets;
CREATE TRIGGER assets_pipeline_denorm
  BEFORE INSERT OR UPDATE OF pipeline_entity_id ON assets
  FOR EACH ROW EXECUTE FUNCTION assets_enforce_pipeline_denorm();

-- 8. RLS ────────────────────────────────────────────────────────────────────────

ALTER TABLE pipelines                ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stage_attempts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_entities        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_entity_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_entity_nodes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_calls                ENABLE ROW LEVEL SECURITY;
-- llm_prompt_versions is admin-only — no user RLS.

CREATE POLICY pipelines_owner ON pipelines
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY pipeline_stages_owner ON pipeline_stages
  FOR ALL USING (EXISTS (SELECT 1 FROM pipelines WHERE pipelines.id = pipeline_stages.pipeline_id AND pipelines.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM pipelines WHERE pipelines.id = pipeline_stages.pipeline_id AND pipelines.user_id = auth.uid()));

CREATE POLICY pipeline_stage_attempts_owner ON pipeline_stage_attempts
  FOR ALL USING (EXISTS (
    SELECT 1 FROM pipeline_stages ps JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.id = pipeline_stage_attempts.pipeline_stage_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM pipeline_stages ps JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.id = pipeline_stage_attempts.pipeline_stage_id AND p.user_id = auth.uid()
  ));

CREATE POLICY pipeline_entities_owner ON pipeline_entities
  FOR ALL USING (EXISTS (SELECT 1 FROM pipelines WHERE pipelines.id = pipeline_entities.pipeline_id AND pipelines.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM pipelines WHERE pipelines.id = pipeline_entities.pipeline_id AND pipelines.user_id = auth.uid()));

CREATE POLICY pipeline_entity_variants_owner ON pipeline_entity_variants
  FOR ALL USING (EXISTS (
    SELECT 1 FROM pipeline_entities pe JOIN pipelines p ON p.id = pe.pipeline_id
    WHERE pe.id = pipeline_entity_variants.entity_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM pipeline_entities pe JOIN pipelines p ON p.id = pe.pipeline_id
    WHERE pe.id = pipeline_entity_variants.entity_id AND p.user_id = auth.uid()
  ));

CREATE POLICY pipeline_entity_nodes_owner ON pipeline_entity_nodes
  FOR ALL USING (EXISTS (
    SELECT 1 FROM pipeline_entities pe JOIN pipelines p ON p.id = pe.pipeline_id
    WHERE pe.id = pipeline_entity_nodes.entity_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM pipeline_entities pe JOIN pipelines p ON p.id = pe.pipeline_id
    WHERE pe.id = pipeline_entity_nodes.entity_id AND p.user_id = auth.uid()
  ));

CREATE POLICY llm_calls_owner ON llm_calls
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
