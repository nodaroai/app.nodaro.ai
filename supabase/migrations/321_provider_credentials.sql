-- 321_provider_credentials.sql
--
-- In-app provider credentials (self-host "Credentials" — the n8n analog).
--
-- The operator pastes a provider API key on /setup → Install health; the
-- backend encrypts it (AES-256-GCM, instance key — see
-- backend/src/lib/instance-cipher.ts) and stores the envelope here. The
-- plaintext never leaves the backend and is never returned by any route;
-- routes report only { set: boolean, source: "env" | "app" }.
--
-- Precedence is decided in code (backend/src/lib/provider-keys-runtime.ts):
-- an environment variable WINS over a row here — declared configuration beats
-- stored configuration; rows fill in where env is empty.
--
-- SERVICE ROLE ONLY: RLS is enabled with NO policies, so `anon` and
-- `authenticated` cannot read or write a single row through PostgREST. The
-- backend uses the service-role client, which bypasses RLS. Do not add
-- policies here — the UI goes through /v1/setup/provider-keys, never through
-- PostgREST.

CREATE TABLE IF NOT EXISTS public.provider_credentials (
  -- Provider id as the backend knows it: nodaro | kie | replicate | anthropic
  -- | gemini | elevenlabs | fal (backend/src/lib/provider-keys-runtime.ts).
  provider     TEXT PRIMARY KEY,
  -- base64(iv || gcm-tag || ciphertext) — the same envelope social tokens use.
  ciphertext   TEXT NOT NULL,
  -- Which instance key encrypted this row; lets a future rotation re-encrypt.
  key_version  INT NOT NULL DEFAULT 1,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.provider_credentials ENABLE ROW LEVEL SECURITY;

-- Belt and braces on top of RLS-with-no-policies: the API roles have no
-- table privileges at all, so even a future permissive policy would not
-- expose the envelope through PostgREST.
REVOKE ALL ON TABLE public.provider_credentials FROM anon, authenticated;

COMMENT ON TABLE public.provider_credentials IS
  'Operator-supplied provider API keys, AES-256-GCM encrypted with the instance key. Service role only; env vars take precedence in code.';
