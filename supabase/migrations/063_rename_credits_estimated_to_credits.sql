-- Rename credits_estimated → credits on jobs table (it's the actual amount charged, not an estimate)
ALTER TABLE public.jobs RENAME COLUMN credits_estimated TO credits;

-- Drop unused credits_used column on jobs table (never set by any code path)
ALTER TABLE public.jobs DROP COLUMN IF EXISTS credits_used;
