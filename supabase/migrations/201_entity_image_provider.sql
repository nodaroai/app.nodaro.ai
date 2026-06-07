-- supabase/migrations/201_entity_image_provider.sql
--
-- Persist the image-model an entity's main image was generated with, so a
-- character / location / object "remembers" which model created it (e.g. to
-- pre-select it next time, or reuse it for asset/motion generation).
--
-- Nullable text. Set on create (the client passes the provider it generated
-- with) and editable via the update route. Value is a MODEL_CATALOG image-model
-- id, validated at the API boundary (unknown / non-image / empty -> null), so
-- no CHECK constraint here — the catalog is the source of truth and evolves in
-- code, not in the DB.

ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS image_provider text;
ALTER TABLE public.locations  ADD COLUMN IF NOT EXISTS image_provider text;
ALTER TABLE public.objects    ADD COLUMN IF NOT EXISTS image_provider text;

COMMENT ON COLUMN public.characters.image_provider IS
  'MODEL_CATALOG image-model id the main image was generated with (nullable). Validated at the API boundary against @nodaro/shared MODEL_CATALOG (kind=image); unknown -> null.';
COMMENT ON COLUMN public.locations.image_provider IS
  'MODEL_CATALOG image-model id the main image was generated with (nullable). Validated at the API boundary against @nodaro/shared MODEL_CATALOG (kind=image); unknown -> null.';
COMMENT ON COLUMN public.objects.image_provider IS
  'MODEL_CATALOG image-model id the main image was generated with (nullable). Validated at the API boundary against @nodaro/shared MODEL_CATALOG (kind=image); unknown -> null.';
