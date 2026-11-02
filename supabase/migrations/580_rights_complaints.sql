-- 580_rights_complaints.sql
--
-- Content complaints: the case a complaint opens (a copyright notice, or
-- another legal complaint about content on the platform) and the append-only
-- log of everything that happens to it. The public form writes here through
-- the backend (lib/rights-complaints.ts); nothing is reachable through
-- PostgREST.
--
-- A case is a legal record. Its row changes as it is handled (status, handler,
-- decision, the content it was matched to), but it is never deleted and the
-- table is never truncated; what the complainant submitted (their details,
-- the work, the explanation, the statements they affirmed) is frozen by a
-- trigger. The complainant's personal details are stored ENCRYPTED
-- (lib/instance-cipher.ts, bound to this purpose) with a hash of the email
-- for lookups, and never in the clear. Every change is also an event, and an
-- event is never updated or deleted.
--
-- A submission opens a case at once (so nothing a complainant sent is ever
-- dropped), unverified: the complainant proves their email with a one-time
-- link, and `verified_at` says when. The reference number the complainant is
-- given is made here, never by the client.
--
-- The encrypted columns are frozen with the rest of the submission, so they
-- can never be re-encrypted: the instance key that wrote a case is the key
-- that reads it, for the life of the record (docs/deployment.md on the key).
-- Every change the server makes to a case is also logged by the database
-- itself (`row_updated`, the columns that changed), so the log holds without
-- trusting the writer.
--
-- Idempotent: CI re-applies the newest migration.

CREATE SEQUENCE IF NOT EXISTS public.rights_complaints_reference_seq;

