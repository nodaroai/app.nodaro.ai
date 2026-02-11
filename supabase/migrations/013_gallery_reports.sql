-- Gallery reports table for content moderation
CREATE TABLE IF NOT EXISTS gallery_reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  reason text NOT NULL,
  details text,
  reporter_ip text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gallery_reports_status ON gallery_reports (status);
CREATE INDEX IF NOT EXISTS idx_gallery_reports_job_id ON gallery_reports (job_id);
