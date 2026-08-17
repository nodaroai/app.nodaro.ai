-- Attach the "One Character, Any Scene" guided tutorial to its published
-- template.
--
-- Same repair as 318 (image editing) and 320 (camera coverage), for the same
-- reason: the guided view is keyed on an EXACT slug in
-- `frontend/src/components/tutorials/tutorial-registry.ts`
-- ("one-character-any-scene"), but every publish path runs the name through
-- `generateSlug()` (backend/src/lib/marketplace-helpers.ts), which cuts the
-- name to 40 characters and appends six random ones unconditionally.
-- Publishing "One Character, Any Scene — Without Masks or Training" therefore
-- gives `one-character-any-scene-without-masks-or-xxxxxx`, which the registry
-- never matches — the card would open the ordinary template preview, silently.
--
-- Like 320, this also does the curation in the same reviewable step: listed
-- as a tutorial (and only as a tutorial — like the eight before it, it is
-- deliberately not on the public marketplace), filed under the "Workflows"
-- category, at the next free slot there (Multi-Reference Control = 0, Social
-- Media Autopilot = 1, Camera Coverage = 2). Setting the category in the SAME
-- statement is what satisfies `wf_templates_tutorial_requires_category`
-- (migration 114).
--
-- NOT keyed on a UUID: the template's id exists only in the Cloud project. The
-- generated-slug shape is what publish produces on ANY install, so this is
-- correct wherever the tutorial was published from the app and a no-op
-- everywhere it was not — including a fresh self-host, where migrations run
-- before the boot seeder and the seeder writes the clean slug directly. The
-- name prefix is matched loosely (any "one-character-any-scene…" slug) so a
-- publish under the shorter working title attaches too.
--
-- ORDER OF OPERATIONS: this must run AFTER the template has been published on
-- Cloud (a migration is one-shot; if it runs first it is a no-op and the
-- tutorial stays detached — re-attach with the next numbered migration).

WITH target AS (
    SELECT id
    FROM public.workflow_templates
    WHERE slug ~ '^one-character-any-scene[a-z0-9-]*-[a-z0-9]{6}$'
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
SET slug = 'one-character-any-scene',
    -- The working title on the canvas was cut off ("…Without Masks or"); align
    -- the published name with the seed template HERE rather than through the
    -- publish dialog, whose update path regenerates the slug whenever the name
    -- changes (the "Reset slug only if name changed" branch in
    -- routes/workflow-templates.ts) and would detach the tutorial again.
    name = 'One Character, Any Scene — Without Masks or Training',
    listed_in = ARRAY['tutorial']::text[],
    tutorial_category_id = category.id,
    tutorial_sort_order = 3
FROM target, category
WHERE t.id = target.id
  -- Never collide with an existing clean slug: if one is already there, the
  -- tutorial is attached and there is nothing to repair.
  AND NOT EXISTS (
      SELECT 1
      FROM public.workflow_templates
      WHERE slug = 'one-character-any-scene'
  );
