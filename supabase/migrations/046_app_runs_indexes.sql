-- Add missing compound indexes for app_runs query patterns

-- Used by analytics trigger: JOIN app_runs ON execution_id
CREATE INDEX IF NOT EXISTS idx_app_runs_execution ON app_runs(execution_id);

-- Used by paginated run lists: WHERE app_id = X ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_app_runs_app_created ON app_runs(app_id, created_at DESC);

-- Used by rate limit check: WHERE app_id = X AND runner_id = Y AND created_at >= today
CREATE INDEX IF NOT EXISTS idx_app_runs_rate_limit ON app_runs(app_id, runner_id, created_at DESC);
