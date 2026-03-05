-- Creator analytics (daily aggregation)
CREATE TABLE app_analytics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id            UUID NOT NULL REFERENCES published_apps(id) ON DELETE CASCADE,
  date              DATE NOT NULL,
  total_runs        INT DEFAULT 0,
  unique_runners    INT DEFAULT 0,
  total_credits     INT DEFAULT 0,
  successful_runs   INT DEFAULT 0,
  failed_runs       INT DEFAULT 0,
  UNIQUE(app_id, date)
);

-- RLS
ALTER TABLE app_analytics ENABLE ROW LEVEL SECURITY;

-- Creator can see own app analytics only
CREATE POLICY "Creator can see own app analytics"
  ON app_analytics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM published_apps
      WHERE published_apps.id = app_analytics.app_id
      AND published_apps.creator_id = auth.uid()
    )
  );

-- Index for fast lookups
CREATE INDEX idx_app_analytics_app_date ON app_analytics(app_id, date DESC);

-- Function to update analytics after an app run completes
-- Called by a trigger on workflow_executions status change
CREATE OR REPLACE FUNCTION update_app_analytics()
RETURNS TRIGGER AS $$
DECLARE
  v_app_id UUID;
  v_runner_id UUID;
  v_credits INT;
  v_today DATE := CURRENT_DATE;
BEGIN
  -- Only fire on status change to completed or failed
  IF NEW.status NOT IN ('completed', 'failed') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Find the app_run for this execution
  SELECT ar.app_id, ar.runner_id
  INTO v_app_id, v_runner_id
  FROM app_runs ar
  WHERE ar.execution_id = NEW.id
  LIMIT 1;

  -- If no app_run found, this is not a published app execution
  IF v_app_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_credits := COALESCE(NEW.total_credits_used, 0);

  -- Update the app_run credits_used
  UPDATE app_runs SET credits_used = v_credits WHERE execution_id = NEW.id;

  -- Upsert analytics row
  INSERT INTO app_analytics (app_id, date, total_runs, unique_runners, total_credits, successful_runs, failed_runs)
  VALUES (
    v_app_id,
    v_today,
    1,
    1,
    v_credits,
    CASE WHEN NEW.status = 'completed' THEN 1 ELSE 0 END,
    CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END
  )
  ON CONFLICT (app_id, date) DO UPDATE SET
    total_runs = app_analytics.total_runs + 1,
    total_credits = app_analytics.total_credits + v_credits,
    successful_runs = app_analytics.successful_runs + CASE WHEN NEW.status = 'completed' THEN 1 ELSE 0 END,
    failed_runs = app_analytics.failed_runs + CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END;

  -- Update unique_runners separately (need to count distinct)
  UPDATE app_analytics SET unique_runners = (
    SELECT COUNT(DISTINCT ar.runner_id)
    FROM app_runs ar
    JOIN workflow_executions we ON we.id = ar.execution_id
    WHERE ar.app_id = v_app_id
    AND ar.created_at >= v_today
    AND ar.created_at < v_today + INTERVAL '1 day'
  )
  WHERE app_id = v_app_id AND date = v_today;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on workflow_executions status updates
CREATE TRIGGER trg_update_app_analytics
  AFTER UPDATE OF status ON workflow_executions
  FOR EACH ROW
  EXECUTE FUNCTION update_app_analytics();
