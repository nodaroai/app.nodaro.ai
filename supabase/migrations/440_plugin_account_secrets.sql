-- 440_plugin_account_secrets.sql
-- A generic, service-role-only store for account credentials a private plugin
-- keeps on a user's behalf (a long-lived session, not a key the user rotates
-- on a settings page). Nothing in its shape names a provider: `plugin` says
-- whose rows they are, `kind` is the plugin's own sub-kind.
--
-- The backend encrypts the secret payload with the instance key (AES-256-GCM,
-- backend/src/lib/instance-cipher.ts — the envelope http_credentials, social
-- tokens and pasted provider keys already use) and reaches this table only
-- through backend/src/lib/plugin-account-secrets.ts, which scopes every call to
-- the plugin it names AND to the runtime environment of the calling process.
-- Its only decrypt site is wired into the plugin daemon host alone.
--
-- `runtime_env`: staging and production share this database, and a stored
-- session is live — two installs opening the same one get it terminated by the
-- provider. Each install therefore reads and writes only rows of its own
-- environment (RUNTIME_ENV, else RAILWAY_ENVIRONMENT_NAME, else "local" — the
-- same name migration 374 records on workflow_executions).
--
-- SERVICE ROLE ONLY (the http_credentials posture, migration 435): RLS is
-- enabled with NO policies and the API roles hold no table privileges, so
-- neither `anon` nor `authenticated` can read a single row — not even the
-- ciphertext — through PostgREST. Do not add policies here.
-- Proof: supabase/tests/plugin-account-secrets-privacy.behavior.sql.

CREATE TABLE IF NOT EXISTS public.plugin_account_secrets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The owning plugin's id and its own sub-kind. Validated by the backend
  -- (lowercase slug), no CHECK — a new plugin is not a migration.
  plugin        TEXT NOT NULL,
  kind          TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  runtime_env   TEXT NOT NULL,
  -- The account's own identity at its provider: one row per account per owner.
  external_id   TEXT NOT NULL,
  -- What the owner is shown (a masked handle). Never a secret.
  label         TEXT,
  -- base64(iv || gcm-tag || ciphertext) of the JSON secret payload.
  ciphertext    TEXT NOT NULL,
  -- Plugin-defined lifecycle (active / paused / revoked / …) — no CHECK, same
  -- reason as `plugin`.
  status        TEXT NOT NULL DEFAULT 'active',
  status_reason TEXT,
  -- Display-only details. Never a secret.
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The identity a reconnect upserts on. The backend's ON CONFLICT names these
-- five columns; keep them in step (plugin-account-secrets.ts IDENTITY_CONFLICT).
CREATE UNIQUE INDEX IF NOT EXISTS plugin_account_secrets_identity_idx
  ON public.plugin_account_secrets (plugin, kind, runtime_env, user_id, external_id);

-- The daemon's boot read: every live row of its plugin in its environment.
CREATE INDEX IF NOT EXISTS plugin_account_secrets_plugin_env_status_idx
  ON public.plugin_account_secrets (plugin, runtime_env, status);

CREATE INDEX IF NOT EXISTS plugin_account_secrets_user_id_idx
  ON public.plugin_account_secrets (user_id);

ALTER TABLE public.plugin_account_secrets ENABLE ROW LEVEL SECURITY;

-- Belt and braces on top of RLS-with-no-policies: the API roles have no table
-- privileges at all, so even a future permissive policy would not expose the
-- envelope through PostgREST.
REVOKE ALL ON TABLE public.plugin_account_secrets FROM anon, authenticated;

COMMENT ON TABLE public.plugin_account_secrets IS
  'Account credentials private plugins keep on a user''s behalf (AES-256-GCM envelope), scoped by plugin and runtime environment. Service role only; decrypted only by the plugin daemon host.';
COMMENT ON COLUMN public.plugin_account_secrets.runtime_env IS
  'Environment that owns this row (RUNTIME_ENV / RAILWAY_ENVIRONMENT_NAME / local). Installs sharing the database never see each other''s rows.';
