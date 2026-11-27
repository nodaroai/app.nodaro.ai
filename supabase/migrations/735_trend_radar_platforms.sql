-- 735 — Trend Radar reads TikTok, Instagram and YouTube, and measures a
-- candidate's growth on the same posts from one reading to the next.
--
-- Until now each daily reading was one TikTok search whose 20 answers were
-- summed: the creator count could never pass 20, and the day change compared
-- two different sets of posts. A reading now searches the three platforms
-- (TikTok and Instagram up to 60 posts, YouTube 20), keeps each platform's
-- share, and remembers the plays of every post it saw (`panel`, server-only),
-- so the next reading's growth is read over the posts both saw.
--
-- Additive and safe to re-run. The server reads and writes these columns
-- tolerantly: staging runs this code on the shared database before the
-- migration reaches it.
SET LOCAL lock_timeout = '2s';

-- ------------------------------------------------------------- candidates

-- `platforms`: per platform the last reading's posts, distinct creators,
-- plays, whether the search returned its most posts (`capped`) and its top
-- post. `creators_capped`: any platform capped — the true creator count is
-- likely higher. `first_posted_at`: the earliest post date any reading saw
-- (the trend's age). `last_read_at`: when the run last read the candidate,
-- the order the run reads in (never read first, then the longest unread).
-- `panel`: post id -> plays at the last reading, read only by the run.
ALTER TABLE public.trend_radar_candidates
  ADD COLUMN IF NOT EXISTS platforms JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS creators_capped BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_posted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS panel JSONB NULL;

CREATE INDEX IF NOT EXISTS idx_trend_radar_candidates_rotation
  ON public.trend_radar_candidates (status, last_read_at NULLS FIRST);

-- A candidate read before this migration was read when its latest reading
-- was: without this every candidate would look never read, and the run would
-- read the newest first again until each had been read once.
UPDATE public.trend_radar_candidates AS c
SET last_read_at = r.read_at
FROM (
  SELECT candidate_id, max(read_at) AS read_at
  FROM public.trend_radar_readings
  GROUP BY candidate_id
) AS r
WHERE r.candidate_id = c.id
  AND c.last_read_at IS NULL;

-- ---------------------------------------------------------------- readings

-- Plays growth per day, percent, over the posts this reading and the previous
-- one both saw. NULL on a first reading, when no post was seen twice, and on
-- every reading from before this migration.
ALTER TABLE public.trend_radar_readings
  ADD COLUMN IF NOT EXISTS growth_pct REAL NULL;

-- ---------------------------------------------------------------- settings

-- A candidate read is now three searches, so the daily budget's default moves
-- from 60 to 900: every open candidate (about 300) read every day. A budget an admin chose is kept; only the old default (or
-- none stored) moves.
UPDATE public.trend_radar_settings
SET thresholds = jsonb_set(COALESCE(thresholds, '{}'::jsonb), '{dailySearchBudget}', '900'::jsonb),
    updated_at = now()
WHERE id = 1
  AND (
    NOT (COALESCE(thresholds, '{}'::jsonb) ? 'dailySearchBudget')
    OR thresholds -> 'dailySearchBudget' = '60'::jsonb
  );

COMMENT ON COLUMN public.trend_radar_candidates.platforms IS
  'Trend Radar (735): per platform the last reading''s posts, creators, plays, capped flag and top post.';
COMMENT ON COLUMN public.trend_radar_candidates.panel IS
  'Trend Radar (735): post id -> plays at the last reading. Read by the run only; never served.';
COMMENT ON COLUMN public.trend_radar_readings.growth_pct IS
  'Trend Radar (735): plays growth per day over the posts this reading and the previous one both saw.';
