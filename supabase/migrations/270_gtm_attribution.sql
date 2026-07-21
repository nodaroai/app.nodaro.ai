-- Two per-user facts the platform has never recorded and cannot reconstruct
-- after the fact:
--
--   1. WHICH ACQUISITION CHANNEL a user arrived from -> profiles.first_touch_channel
--   2. WHEN they first hit the storage warning       -> profiles.storage_warn_crossed_at
--
-- Both are EVENTS, and the events already happened unobserved: every existing
-- user is permanently unattributed. That is why this migration is deliberately
-- trivial — three ADD COLUMNs and one partial index; no backfill, no table
-- rewrite, sub-second on any table size.
--
-- The client-app registry fix and job-origin tracking are SEPARATE, in 271,
-- because they carry a backfill and a cross-repo deploy-ordering constraint that
-- must never be able to block or break this one.

-- ── First-touch attribution ─────────────────────────────────────────────────
-- Written ONCE, by POST /v1/profile/attribution, only while NULL.
alter table public.profiles
  add column if not exists first_touch_channel text,
  add column if not exists first_touch_at timestamptz;

comment on column public.profiles.first_touch_channel is
  'Normalized channel slug (^[a-z0-9][a-z0-9-]{0,39}$) captured at app entry on the first page view and written once after signup, via POST /v1/profile/attribution. Self-reported by the client (the server cannot observe it), but write-once and format-validated. NULL = pre-dates this column, or arrived with no resolvable channel.';

comment on column public.profiles.first_touch_at is
  'When first_touch_channel was recorded (server clock, at the post-signup write — NOT when the visitor first landed).';

-- Grouping by channel is the entire purpose of the column; index it.
create index if not exists idx_profiles_first_touch_channel
  on public.profiles (first_touch_channel)
  where first_touch_channel is not null;

-- ── Storage warning crossing ────────────────────────────────────────────────
-- storage_used_bytes is a mutable counter with no history, so "first crossed
-- 85%" is not derivable retroactively — it has to be stamped as it happens.
--
-- Stamped from GET /v1/storage/status (the read the client meter polls) rather
-- than from the credit guard: the guard reads the profile BEFORE a job runs, so
-- it only ever sees the previous request's usage and would miss any user whose
-- crossing is not followed by another generation. Stamping on the meter's own
-- read makes "the meter warned them" and "they crossed" the same set by
-- construction, and keeps the write off the generation hot path.
alter table public.profiles
  add column if not exists storage_warn_crossed_at timestamptz;

comment on column public.profiles.storage_warn_crossed_at is
  'First time this user was observed at >=85% of their storage limit (matches the client meter''s amber threshold). Set once, never cleared. NULL = never observed at the threshold.';

-- ── KNOWN LIMITATION: these columns are self-writable by their owner ────────
-- Read this before trusting the data, and before "hardening" it.
--
-- `profiles`' UPDATE policy is a DENYLIST — check_profiles_update_allowed
-- (025_medium_high_fixes.sql) pins role/tier/credits/storage_limit_bytes and
-- nothing else — so ANY new column on this table is writable by its owner
-- through PostgREST. A user can therefore `PATCH /rest/v1/profiles?id=eq.<self>`
-- to clear first_touch_channel and rewrite it (bypassing the route's write-once
-- rule AND its format validation, so arbitrary-length junk can reach an indexed
-- column), or forge storage_warn_crossed_at. This is a PRE-EXISTING property of
-- the table that these columns inherit, not something introduced here.
--
-- What IS enforced: the route is the only *intended* writer, it validates the
-- slug grammar, it is rate-limited, and it rejects programmatic (API-token /
-- OAuth) callers so a third party cannot burn a user's one-shot write.
--
-- Two fixes were evaluated and deliberately NOT shipped here:
--
--   1. Column-level `REVOKE UPDATE (col) ... FROM authenticated` — DOES NOT
--      WORK, verified empirically against Postgres 15: with a table-level grant
--      present, `has_column_privilege` still returns true. Postgres checks
--      table privileges first and column-level REVOKE cannot subtract from them
--      (documented under REVOKE: "the table-level grant is unaffected by the
--      column-level operation"). The working form is REVOKE UPDATE on the TABLE
--      then GRANT UPDATE back on every other column — which silently denies
--      updates on any column a FUTURE migration adds, and could break profile
--      writes outright. Not shippable without a staging database to test on,
--      and there isn't one (staging shares production).
--
--   2. Extending check_profiles_update_allowed — its signature is consumed by
--      the RLS policy protecting the BILLING columns, so widening it means
--      editing that policy. Wrong risk to take for a metric column that
--      carries no economic value.
--
-- Consequence for analysis: treat these columns as SELF-REPORTED. Corroborate
-- the channel split against an independent source before acting on it.

