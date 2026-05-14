-- 114_tutorials_unified.sql — Unified tutorials system
--
-- Two tutorial flavors share one category taxonomy:
--   1. Video Tutorials — existing public.tutorials table (admin-managed videos)
--   2. Flow Tutorials  — workflow_templates flagged with 'tutorial' in listed_in
--
-- Changes:
--   - New table  : public.tutorial_categories  (shared taxonomy)
--   - tutorials  : category TEXT  →  category_id UUID FK (NOT NULL after backfill)
--   - workflow_templates :
--       * is_listed BOOLEAN  →  listed_in TEXT[]  (extensible: 'marketplace' / 'tutorial' / ...)
--       * + tutorial_category_id UUID FK  (nullable; required when 'tutorial' ∈ listed_in)
--       * + tutorial_sort_order INT       (ordering inside the tutorial tab)
--       * dependent indexes rewritten to use listed_in
--
-- The migration is idempotent: all ADD/DROP COLUMN, CREATE INDEX, CREATE
-- TRIGGER, INSERT statements guard against re-run. Backfills are gated on
-- the old column still existing, so a second run is a safe no-op.

-- ---------------------------------------------------------------------------
-- 1. tutorial_categories
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tutorial_categories (
    id          UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    slug        TEXT NOT NULL UNIQUE,
    description TEXT,
    sort_order  INT NOT NULL DEFAULT 0,
    is_enabled  BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at ON public.tutorial_categories;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tutorial_categories
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.tutorial_categories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tutorial_categories'
      AND policyname = 'Anyone can read enabled tutorial categories'
) THEN
    CREATE POLICY "Anyone can read enabled tutorial categories"
        ON public.tutorial_categories FOR SELECT
        USING (is_enabled = true);
END IF;
IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tutorial_categories'
      AND policyname = 'Admins can manage tutorial categories'
) THEN
    -- Uses is_admin() SECURITY DEFINER helper — never query profiles from
    -- profiles policies (causes infinite recursion). Categories table itself
    -- doesn't recurse, but we follow the same convention.
    CREATE POLICY "Admins can manage tutorial categories"
        ON public.tutorial_categories FOR ALL
        USING (public.is_admin());
END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tutorial_categories_sort
    ON public.tutorial_categories(sort_order)
    WHERE is_enabled = true;

-- ---------------------------------------------------------------------------
-- 2. Seed the three existing hardcoded categories
-- ---------------------------------------------------------------------------

INSERT INTO public.tutorial_categories (name, slug, sort_order) VALUES
    ('Getting Started', 'getting-started', 0),
    ('Workflows',       'workflows',       1),
    ('Advanced',        'advanced',        2)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. tutorials: category TEXT → category_id UUID
-- ---------------------------------------------------------------------------

ALTER TABLE public.tutorials
    ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.tutorial_categories(id);

-- Backfill from the old `category` slug — guarded so the migration is safe
-- to re-run after the DROP COLUMN below has already removed `category`.
DO $$ BEGIN
IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tutorials' AND column_name = 'category'
) THEN
    -- Match by slug
    UPDATE public.tutorials t
       SET category_id = c.id
      FROM public.tutorial_categories c
     WHERE t.category_id IS NULL AND c.slug = t.category;

    -- Any leftover NULLs (unknown slug in the wild) fall back to 'getting-started'
    UPDATE public.tutorials t
       SET category_id = c.id
      FROM public.tutorial_categories c
     WHERE t.category_id IS NULL AND c.slug = 'getting-started';
END IF;
END $$;

-- ALTER COLUMN ... SET NOT NULL is idempotent in Postgres (no error if
-- already NOT NULL), so safe to re-run.
ALTER TABLE public.tutorials ALTER COLUMN category_id SET NOT NULL;

ALTER TABLE public.tutorials DROP COLUMN IF EXISTS category;

DROP INDEX IF EXISTS public.idx_tutorials_enabled_sort;
CREATE INDEX IF NOT EXISTS idx_tutorials_enabled_sort
    ON public.tutorials(is_enabled, sort_order);

CREATE INDEX IF NOT EXISTS idx_tutorials_category_id
    ON public.tutorials(category_id);

-- ---------------------------------------------------------------------------
-- 4. workflow_templates: is_listed → listed_in[] + tutorial fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.workflow_templates
    ADD COLUMN IF NOT EXISTS listed_in TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.workflow_templates
    ADD COLUMN IF NOT EXISTS tutorial_category_id UUID REFERENCES public.tutorial_categories(id);

ALTER TABLE public.workflow_templates
    ADD COLUMN IF NOT EXISTS tutorial_sort_order INT NOT NULL DEFAULT 0;

-- Backfill listed_in from the old is_listed boolean (guarded for re-run).
DO $$ BEGIN
IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workflow_templates' AND column_name = 'is_listed'
) THEN
    UPDATE public.workflow_templates
       SET listed_in = ARRAY['marketplace']
     WHERE is_listed = true AND NOT ('marketplace' = ANY(listed_in));
END IF;
END $$;

-- Drop indexes whose WHERE predicate references is_listed before we can
-- drop the column itself.
DROP INDEX IF EXISTS public.idx_wf_templates_browse;
DROP INDEX IF EXISTS public.idx_wf_templates_tags;
DROP INDEX IF EXISTS public.idx_wf_templates_popular;
DROP INDEX IF EXISTS public.idx_wf_templates_favorited;

ALTER TABLE public.workflow_templates DROP COLUMN IF EXISTS is_listed;

-- Recreate marketplace indexes against listed_in.
CREATE INDEX IF NOT EXISTS idx_wf_templates_browse
    ON public.workflow_templates(created_at DESC)
    WHERE 'marketplace' = ANY(listed_in) AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_wf_templates_tags
    ON public.workflow_templates USING GIN(tags)
    WHERE 'marketplace' = ANY(listed_in) AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_wf_templates_popular
    ON public.workflow_templates(clone_count DESC)
    WHERE 'marketplace' = ANY(listed_in) AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_wf_templates_favorited
    ON public.workflow_templates(favorite_count DESC)
    WHERE 'marketplace' = ANY(listed_in) AND is_active = true;

-- Tutorial-specific index — used by GET /v1/tutorials to fetch flow tutorials
-- ordered by admin-set tutorial_sort_order.
CREATE INDEX IF NOT EXISTS idx_wf_templates_tutorial
    ON public.workflow_templates(tutorial_sort_order)
    WHERE 'tutorial' = ANY(listed_in) AND is_active = true;

-- General GIN over listed_in — supports filters like 'marketplace' = ANY(listed_in)
-- without needing partial indexes for every combination.
CREATE INDEX IF NOT EXISTS idx_wf_templates_listed_in
    ON public.workflow_templates USING GIN(listed_in);

CREATE INDEX IF NOT EXISTS idx_wf_templates_tutorial_category
    ON public.workflow_templates(tutorial_category_id)
    WHERE tutorial_category_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. CHECK constraint: tutorial entries must have a category
-- ---------------------------------------------------------------------------
DO $$ BEGIN
IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wf_templates_tutorial_requires_category'
) THEN
    ALTER TABLE public.workflow_templates
        ADD CONSTRAINT wf_templates_tutorial_requires_category
        CHECK (NOT ('tutorial' = ANY(listed_in)) OR tutorial_category_id IS NOT NULL);
END IF;
END $$;
