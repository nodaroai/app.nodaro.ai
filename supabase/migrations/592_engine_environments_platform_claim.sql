-- Engine environments: each environment's PLATFORM CLAIM (what its app takes
-- of the data every environment shares, such as a setting only a newer app
-- reads) in two columns of its own, beside the engine record of 548.
--
-- The engine record (plugin_build_id, supports, updated_at) is written as
-- before: once at boot, by every process that builds the app. The claim is
-- written only by the listening API server's heartbeat, every 5 minutes, as an
-- update of these two columns alone. So a beat never rewrites the engine
-- record (a container on its way out can never overwrite a rolled-back
-- build's boot write), and a boot write never touches the claim (an upsert
-- sets only the columns it names). The API counts a claim only while
-- platform_claimed_at is within 15 minutes; NULL is no claim (a platform from
-- before the claim, or none recorded yet).
--
-- Server-only, as the rest of the row: 548's table grants cover these columns
-- (RLS on, no client grants, service role only).

ALTER TABLE public.engine_environments
  ADD COLUMN IF NOT EXISTS platform_supports   JSONB,
  ADD COLUMN IF NOT EXISTS platform_claimed_at TIMESTAMPTZ;

-- A claim is whole (both columns or neither) and an object.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.engine_environments'::regclass AND conname = 'engine_environments_platform_claim_check') THEN
    ALTER TABLE public.engine_environments ADD CONSTRAINT engine_environments_platform_claim_check
      CHECK ((platform_supports IS NULL) = (platform_claimed_at IS NULL)
             AND (platform_supports IS NULL OR jsonb_typeof(platform_supports) = 'object'));
  END IF;
END $$;

COMMENT ON COLUMN public.engine_environments.platform_supports IS
  'What this environment''s platform (the app itself, apart from its engine) takes of the shared data, as its heartbeat last claimed it. Written only by that heartbeat (migration 592), never by the boot write.';
COMMENT ON COLUMN public.engine_environments.platform_claimed_at IS
  'When this environment''s heartbeat last claimed platform_supports; the API counts the claim only while this is within 15 minutes. updated_at stays the engine record''s (its boot).';
