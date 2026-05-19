-- 136_locations_jobs_realtime.sql — Enable Supabase Realtime on locations + jobs
--
-- Phase 2 #12: replaces the Location Studio's 2s polling on `jobs` and the
-- save-only refetch on `locations` with first-class Realtime UPDATE events.
-- When a worker completes an asset generation while the studio is closed,
-- the badge on the canvas now refreshes instantly (vs the polling lag from
-- Phase 1, which was deliberately accepted).
--
-- Mirrors migration 115_workflows_realtime.sql for the two new tables.
--
-- The frontend subscriptions live in:
--   frontend/src/components/editor/location-studio/use-location-realtime-sync.ts
--   frontend/src/components/editor/location-studio/use-jobs-realtime-sync.ts
-- The location sync applies an append-only merge: untouched fields adopt
-- worker writes (new asset URLs in JSONB bucket columns) while in-progress
-- local edits in the studio are preserved. The jobs sync replaces the
-- primary polling signal in use-location-studio-jobs.ts; 2s polling stays
-- as a fallback (throttled to 10s) for clients where Realtime drops or RLS
-- edge cases occur.
--
-- REPLICA IDENTITY FULL ensures Postgres includes the full row (including
-- unchanged-TOAST values like the large JSONB asset arrays on `locations`)
-- in UPDATE WAL events. Without FULL the Realtime payload would omit
-- unchanged TOAST values, and the studio would not see the new asset URL
-- when only one bucket column changed. Cost: a few hundred bytes per
-- update — both tables are not high-velocity.
--
-- RLS continues to apply on Realtime broadcasts. Both `locations` and
-- `jobs` are user_id-scoped via existing RLS policies, so only the row's
-- owner receives events — exactly matching the per-user polling behavior
-- we are replacing.
--
-- Idempotent: ALTER TABLE ... REPLICA IDENTITY is no-op on re-run, and
-- each ALTER PUBLICATION ... ADD TABLE is wrapped in its own DO block
-- that swallows the "relation is already member of publication" error
-- so the migration can be re-applied without manual intervention.
--
-- Single-line revertable:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.locations, public.jobs;

ALTER TABLE public.locations REPLICA IDENTITY FULL;
ALTER TABLE public.jobs REPLICA IDENTITY FULL;

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.locations;
    EXCEPTION
        WHEN duplicate_object THEN
            -- Already in the publication — safe to ignore.
            NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
    EXCEPTION
        WHEN duplicate_object THEN
            -- Already in the publication — safe to ignore.
            NULL;
    END;
END $$;
