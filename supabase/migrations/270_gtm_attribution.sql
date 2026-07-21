-- GTM attribution: the two per-user facts the platform has never recorded and
-- cannot reconstruct after the fact.
--
--   1. WHICH CHANNEL a user arrived from  -> profiles.first_touch_channel
--   2. WHEN they crossed the storage warn -> profiles.storage_warn_crossed_at
--
-- Both are EVENTS, and the events already happened unobserved: every user who
-- signs up before this ships is permanently unattributed. That is why this
-- migration is deliberately trivial — three ADD COLUMNs and one partial index,
-- no backfill, no table rewrite, sub-second on any table size. It is the
-- launch-critical half and must be able to ship without waiting on anything.
--
-- The registry fix (person) and job-origin tracking (jobs.app_slug) are
-- SEPARATE, in 271, precisely because they carry backfills and a cross-repo
-- deploy ordering constraint that must never be able to block or break this.

-- ── First-touch marketing attribution ───────────────────────────────────────
-- Written ONCE, by POST /v1/profile/attribution, only while NULL.
--
-- Deliberately NOT added to check_profiles_update_allowed's denylist
-- (025_medium_high_fixes.sql): that function guards the credit/role columns and
-- changing its signature means touching the RLS policy protecting billing. The
-- residual risk is a user rewriting their OWN attribution via PostgREST — no
-- economic gain — which does not justify that blast radius.
--
-- NOTE on trust: this value originates in the browser, so it is self-reportable
-- by an authenticated user. First-touch-wins caps abuse at one write per
-- account, but the metric is decision-grade, so it must always be cross-checked
-- against an independent source (Cloudflare's referrer report) before acting on
-- it. See the queries file for the caveat.
alter table public.profiles
  add column if not exists first_touch_channel text,
  add column if not exists first_touch_at timestamptz;

comment on column public.profiles.first_touch_channel is
  'Normalized marketing channel slug (^[a-z0-9][a-z0-9-]{0,39}$) captured at app entry on the first page view and written once after signup. Client-reported; cross-check before acting on it. NULL = pre-dates attribution, or arrived without a resolvable channel.';

comment on column public.profiles.first_touch_at is
  'When first_touch_channel was recorded (server clock, at the post-signup write — NOT when the visitor first landed).';

-- Activation-by-channel is the whole point of the column; index the grouping key.
create index if not exists idx_profiles_first_touch_channel
  on public.profiles (first_touch_channel)
  where first_touch_channel is not null;

-- ── Storage warning crossing ────────────────────────────────────────────────
-- storage_used_bytes is a mutable counter with no history, so "crossed 85%" is
-- not derivable retroactively.
--
-- Stamped from GET /v1/storage/status — the exact read the client meter polls —
-- and NOT from the credit guard. The guard reads the profile BEFORE the job
-- runs, so a user pushed over the line by an export, who then upgrades and
-- stops generating, would never be stamped: precisely the population the
-- monetization thesis is about. Stamping on the meter's own read makes "the
-- meter turned amber" and "the user crossed" the same population by
-- construction, and keeps a write off the generation hot path.
alter table public.profiles
  add column if not exists storage_warn_crossed_at timestamptz;

comment on column public.profiles.storage_warn_crossed_at is
  'First time this user was observed at >=85% of their storage limit (matches the client meter''s amber threshold, useStorageStatus.ts STORAGE_WARN_RATIO). Set once, never cleared. NULL = never observed at the threshold.';
