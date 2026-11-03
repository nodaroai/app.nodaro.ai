-- 589_account_suspensions.sql
--
-- A suspension: a measure on an account (migration 588's account_sanctions)
-- that refuses the account's sign-in and every request until it ends. It
-- always has an end, and an administrator can lift it early, with the reason,
-- like any measure in force. The repeat-infringer policy can name it as a
-- step with its days; nothing here takes one by itself.
--
-- 588's trigger holds it to what every measure but a warning is held to: one
-- in force per account at a time (55029, under the lock per account and
-- kind), lifted once and only while in force, nothing applied ever changes,
-- never deleted or truncated. 588's index of the measures not lifted covers
-- it too.
--
-- The refusal is the server's: lib/access-blocks.ts reads the suspensions in
-- force with the account blocks and refuses a suspended account as it refuses
-- a blocked one, until the end; ee/lib/account-blocking.ts bans its sign-in
-- until then. The index below is that read's.
--
-- Idempotent: CI re-applies the newest migration.

ALTER TABLE public.account_sanctions DROP CONSTRAINT IF EXISTS account_sanctions_kind;
ALTER TABLE public.account_sanctions
  ADD CONSTRAINT account_sanctions_kind CHECK (kind IN ('warning', 'imports_blocked', 'suspended', 'closed'));

-- A suspension always ends: lifted early, or at its end.
ALTER TABLE public.account_sanctions DROP CONSTRAINT IF EXISTS account_sanctions_suspension_ends;
ALTER TABLE public.account_sanctions
  ADD CONSTRAINT account_sanctions_suspension_ends CHECK (kind <> 'suspended' OR ends_at IS NOT NULL);

-- The access snapshot's read: the suspensions not lifted, by their end.
CREATE INDEX IF NOT EXISTS account_sanctions_suspensions_idx
  ON public.account_sanctions (ends_at) WHERE kind = 'suspended' AND lifted_at IS NULL;
