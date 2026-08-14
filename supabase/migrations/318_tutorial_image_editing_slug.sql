-- Attach the "Get started with image editing" guided tutorial to its template.
--
-- The guided view is keyed on an EXACT slug in
-- `frontend/src/components/tutorials/tutorial-registry.ts`, but every publish
-- path runs the slug through `generateSlug()` (backend/src/lib/marketplace-
-- helpers.ts), which appends six random characters unconditionally — even when
-- `slug` is supplied in the request body. So a freshly published tutorial gets
-- `get-started-with-image-editing-n4dtiz` and the registry never matches it:
-- the card appears in the Tutorials tab but opens the ordinary template
-- preview, silently, with nothing in the UI hinting why.
--
-- This repairs the row, and also sets the two curation fields to match the six
-- tutorials that shipped before it: tutorial-only (they are deliberately not on
-- the public marketplace) and the next free slot in Getting Started, which is 3
-- behind welcome-demo / person-node-basics / suno-music-basics.
--
-- NOT keyed on a UUID: the template's id exists only in the Cloud project, and
-- a migration that hardcodes it would be a lie on every other install. Matching
-- the generated-slug shape instead makes this correct anywhere the tutorial was
-- published, and a no-op everywhere it was not — including a fresh self-host,
-- where migrations run before the boot seeder and the seeder writes the clean
-- slug directly anyway.
--
-- Honest note on Cloud: this row was already repaired by a hand-run UPDATE on
-- 2026-08-14 before this migration existed, which was a mistake — database
-- changes belong in migrations, applied by the `migrate` job. On that project
-- this migration therefore finds nothing to do and completes as a no-op. It is
-- here so the change is reviewable, reproducible, and not lost on a restore.

-- One row, chosen deterministically. A LIKE-driven multi-row UPDATE could try
-- to give two rows the same slug, and `workflow_templates_slug_key` would abort
-- the migration — which fails the check suite and makes Railway SKIP the
-- production deploy, a far worse outcome than an unattached tutorial.
WITH target AS (
    SELECT id
    FROM public.workflow_templates
    WHERE slug ~ '^get-started-with-image-editing-[a-z0-9]{6}$'
    ORDER BY created_at
    LIMIT 1
)
UPDATE public.workflow_templates AS t
SET slug = 'get-started-with-image-editing',
    listed_in = ARRAY['tutorial']::text[],
    tutorial_sort_order = 3
FROM target
WHERE t.id = target.id
  -- Never collide with an existing clean slug: if one is already there, the
  -- tutorial is attached and there is nothing to repair.
  AND NOT EXISTS (
      SELECT 1
      FROM public.workflow_templates
      WHERE slug = 'get-started-with-image-editing'
  )
  -- `wf_templates_tutorial_requires_category` (migration 114) rejects a row
  -- listed as a tutorial without a category, so only touch rows that already
  -- have one. An uncategorised row is an admin step that has not happened yet.
  AND t.tutorial_category_id IS NOT NULL;