CREATE TABLE IF NOT EXISTS public.rights_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The number the complainant is given and quotes: CR-<year>-<6 digits>.
  reference text NOT NULL UNIQUE
    DEFAULT ('CR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.rights_complaints_reference_seq')::text, 6, '0')),
  -- copyright: a notice under the copyright policy (the twelve fields and two
  -- statements); other: one of the other categories.
  kind text NOT NULL CHECK (kind IN ('copyright', 'other')),
  category text NOT NULL CHECK (category IN (
    'copyright_infringement', 'likeness', 'voice', 'impersonation', 'privacy', 'other'
  )),
  status text NOT NULL DEFAULT 'received' CHECK (status IN (
    'received', 'under_review', 'additional_information_requested', 'content_restricted',
    'content_removed', 'user_notified', 'counter_notice_received', 'counter_notice_under_review',
    'awaiting_legal_action', 'content_restored', 'resolved', 'closed'
  )),
  received_at timestamptz NOT NULL DEFAULT now(),
  -- The complainant proved their email with the one-time link.
  verified_at timestamptz,
  verification_token_hash text,
  verification_expires_at timestamptz,
  -- The complainant, encrypted; the email also hashed for lookups.
  complainant_name_enc text NOT NULL,
  complainant_email_enc text NOT NULL,
  complainant_email_hash text NOT NULL,
  complainant_address_enc text,
  complainant_phone_enc text,
  -- owner: the rights holder; agent: authorized to act for the holder. Null for another complaint.
  claimant_role text CHECK (claimant_role IS NULL OR claimant_role IN ('owner', 'agent')),
  -- The work claimed and where the complained-of content is, as the complainant wrote them.
  original_work text CHECK (original_work IS NULL OR char_length(original_work) <= 4000),
  original_work_url text CHECK (original_work_url IS NULL OR char_length(original_work_url) <= 4000),
  reported_content text NOT NULL CHECK (char_length(reported_content) <= 8000),
  explanation text NOT NULL CHECK (char_length(explanation) <= 8000),
  signature_enc text,
  -- The two statements of a copyright notice, affirmed: when, and a hash of
  -- the texts shown, so the record says what was affirmed.
  good_faith_affirmed_at timestamptz,
  accuracy_affirmed_at timestamptz,
  statements_hash text,
  -- The links the complainant gave, normalized, and what they matched in our
  -- own records (never answered to the complainant).
  reported_urls text[] NOT NULL DEFAULT '{}',
  matched_asset_ids uuid[] NOT NULL DEFAULT '{}',
  matched_confirmation_ids uuid[] NOT NULL DEFAULT '{}',
  matched_user_ids uuid[] NOT NULL DEFAULT '{}',
  -- The account that imported or holds the content, once the case names one.
  -- Null once that account is deleted: the record stays.
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  handler_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decision text CHECK (decision IS NULL OR char_length(decision) <= 8000),
  closed_at timestamptz,
  -- Where the submission came from: the hashed network and the agent.
  network_hash text,
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rights_complaints_status_idx ON public.rights_complaints (status, received_at DESC);
CREATE INDEX IF NOT EXISTS rights_complaints_email_idx ON public.rights_complaints (complainant_email_hash);
CREATE INDEX IF NOT EXISTS rights_complaints_user_idx ON public.rights_complaints (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rights_complaints_token_idx ON public.rights_complaints (verification_token_hash) WHERE verification_token_hash IS NOT NULL;
-- Submissions per network per window (the public form's rate limit).
CREATE INDEX IF NOT EXISTS rights_complaints_network_idx ON public.rights_complaints (network_hash, received_at DESC) WHERE network_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.rights_complaint_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES public.rights_complaints(id),
  -- received, verified, verification_sent, acknowledgment_sent, mail_unavailable,
  -- status_changed, note, ... — what happened, by whom.
  kind text NOT NULL CHECK (char_length(kind) <= 60),
  -- system, complainant, or the admin's user id.
  actor text NOT NULL CHECK (char_length(actor) <= 80),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rights_complaint_events_complaint_idx ON public.rights_complaint_events (complaint_id, created_at);

ALTER TABLE public.rights_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rights_complaint_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rights_complaints FROM anon, authenticated;
REVOKE ALL ON public.rights_complaint_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.rights_complaints_reference_seq FROM anon, authenticated;

-- A case is never deleted, and what the complainant submitted never changes:
-- the server may move the case (status, handler, decision, matches,
-- verification, the account it names) and nothing else.
CREATE OR REPLACE FUNCTION public.preserve_rights_complaint() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  mutable text[] := ARRAY[
    'status', 'verified_at', 'verification_token_hash', 'verification_expires_at',
    'matched_asset_ids', 'matched_confirmation_ids', 'matched_user_ids',
    'user_id', 'handler_user_id', 'decision', 'closed_at', 'updated_at'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A content complaint cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - mutable) = (to_jsonb(OLD) - mutable) THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A content complaint''s submission is immutable' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_rights_complaint() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS preserve_rights_complaint ON public.rights_complaints;
CREATE TRIGGER preserve_rights_complaint
  BEFORE UPDATE OR DELETE ON public.rights_complaints
  FOR EACH ROW EXECUTE FUNCTION public.preserve_rights_complaint();

-- An event is a record: never updated, never deleted.
CREATE OR REPLACE FUNCTION public.refuse_rights_complaint_event_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'A content complaint event is immutable' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.refuse_rights_complaint_event_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS refuse_rights_complaint_event_change ON public.rights_complaint_events;
CREATE TRIGGER refuse_rights_complaint_event_change
  BEFORE UPDATE OR DELETE ON public.rights_complaint_events
  FOR EACH ROW EXECUTE FUNCTION public.refuse_rights_complaint_event_change();

-- The database logs every change to a case: which columns changed, never
-- their values (the complainant's details are among them).
CREATE OR REPLACE FUNCTION public.log_rights_complaint_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  changed text[];
BEGIN
  SELECT coalesce(array_agg(n.key ORDER BY n.key), '{}'::text[]) INTO changed
  FROM jsonb_each(to_jsonb(NEW)) AS n
  WHERE (to_jsonb(OLD) -> n.key) IS DISTINCT FROM n.value AND n.key <> 'updated_at';
  INSERT INTO public.rights_complaint_events (complaint_id, kind, actor, data)
  VALUES (NEW.id, 'row_updated', 'database', jsonb_build_object('columns', to_jsonb(changed)));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.log_rights_complaint_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS log_rights_complaint_update ON public.rights_complaints;
CREATE TRIGGER log_rights_complaint_update
  AFTER UPDATE ON public.rights_complaints
  FOR EACH ROW EXECUTE FUNCTION public.log_rights_complaint_update();

-- The links a complaint names are matched against the files' own addresses
-- and the links they were imported from: both need an index of their own
-- (the existing (user_id, r2_url) index does not serve a lookup by address).
CREATE INDEX IF NOT EXISTS idx_assets_r2_url ON public.assets (r2_url);
CREATE INDEX IF NOT EXISTS idx_assets_source_url ON public.assets ((metadata->>'source_url'));

-- Neither table is ever truncated (the function is migration 577's).
DROP TRIGGER IF EXISTS refuse_rights_complaints_truncate ON public.rights_complaints;
CREATE TRIGGER refuse_rights_complaints_truncate
  BEFORE TRUNCATE ON public.rights_complaints
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_content_rights_truncate();
DROP TRIGGER IF EXISTS refuse_rights_complaint_events_truncate ON public.rights_complaint_events;
CREATE TRIGGER refuse_rights_complaint_events_truncate
  BEFORE TRUNCATE ON public.rights_complaint_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_content_rights_truncate();
