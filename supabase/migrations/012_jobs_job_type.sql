-- Add job_type column to jobs table (stores BullMQ job.name, e.g. "generate-image")
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_type text;

-- Index for gallery queries filtering by job_type
CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs (job_type);

-- Backfill existing completed jobs by inferring type from output_data keys
UPDATE jobs SET job_type =
  CASE
    WHEN output_data->>'script' IS NOT NULL THEN 'generate-script'
    WHEN output_data->>'videoUrl' IS NOT NULL THEN 'image-to-video'
    WHEN output_data->>'audioUrl' IS NOT NULL THEN 'text-to-audio'
    WHEN output_data->>'imageUrl' IS NOT NULL THEN 'generate-image'
  END
WHERE job_type IS NULL AND status = 'completed';
