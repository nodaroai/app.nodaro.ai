-- 077_tutorials.sql — Tutorials table for admin-managed video tutorials

CREATE TABLE IF NOT EXISTS public.tutorials (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    video_url TEXT NOT NULL,
    thumbnail_url TEXT,
    category TEXT NOT NULL DEFAULT 'getting-started',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tutorials_enabled_sort
    ON public.tutorials(is_enabled, sort_order);

DROP TRIGGER IF EXISTS set_updated_at ON public.tutorials;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tutorials
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.tutorials ENABLE ROW LEVEL SECURITY;

-- Public can read enabled tutorials
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read enabled tutorials' AND tablename = 'tutorials') THEN
    CREATE POLICY "Anyone can read enabled tutorials"
        ON public.tutorials FOR SELECT
        USING (is_enabled = true);
END IF;
END $$;

-- Admins have full access
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage tutorials' AND tablename = 'tutorials') THEN
    CREATE POLICY "Admins can manage tutorials"
        ON public.tutorials FOR ALL
        USING (public.is_admin());
END IF;
END $$;
