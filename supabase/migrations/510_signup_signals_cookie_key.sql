-- 510_signup_signals_cookie_key.sql
--
-- The free-grant gate's server-signed browser cookie (ee/lib/signup-cookie.ts).
-- The claim routes give a browser a random id signed with our key; a later
-- claim from the same browser carries it back, and a script cannot mint one.
-- signup_signals.cookie_key is a keyed hash of that id (never the id), so
-- the rule "another account already carried this cookie" is one equality.
--
-- Shadow first: the rule decides only when app_settings
-- signup_grant_cookie_rule is true; until then the column only records.
--
-- Idempotent: CI re-applies the newest migration.
ALTER TABLE public.signup_signals
  ADD COLUMN IF NOT EXISTS cookie_key text CHECK (cookie_key IS NULL OR cookie_key ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS idx_signup_signals_cookie_key ON public.signup_signals (cookie_key);
