-- 579_content_rights_authorizations.sql
--
-- Content rights, the standing authorization: a person who imports links
-- through a personal API key or an AI agent (the MCP server) cannot tick a
-- box per link, so they authorize those imports ONCE, in their settings, for
-- a version of the declaration. Every import a key or an agent then makes is
-- recorded as a DERIVED confirmation (`content_rights_confirmations.kind =
-- 'derived'`, `standing_authorization_id` naming the row here) — one per
-- download, as a ticked box would be — so the record of every import stays
-- complete. The backend (lib/content-rights.ts) writes and reads this;
-- nothing here is reachable through PostgREST.
--
-- A row is a record like a confirmation: never deleted, and the ONE update
-- allowed is a revoke (`revoked_at` set once) and a scrub (`user_id`, `email`,
-- `ip`, `user_agent` each to null, never to another value; an account's
-- deletion nulls `user_id` by the foreign key, as a confirmation's does). A
-- new declaration version does not revoke a standing authorization: the gate
-- checks the version a derived confirmation is made under and refuses one
-- made under an older text, so the person authorizes the new text again.
--
-- Idempotent: CI re-applies the newest migration.

CREATE TABLE IF NOT EXISTS public.content_rights_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The account whose keys and agents the authorization covers. Null once
  -- that account is deleted: the record stays.
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  declaration_version integer NOT NULL REFERENCES public.rights_declarations(version),
  declaration_hash text NOT NULL,
  ip text,
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 1000),
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- The current authorization of an account: the newest unrevoked row.
CREATE INDEX IF NOT EXISTS content_rights_authorizations_user_idx
  ON public.content_rights_authorizations (user_id, created_at DESC) WHERE revoked_at IS NULL;
-- ...and there is ONE: the server revokes before it inserts, and two requests
-- racing there leave one unrevoked row, never two.
CREATE UNIQUE INDEX IF NOT EXISTS content_rights_authorizations_current_uidx
  ON public.content_rights_authorizations (user_id) WHERE revoked_at IS NULL AND user_id IS NOT NULL;

ALTER TABLE public.content_rights_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_rights_authorizations FROM anon, authenticated;

-- No delete; an update is a revoke (revoked_at from null to a time, once) or
-- a scrub (user_id, email, ip, user_agent each to null); nothing else changes.
CREATE OR REPLACE FUNCTION public.preserve_content_rights_authorization() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  mutable text[] := ARRAY['user_id', 'email', 'ip', 'user_agent', 'revoked_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A content rights authorization cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - mutable) = (to_jsonb(OLD) - mutable)
     AND (NEW.user_id IS NULL OR NEW.user_id = OLD.user_id)
     AND (NEW.email IS NULL OR NEW.email = OLD.email)
     AND (NEW.ip IS NULL OR NEW.ip = OLD.ip)
     AND (NEW.user_agent IS NULL OR NEW.user_agent = OLD.user_agent)
     AND (NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at OR (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A content rights authorization is immutable' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_content_rights_authorization() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS preserve_content_rights_authorization ON public.content_rights_authorizations;
CREATE TRIGGER preserve_content_rights_authorization
  BEFORE UPDATE OR DELETE ON public.content_rights_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.preserve_content_rights_authorization();
DROP TRIGGER IF EXISTS refuse_content_rights_authorizations_truncate ON public.content_rights_authorizations;
CREATE TRIGGER refuse_content_rights_authorizations_truncate
  BEFORE TRUNCATE ON public.content_rights_authorizations
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_content_rights_truncate();

-- A derived confirmation names the standing authorization it was made from
-- (`authorization_id` is the OAuth grant a confirmation came through, when
-- it came through a connected app; the two are different records).
ALTER TABLE public.content_rights_confirmations
  ADD COLUMN IF NOT EXISTS standing_authorization_id uuid REFERENCES public.content_rights_authorizations(id);

-- A fetch tried again (a worker job's retry, an execution picked up after a
-- deploy) finds the confirmation it already spent by its request id instead
-- of making a second derived one.
CREATE INDEX IF NOT EXISTS rights_events_request_idx
  ON public.rights_events (request_id) WHERE kind = 'consumed' AND request_id IS NOT NULL;
