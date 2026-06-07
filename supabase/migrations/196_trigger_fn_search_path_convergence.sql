-- 196_trigger_fn_search_path_convergence.sql
--
-- Pin search_path on three SECURITY DEFINER trigger functions that were created
-- AFTER the migration-033 search_path sweep and were never pinned by any later
-- migration — the same mutable-search_path privilege-escalation class that
-- migration 194 fixed for refund_credits.
--
--   * increment_app_run_count        (062_app_marketplace.sql)   — AFTER INSERT app_runs
--   * update_app_favorite_count      (062_app_marketplace.sql)   — INSERT/DELETE app_favorites
--   * update_template_favorite_count (076_workflow_templates.sql) — INSERT/DELETE template_favorites
--
-- All run SECURITY DEFINER (as table owner, bypassing RLS) on user-triggerable
-- events with unqualified table references, so a mutable search_path is the
-- exact class the Supabase linter flags. (The migration-121 pipeline triggers
-- correctly use SET search_path; it was simply forgotten for these three.)
--
-- New migration (do NOT renumber 062/076 — they are deployed to prod), matching
-- the 176/194 convergence pattern. Idempotent: ALTER FUNCTION is safe to re-run.

ALTER FUNCTION increment_app_run_count() SET search_path = public;
ALTER FUNCTION update_app_favorite_count() SET search_path = public;
ALTER FUNCTION update_template_favorite_count() SET search_path = public;
