-- 507_signup_network_signals.sql
--
-- The free-grant gate's network rules (lib/access … ee/billing/signup-grant-policy.ts):
--
--  1. signup_signals.net_key_hash — the claim's NEIGHBOURHOOD (an IPv4 /24,
--     an IPv6 /48), hashed the way ip_hash is. The rule "a second account from
--     the same neighbourhood within the hour" counts on it. Only rows marked
--     ip_scheme = 'client' get one (an unknown address has no neighbourhood).
--  2. signup_signals.hosting — the claim came from a range a hosting provider
--     publishes as its own (lib/hosting-ranges.generated.json). A server is not
--     a person; the rule withholds on it.
--  3. signup_addresses — the claim's address itself, kept 60 days so a rule
--     written next month can be measured against this month's signups
--     (ip_hash cannot be mapped back to a neighbourhood or a provider). Purged
--     daily by the cleanup cron; service role only, like signup_signals.
--
-- Idempotent: CI re-applies the newest migration.
ALTER TABLE public.signup_signals
  ADD COLUMN IF NOT EXISTS net_key_hash text CHECK (net_key_hash IS NULL OR net_key_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS hosting boolean;

CREATE INDEX IF NOT EXISTS idx_signup_signals_net_key_hash ON public.signup_signals (net_key_hash);

CREATE TABLE IF NOT EXISTS public.signup_addresses (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  address inet NOT NULL,
  hosting boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_addresses_created_at ON public.signup_addresses (created_at);

ALTER TABLE public.signup_addresses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signup_addresses FROM anon, authenticated;
