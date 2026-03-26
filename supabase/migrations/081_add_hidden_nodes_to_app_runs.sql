ALTER TABLE app_runs ADD COLUMN IF NOT EXISTS hidden_nodes text[] DEFAULT '{}';
