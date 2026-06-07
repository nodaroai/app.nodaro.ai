-- 198_llm_prompt_versions_rls.sql
--
-- Enable RLS on `llm_prompt_versions` — the ONE table (created in migration 121)
-- that was left without ENABLE ROW LEVEL SECURITY. The 121 comment
-- ("llm_prompt_versions is admin-only — no user RLS") is backwards for Supabase:
-- PostgREST grants anon/authenticated full DML on every `public` table by
-- default, and RLS is the only row gate. With RLS OFF, any authenticated (and
-- likely anon) user can SELECT / INSERT / UPDATE / DELETE this table via the
-- REST API — exfiltrating the proprietary prompt templates (system_prompt /
-- user_prompt_template) or planting/flipping an is_active prompt version.
--
-- Fix mirrors model_pricing (017), the sibling "public-read / admin-write"
-- reference table that DOES enable RLS: here the table is admin-only, so a
-- single admin-only FOR ALL policy. is_admin() is the SECURITY DEFINER helper
-- (migration 019) used by every other admin policy (avoids profiles recursion).
-- Service-role backend writes (the pipeline LLM engine) bypass RLS regardless.
--
-- New convergence migration — do NOT edit 121 (deployed to prod). Idempotent.

ALTER TABLE llm_prompt_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS llm_prompt_versions_admin_all ON llm_prompt_versions;
CREATE POLICY llm_prompt_versions_admin_all ON llm_prompt_versions
  FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());
