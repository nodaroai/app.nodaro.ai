-- 578_import_source_policies.sql
--
-- Import source policies: what an admin decided about each site a link may
-- come from. One row per domain, written only from the admin screen; a site
-- with no row is approved. The backend (lib/import-source-policy.ts) reads it
-- before a link is downloaded; the status names are the ones the policy
-- document uses. Nothing here names a site: the rows are the admin's.
--
-- RLS on with NO policies, revoked from anon and authenticated: only the
-- service role reads or writes it. A policy a signed-in user could read would
-- tell them which sites are refused.
--
-- A save replaces the list whole, in ONE transaction, through
-- replace_import_source_policies: rows named stay or change (an unchanged row
-- keeps who set it and when), the rest go; a save made against a list that
-- moved since it was loaded is refused (40001), so two admins never silently
-- overwrite each other.
--
-- Idempotent: CI re-applies the newest migration.

CREATE TABLE IF NOT EXISTS public.import_source_policies (
  -- The site, lowercase, no leading `www.`, punycode for an international
  -- name (what `URL.hostname` answers); a subdomain of it is covered.
  domain text PRIMARY KEY CHECK (domain ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$' AND domain !~ '^www\.'),
  status text NOT NULL CHECK (status IN ('approved', 'restricted', 'permission_required', 'disabled', 'pending_legal_review')),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.import_source_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.import_source_policies FROM anon, authenticated;

-- The list's version: how many rows, and the newest change in milliseconds.
-- The backend computes the same string from the rows it listed and sends it
-- back with a save.
CREATE OR REPLACE FUNCTION public.import_source_policies_version() RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT count(*)::text || ':' || coalesce(floor(extract(epoch FROM max(updated_at)) * 1000)::bigint::text, '0')
  FROM public.import_source_policies;
$$;
REVOKE ALL ON FUNCTION public.import_source_policies_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_source_policies_version() TO service_role;

-- p_policies: a JSON array of { domain, status, note }, already normalized
-- and validated by the backend (the CHECKs above hold either way).
CREATE OR REPLACE FUNCTION public.replace_import_source_policies(p_policies jsonb, p_admin uuid, p_expected_version text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_version text;
BEGIN
  -- Serialize saves: the second of two concurrent saves sees the first's version.
  LOCK TABLE public.import_source_policies IN SHARE ROW EXCLUSIVE MODE;
  v_version := public.import_source_policies_version();
  IF v_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'The import source policies changed since they were loaded' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.import_source_policies (domain, status, note, updated_by, updated_at)
  SELECT p->>'domain', p->>'status', NULLIF(btrim(coalesce(p->>'note', '')), ''), p_admin, now()
  FROM jsonb_array_elements(p_policies) AS p
  ON CONFLICT (domain) DO UPDATE
    SET status = EXCLUDED.status, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
    WHERE public.import_source_policies.status IS DISTINCT FROM EXCLUDED.status
       OR public.import_source_policies.note IS DISTINCT FROM EXCLUDED.note;

  DELETE FROM public.import_source_policies
  WHERE domain NOT IN (SELECT p->>'domain' FROM jsonb_array_elements(p_policies) AS p);
END;
$$;
REVOKE ALL ON FUNCTION public.replace_import_source_policies(jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_import_source_policies(jsonb, uuid, text) TO service_role;
