-- 088_upsert_execution_stats_rpc.sql
-- Atomic upsert for model_execution_stats to eliminate read-modify-write races
-- when multiple workers complete jobs for the same (model, aspect_ratio, quality,
-- duration_seconds) key simultaneously. The previous JS implementation did
-- SELECT → compute EMA → UPDATE and lost samples under concurrency.

CREATE OR REPLACE FUNCTION upsert_execution_stats(
  p_model_identifier TEXT,
  p_aspect_ratio TEXT,
  p_quality TEXT,
  p_duration_seconds INT,
  p_duration_ms INT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ema_alpha CONSTANT NUMERIC := 0.3;
  outlier_min_samples CONSTANT INT := 5;
  outlier_multiplier CONSTANT NUMERIC := 3;
BEGIN
  INSERT INTO model_execution_stats (
    model_identifier, aspect_ratio, quality, duration_seconds,
    avg_duration_ms, min_duration_ms, max_duration_ms, sample_count,
    last_updated_at
  ) VALUES (
    p_model_identifier, p_aspect_ratio, p_quality, p_duration_seconds,
    p_duration_ms, p_duration_ms, p_duration_ms, 1,
    NOW()
  )
  ON CONFLICT (model_identifier, aspect_ratio, quality, duration_seconds)
  DO UPDATE SET
    avg_duration_ms = ROUND(
      ema_alpha * p_duration_ms
      + (1 - ema_alpha) * model_execution_stats.avg_duration_ms
    )::INT,
    min_duration_ms = LEAST(model_execution_stats.min_duration_ms, p_duration_ms),
    max_duration_ms = GREATEST(model_execution_stats.max_duration_ms, p_duration_ms),
    sample_count = model_execution_stats.sample_count + 1,
    last_updated_at = NOW()
  WHERE NOT (
    model_execution_stats.sample_count >= outlier_min_samples
    AND p_duration_ms > model_execution_stats.avg_duration_ms * outlier_multiplier
  );
END;
$$;

-- Service role only (backend). RLS on the base table still blocks regular users.
REVOKE ALL ON FUNCTION upsert_execution_stats(TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_execution_stats(TEXT, TEXT, TEXT, INT, INT) TO service_role;
