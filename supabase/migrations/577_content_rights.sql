-- 577_content_rights.sql
--
-- Content rights: the declaration a person confirms before a link is imported,
-- the record of each confirmation, and the events around it. The backend
-- (lib/content-rights.ts) writes and reads these; nothing here is reachable
-- through PostgREST. Enforcement is behind the app setting
-- `content_rights_required` (off until every client sends a confirmation):
-- with it off the server records a confirmation when one arrives and refuses
-- nothing.
--
-- Every table is RLS-on with NO policies and revoked from anon and
-- authenticated. The confirmations and the events are a record: they are
-- never updated, deleted or truncated (triggers refuse all three). The one
-- update allowed on a confirmation is a SCRUB: the owner's id (the account's
-- deletion does it, ON DELETE SET NULL) and the personal data taken with it
-- (email, address, user agent) may each go to null and nothing else may
-- change, so the record outlives the account without keeping who the person
-- was. The link, the text and the times stay.
--
-- Idempotent: CI re-applies the newest migration.

-- ---------------------------------------------------------------------------
-- 1. rights_declarations — every version of the declaration text, kept
--    forever. A confirmation names the version (and its hash) it agreed to.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rights_declarations (
  version integer PRIMARY KEY CHECK (version >= 1),
  text text NOT NULL CHECK (char_length(text) BETWEEN 20 AND 20000),
  text_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rights_declarations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rights_declarations FROM anon, authenticated;

INSERT INTO public.rights_declarations (version, text, text_hash)
SELECT 1, t, md5(t) FROM (SELECT
  'I confirm that I hold the rights to this content, or have the rights holder''s permission, to import it into Nodaro and to use it with Nodaro''s tools; that importing and using it does not infringe anyone''s copyright, trademark, privacy or publicity rights; and that I am responsible for how I use it. I understand that Nodaro keeps a record of this confirmation.'::text AS t
) seed
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. content_rights_confirmations — one row per confirmation, written by the
--    server only, with what the person saw and where they were.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_rights_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The account the confirmation belongs to (the one that pays for the run).
  -- Null once that account is deleted: the record stays.
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Who clicked, when it was not the account itself (a published app's runner).
  runner_user_id uuid,
  -- A connected app and its grant, when the confirmation came through one.
  app_id text,
  authorization_id uuid,
  -- checkbox: a person ticked the box; standing: a saved authorization; derived: made from a standing one.
  kind text NOT NULL DEFAULT 'checkbox' CHECK (kind IN ('checkbox', 'standing', 'derived')),
  declaration_version integer NOT NULL REFERENCES public.rights_declarations(version),
  declaration_hash text NOT NULL,
  -- The link as pasted, and the same link normalized (what a download is matched against).
  source_url text NOT NULL CHECK (char_length(source_url) <= 4000),
  normalized_url text NOT NULL CHECK (char_length(normalized_url) <= 4000),
  platform text,
  platform_video_id text,
  ip text,
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 1000),
  email text,
  -- Where it was confirmed: editor, app, api, mcp, admin.
  lane text CHECK (lane IS NULL OR char_length(lane) <= 40),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_rights_confirmations_user_idx ON public.content_rights_confirmations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_rights_confirmations_url_idx ON public.content_rights_confirmations (normalized_url);

ALTER TABLE public.content_rights_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_rights_confirmations FROM anon, authenticated;

-- A confirmation is a record: no delete, and no update but a scrub — the
-- owner's id (the account's deletion), the email, the address and the user
-- agent may each go to null; nothing else may change.
CREATE OR REPLACE FUNCTION public.preserve_content_rights_confirmation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  scrubbed text[] := ARRAY['user_id', 'email', 'ip', 'user_agent'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A content rights confirmation cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - scrubbed) = (to_jsonb(OLD) - scrubbed)
     AND (NEW.user_id IS NULL OR NEW.user_id = OLD.user_id)
     AND (NEW.email IS NULL OR NEW.email = OLD.email)
     AND (NEW.ip IS NULL OR NEW.ip = OLD.ip)
     AND (NEW.user_agent IS NULL OR NEW.user_agent = OLD.user_agent) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A content rights confirmation is immutable' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_content_rights_confirmation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS preserve_content_rights_confirmation ON public.content_rights_confirmations;
CREATE TRIGGER preserve_content_rights_confirmation
  BEFORE UPDATE OR DELETE ON public.content_rights_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.preserve_content_rights_confirmation();

CREATE OR REPLACE FUNCTION public.refuse_content_rights_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'A content rights record cannot be truncated' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.refuse_content_rights_truncate() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS refuse_content_rights_confirmations_truncate ON public.content_rights_confirmations;
CREATE TRIGGER refuse_content_rights_confirmations_truncate
  BEFORE TRUNCATE ON public.content_rights_confirmations
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_content_rights_truncate();

-- ---------------------------------------------------------------------------
-- 3. rights_events — what happened to a confirmation: made, consumed by a
--    download (once: the partial unique index is the one-use lock), and the
--    download's end. Append-only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rights_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  confirmation_id uuid NOT NULL REFERENCES public.content_rights_confirmations(id),
  kind text NOT NULL CHECK (kind IN ('confirmed', 'consumed', 'download_completed', 'download_failed')),
  lane text CHECK (lane IS NULL OR char_length(lane) <= 40),
  request_id text CHECK (request_id IS NULL OR char_length(request_id) <= 200),
  download_id text CHECK (download_id IS NULL OR char_length(download_id) <= 200),
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One download per confirmation: the second consumer's insert fails here.
CREATE UNIQUE INDEX IF NOT EXISTS rights_events_consumed_once ON public.rights_events (confirmation_id) WHERE kind = 'consumed';
CREATE INDEX IF NOT EXISTS rights_events_confirmation_idx ON public.rights_events (confirmation_id, created_at);

ALTER TABLE public.rights_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rights_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.preserve_rights_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'A rights event is immutable' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_rights_event() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS preserve_rights_event ON public.rights_events;
CREATE TRIGGER preserve_rights_event
  BEFORE UPDATE OR DELETE ON public.rights_events
  FOR EACH ROW EXECUTE FUNCTION public.preserve_rights_event();
DROP TRIGGER IF EXISTS refuse_rights_events_truncate ON public.rights_events;
CREATE TRIGGER refuse_rights_events_truncate
  BEFORE TRUNCATE ON public.rights_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_content_rights_truncate();

-- ---------------------------------------------------------------------------
-- 4. assets — the confirmation a downloaded file was imported under, and the
--    file's own fingerprint (the same video imported again is found by it).
-- ---------------------------------------------------------------------------
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS rights_confirmation_id uuid REFERENCES public.content_rights_confirmations(id);
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$');
CREATE INDEX IF NOT EXISTS assets_content_hash_idx ON public.assets (content_hash) WHERE content_hash IS NOT NULL;
