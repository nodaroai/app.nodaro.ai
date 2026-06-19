-- Fix: profiles.tier CHECK constraint (from 001_initial_schema.sql) omits the
-- 'standard' tier, even though the app provisions it everywhere (TIER_ORDER,
-- stripe-config, TIER_PARALLELISM, admin role enum). On any DB built from
-- migrations, `UPDATE profiles SET tier='standard'` during a Standard-plan
-- subscribe/upgrade violates the constraint (Postgres 23514) and silently fails
-- to persist the tier. This adds 'standard' (and is idempotent / safe to re-run).
--
-- The inline column CHECK in 001 is auto-named `profiles_tier_check`.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_tier_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_tier_check
  CHECK (tier IN ('free', 'basic', 'standard', 'pro', 'business', 'enterprise'));
