-- Migration: Add app_settings table and cost columns to jobs
-- Created: 2026-02-04

-- App-wide settings (key-value store)
CREATE TABLE IF NOT EXISTS public.app_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES public.profiles(id)
);

-- Initial settings
INSERT INTO public.app_settings (key, value) VALUES
    ('ai_provider', '"replicate"'),
    ***REDACTED-OSS-SCRUB***
ON CONFLICT (key) DO NOTHING;

-- RLS: Only admins can read/write
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists (for re-running migration)
DROP POLICY IF EXISTS "Admins can manage settings" ON public.app_settings;

CREATE POLICY "Admins can manage settings" ON public.app_settings
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
    );

-- Add cost columns to jobs table
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS provider_cost DECIMAL(10, 6);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS display_cost DECIMAL(10, 6);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_app_settings_key ON public.app_settings(key);
