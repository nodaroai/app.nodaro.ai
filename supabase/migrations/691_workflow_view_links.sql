-- 691: a workflow's public view link.
--
-- The owner of a workflow can turn on a read-only view of its canvas: anyone
-- holding the link (or a page that embeds it) sees the nodes, their results,
-- the prompts and the notes, signed in or not. It is a link of its own,
-- separate from the presentation link (workflows.share_token, migration 040),
-- which lets a viewer RUN the workflow and never shows the canvas: turning one
-- on or off never touches the other.
--
-- One row per workflow:
--   token                   the link's credential (32 random bytes, base64url);
--                           a new link is a new token, so a revoked link never
--                           comes back.
--   owner_id                the workflow's creator when the link was turned on.
--                           The link answers only while the workflow is still
--                           theirs (the API checks workflows.user_id).
--   indexable               whether search engines may index the view (the
--                           owner's switch, on by default).
--   locale                  the interface language the link was turned on in;
--                           the link's preview card is written in it.
--   export_snapshot         the downloadable copy of the workflow, frozen when
--                           the owner saved it: viewers download THIS, never the
--                           live workflow, until the owner saves it again. Kept
--                           in the row (not on the public storage bucket) so
--                           revoking the link takes the file down with it.
--   export_includes_assets  whether the copy carries the characters, locations
--                           and objects the workflow uses.
--
-- Service-role only, like asset_favorites (688): the API routes
-- (backend/src/routes/workflow-view-links.ts) are the one way in, the owner
-- side scoped to the workflow's creator. No client role holds a privilege on
-- the table, so RLS is on with no policies and a browser cannot reach a token
-- through PostgREST. supabase/tests/workflow-view-links.behavior.sql proves it.
--
-- A deploy of dev runs ahead of this migration (it lands with the release to
-- main): until the table exists the API answers 503 not_available
-- (lib/workflow-view/table.ts).
--
-- Re-runnable: IF NOT EXISTS everywhere; the REVOKE/GRANT pair is idempotent.
-- The table is new, so the only lock taken on an existing table is the FKs'
-- SHARE ROW EXCLUSIVE on workflows / profiles; the lock_timeout bounds that
-- wait to a failed, safely retried migration instead of a stalled platform.
SET LOCAL lock_timeout = '2s';

CREATE TABLE IF NOT EXISTS public.workflow_view_links (
  -- The workflow goes, its link goes with it.
  workflow_id            UUID PRIMARY KEY REFERENCES public.workflows(id) ON DELETE CASCADE,
  owner_id               UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token                  TEXT NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{43}$'),
  indexable              BOOLEAN NOT NULL DEFAULT TRUE,
  locale                 TEXT CHECK (locale IS NULL OR locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  export_snapshot        JSONB,
  export_includes_assets BOOLEAN,
  exported_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A copy is saved with its time and what it carries, or not at all.
  CONSTRAINT workflow_view_links_export_whole CHECK (
    (export_snapshot IS NULL AND exported_at IS NULL AND export_includes_assets IS NULL)
    OR (export_snapshot IS NOT NULL AND exported_at IS NOT NULL AND export_includes_assets IS NOT NULL)
  )
);

-- The FK's own index: a deleted profile finds its links without a scan.
CREATE INDEX IF NOT EXISTS idx_workflow_view_links_owner
  ON public.workflow_view_links (owner_id);

ALTER TABLE public.workflow_view_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.workflow_view_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workflow_view_links TO service_role;

COMMENT ON TABLE public.workflow_view_links IS
  'A workflow''s public, read-only view link (canvas + embed), its search-engine switch and its frozen downloadable copy. Service-role only.';
