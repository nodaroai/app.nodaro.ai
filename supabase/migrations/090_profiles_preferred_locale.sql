-- Add preferred_locale column to profiles for picker i18n.
--
-- The column is nullable (NULL = "fall back to browser language detection on
-- the frontend, then to English"). Allowed values are validated client-side
-- and via Zod on the backend (en, es, fr, de, pt-BR, ru, hi, ja, ko, zh-CN,
-- he, ar). We don't add a CHECK constraint here because the locale list will
-- evolve over time and the API layer is the right place to gate it.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_locale TEXT;

COMMENT ON COLUMN profiles.preferred_locale IS
  'User-selected language for parameter-node picker labels/descriptions. NULL = browser-detected, falls back to English. Set via PATCH /v1/user/settings.';
