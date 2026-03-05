-- Allow draft app_runs (no execution yet) and store input values

-- Make execution_id nullable so drafts can exist before running
ALTER TABLE app_runs ALTER COLUMN execution_id DROP NOT NULL;

-- Add input_values column to persist user inputs per run
ALTER TABLE app_runs ADD COLUMN IF NOT EXISTS input_values JSONB;

-- Add status column for draft/running/completed/failed tracking without needing execution join
ALTER TABLE app_runs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';

-- Update existing rows (all have execution_id, so they're not drafts)
UPDATE app_runs SET status = 'completed' WHERE execution_id IS NOT NULL AND status = 'draft';
