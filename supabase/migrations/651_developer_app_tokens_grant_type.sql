-- Record which grant issued an access token (decided 2026-11-11).
--
-- A deployment can let its own application exchange a signed assertion for an
-- MCP access token, with no consent click (POST /v1/oauth/token with the
-- RFC 7523 jwt-bearer grant). Each token that exchange issues carries the
-- grant type here, so a token obtained by exchange is told apart from one a
-- person's consent made — in the data, and in the person's Connected apps
-- list, which marks a grant an application obtained that way.
--
-- developer_app_tokens.grant_type — NULL for every token issued by the consent
-- paths (the authorization code, the plugin connect handshake), which is every
-- token written before this column and every one those paths write after it:
-- they never name the column. Only the exchange writes it, always as
-- 'urn:ietf:params:oauth:grant-type:jwt-bearer'. Until this migration reaches
-- a database the exchange refuses to issue a token there (it will not issue an
-- unmarked one), and Connected apps reads every grant as a consent's.
--
-- Additive and nullable; no backfill. RLS on the table is unchanged: a person
-- reads their own tokens through their authorization, and only the service
-- role writes. Idempotent: ADD COLUMN IF NOT EXISTS, and the CHECK is dropped
-- if it exists and re-added.

ALTER TABLE public.developer_app_tokens
  ADD COLUMN IF NOT EXISTS grant_type text;

ALTER TABLE public.developer_app_tokens
  DROP CONSTRAINT IF EXISTS developer_app_tokens_grant_type_check;

ALTER TABLE public.developer_app_tokens
  ADD CONSTRAINT developer_app_tokens_grant_type_check
  CHECK (grant_type IS NULL OR grant_type = 'urn:ietf:params:oauth:grant-type:jwt-bearer');

COMMENT ON COLUMN public.developer_app_tokens.grant_type IS
  'The OAuth grant that issued this token when it was not a consent: urn:ietf:params:oauth:grant-type:jwt-bearer for the MCP assertion exchange. NULL = issued by a consent (authorization code, plugin connect).';
