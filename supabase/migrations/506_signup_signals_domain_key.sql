-- 506_signup_signals_domain_key.sql
--
-- signup_signals.domain_key — the organisation an account belongs to, as the
-- free-grant gate sees it: Google's signed `hd` claim when the account is a
-- Google Workspace user, else the email's domain. A public mail provider
-- (gmail.com, outlook.com, qq.com, …) is never a key: the gate leaves those
-- rows NULL, so the "one grant per organisation" rule cannot see them.
--
-- The backfill fills the column from the account's email for every claim row
-- already there (a Workspace user's `hd` equals its email domain, so nothing
-- is lost); the gate skips public providers at decision time either way.
-- signup_signals carries no updated_at trigger, so the UPDATE needs no
-- bracket. Idempotent: CI re-applies the newest migration.
ALTER TABLE public.signup_signals
  ADD COLUMN IF NOT EXISTS domain_key text CHECK (domain_key IS NULL OR char_length(domain_key) <= 253);

CREATE INDEX IF NOT EXISTS idx_signup_signals_domain_key ON public.signup_signals (domain_key);

UPDATE public.signup_signals AS s
   SET domain_key = lower(split_part(p.email, '@', 2))
  FROM public.profiles AS p
 WHERE p.id = s.user_id
   AND s.domain_key IS NULL
   AND p.email LIKE '%@%';
