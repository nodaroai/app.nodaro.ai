-- supabase/migrations/205_entity_selected_asset_by_variant.sql
--
-- Persist the user's chosen DEFAULT asset take per variant on a
-- character / location / object. The Studio's per-shot version history appends a
-- new {name,url} to a bucket on every regenerate, so multiple takes accumulate
-- per variant; this column records WHICH take the user picked as the default
-- (the one shown + used as the identity reference), like picking a voice.
--
-- OPAQUE studio-owned map: key = "<bucket>:<variant>" (camelCase bucket name +
-- the exact variant string, e.g. "bodyAngles:front", "expressions:smile"); the
-- "<bucket>:" prefix disambiguates a variant present in more than one bucket.
-- value = the chosen asset URL (one already present in that bucket). The platform
-- never interprets keys, never cross-validates the URL against a bucket, and
-- never normalizes keys — soft caps (<=200 keys, <=2048-char values) are enforced
-- at the API boundary and overflow is dropped SILENTLY (never a 400). Stored as a
-- SEPARATE column on purpose: persisting a selection must never rewrite an asset
-- bucket (a rewrite would strip per-entry description/motionDescription/
-- realLifeRefs the SDK doesn't expose). NOT NULL DEFAULT '{}' so reads never
-- have to defend against null.

ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS selected_asset_by_variant JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.locations  ADD COLUMN IF NOT EXISTS selected_asset_by_variant JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.objects    ADD COLUMN IF NOT EXISTS selected_asset_by_variant JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.characters.selected_asset_by_variant IS
  'Opaque studio-owned map: key "<bucket>:<variant>" -> chosen asset URL (the user-picked default take for that variant). Keys NOT normalized; soft-capped at the API boundary (<=200 keys, <=2048-char values, overflow dropped silently). Separate from asset buckets so a selection never rewrites a bucket.';
COMMENT ON COLUMN public.locations.selected_asset_by_variant IS
  'Opaque studio-owned map: key "<bucket>:<variant>" -> chosen asset URL (the user-picked default take for that variant). Keys NOT normalized; soft-capped at the API boundary (<=200 keys, <=2048-char values, overflow dropped silently). Separate from asset buckets so a selection never rewrites a bucket.';
COMMENT ON COLUMN public.objects.selected_asset_by_variant IS
  'Opaque studio-owned map: key "<bucket>:<variant>" -> chosen asset URL (the user-picked default take for that variant). Keys NOT normalized; soft-capped at the API boundary (<=200 keys, <=2048-char values, overflow dropped silently). Separate from asset buckets so a selection never rewrites a bucket.';
