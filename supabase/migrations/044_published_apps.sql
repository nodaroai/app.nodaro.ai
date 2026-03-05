-- Published apps (immutable workflow snapshots)
CREATE TABLE published_apps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id       UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  creator_id        UUID NOT NULL REFERENCES auth.users(id),
  version           INT NOT NULL DEFAULT 1,
  slug              TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT DEFAULT '',
  icon_url          TEXT,
  snapshot_nodes    JSONB NOT NULL,
  snapshot_edges    JSONB NOT NULL,
  snapshot_settings JSONB NOT NULL DEFAULT '{}',
  is_active         BOOLEAN DEFAULT true,
  is_listed         BOOLEAN DEFAULT false,
  is_embeddable     BOOLEAN DEFAULT true,
  allowed_origins   TEXT[] DEFAULT '{}',
  estimated_credits INT NOT NULL DEFAULT 0,
  max_runs_per_user_per_day INT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workflow_id, version)
);

-- Link workflow to its current published version
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS published_app_id UUID REFERENCES published_apps(id);

-- App runs (links published app to workflow execution)
CREATE TABLE app_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id            UUID NOT NULL REFERENCES published_apps(id) ON DELETE CASCADE,
  execution_id      UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  runner_id         UUID NOT NULL REFERENCES auth.users(id),
  credits_used      INT DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_published_apps_slug ON published_apps(slug) WHERE is_active = true;
CREATE INDEX idx_published_apps_creator ON published_apps(creator_id);
CREATE INDEX idx_published_apps_workflow ON published_apps(workflow_id);
CREATE INDEX idx_app_runs_app ON app_runs(app_id);
CREATE INDEX idx_app_runs_runner ON app_runs(runner_id);

-- RLS
ALTER TABLE published_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_runs ENABLE ROW LEVEL SECURITY;

-- published_apps: anyone can read active apps; creator can manage own apps
CREATE POLICY "Anyone can read active published apps"
  ON published_apps FOR SELECT
  USING (is_active = true);

CREATE POLICY "Creator can manage own apps"
  ON published_apps FOR ALL
  USING (creator_id = auth.uid());

-- app_runs: runner sees own runs; creator sees runs on own apps
CREATE POLICY "Runner can see own runs"
  ON app_runs FOR SELECT
  USING (runner_id = auth.uid());

CREATE POLICY "Runner can insert own runs"
  ON app_runs FOR INSERT
  WITH CHECK (runner_id = auth.uid());

CREATE POLICY "Runner can delete own runs"
  ON app_runs FOR DELETE
  USING (runner_id = auth.uid());

CREATE POLICY "Creator can see runs on own apps"
  ON app_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM published_apps
      WHERE published_apps.id = app_runs.app_id
      AND published_apps.creator_id = auth.uid()
    )
  );
