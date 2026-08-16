-- Attach the "Camera Coverage — one frame, ten angles" guided tutorial to its
-- published template.
--
-- Same repair as 318 (image editing), for the same reason: the guided view is
-- keyed on an EXACT slug in `frontend/src/components/tutorials/tutorial-
-- registry.ts` ("camera-coverage"), but every publish path runs the name
-- through `generateSlug()` (backend/src/lib/marketplace-helpers.ts), which
-- appends six random characters unconditionally. Publishing therefore gave the
-- template `camera-coverage-one-frame-ten-angles-9obeub`, which the registry
-- never matches — the card would open the ordinary template preview, silently.
--
-- Unlike 318, this one also does the curation that used to be a separate admin
-- click, so the row is complete in one reviewable step: listed as a tutorial
-- (and only as a tutorial — like the seven before it, it is deliberately not on
-- the public marketplace), filed under the "Workflows" category, at the next
-- free slot there (Multi-Reference Control = 0, Social Media Autopilot = 1).
-- Setting the category in the SAME statement is what satisfies
-- `wf_templates_tutorial_requires_category` (migration 114) — 318 had to wait
-- for the admin step because it did not set the category itself.
--
-- NOT keyed on a UUID: the template's id exists only in the Cloud project. The
-- generated-slug shape is what publish produces on ANY install, so this is
-- correct wherever the tutorial was published from the app and a no-op
-- everywhere it was not — including a fresh self-host, where migrations run
-- before the boot seeder and the seeder writes the clean slug directly.

-- One row, chosen deterministically. A LIKE-driven multi-row UPDATE could try
-- to give two rows the same slug, and `workflow_templates_slug_key` would abort
-- the migration — which fails the check suite and makes Railway SKIP the
-- production deploy, a far worse outcome than an unattached tutorial.
WITH target AS (
    SELECT id
    FROM public.workflow_templates
    WHERE slug ~ '^camera-coverage-one-frame-ten-angles-[a-z0-9]{6}$'
    ORDER BY created_at
    LIMIT 1
),
category AS (
    SELECT id
    FROM public.tutorial_categories
    WHERE slug = 'workflows'
    LIMIT 1
)
UPDATE public.workflow_templates AS t
SET slug = 'camera-coverage',
    -- The published name carries a typo ("Coverage -one frame"); align it with
    -- the seed template. Doing it HERE rather than through the publish dialog
    -- matters: the dialog's update path regenerates the slug whenever the name
    -- changes (the "Reset slug only if name changed" branch in
    -- routes/workflow-templates.ts), which would detach the tutorial again.
    -- With the row already carrying the corrected name, a later re-publish
    -- from the dialog (which pre-fills the current name) leaves the slug alone.
    name = 'Camera Coverage — one frame, ten angles',
    listed_in = ARRAY['tutorial']::text[],
    tutorial_category_id = category.id,
    tutorial_sort_order = 2
FROM target, category
WHERE t.id = target.id
  -- Never collide with an existing clean slug: if one is already there, the
  -- tutorial is attached and there is nothing to repair.
  AND NOT EXISTS (
      SELECT 1
      FROM public.workflow_templates
      WHERE slug = 'camera-coverage'
  );
