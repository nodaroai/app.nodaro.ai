-- Optimize get_stats: use job_type column instead of input_data->>'type' JSONB extraction.
-- The JSONB extraction forces a sequential scan and decompresses every row.
-- job_type is a plain text column (added in 012) with an existing index.

-- 1. Composite index for the stats aggregation query
CREATE INDEX IF NOT EXISTS idx_jobs_user_stats
  ON jobs (user_id, status, job_type, started_at, completed_at);

-- 2. Rewrite get_stats to use job_type instead of input_data->>'type'
CREATE OR REPLACE FUNCTION get_stats(p_user_id UUID DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'totalExecutions', COUNT(*),
    'successful', COUNT(*) FILTER (WHERE status = 'completed'),
    'failed', COUNT(*) FILTER (WHERE status = 'failed'),
    'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled'),
    'pending', COUNT(*) FILTER (WHERE status IN ('pending', 'queued')),
    'processing', COUNT(*) FILTER (WHERE status = 'processing'),
    'failureRate', CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(*) FILTER (WHERE status = 'failed')::numeric / COUNT(*)::numeric) * 100, 1)
      ELSE 0 END,
    'avgImageTime', COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (
      WHERE status = 'completed' AND job_type IN (
        'generate-image', 'edit-image', 'image-to-image',
        'generate-character', 'generate-character-asset',
        'generate-object', 'generate-object-asset',
        'generate-location', 'generate-location-asset'
      ))::numeric, 1), 0),
    'avgVideoTime', COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (
      WHERE status = 'completed' AND job_type IN (
        'image-to-video', 'text-to-video', 'video-to-video',
        'combine-videos', 'motion-transfer', 'video-upscale', 'trim-video'
      ))::numeric, 1), 0)
  ) INTO result
  FROM jobs
  WHERE (p_user_id IS NULL OR user_id = p_user_id);

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
