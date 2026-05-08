-- Repair pre-existing malformed allowed_origins entries that pre-date the
-- bareOriginSchema validation added in #2237 (CVE-2026-3854 audit fix).
--
-- An audit on 2026-05-08 found one row in published_apps with a path-bearing
-- URL stored in the allowed_origins array:
--
--   slug  = 'ai-portrait-studio-m4zb81'
--   value = 'https://nodaro.ai/docs/concepts/apps'
--
-- The new bareOriginSchema gates new writes (refines z.string().url() to a
-- bare http(s) origin with no path/query/fragment), but pre-existing rows are
-- read unchanged into the `frame-ancestors` CSP directive on /v1/embed/:slug.
-- The path-bearing form is harmless from a security standpoint (paths in CSP
-- host-source expressions tighten rather than loosen the restriction; no
-- delimiter to inject) but breaks practical embedding because browsers treat
-- the whole host-source including path as the framing restriction.
--
-- This migration surgically removes only the known-bad value via array_remove,
-- preserving any sibling valid entries the developer may have added later.
-- The WHERE clause gates the UPDATE so re-running this migration on a fresh
-- database, on staging, or on a prod DB where the value has already been
-- repaired by hand is a guaranteed no-op.

UPDATE public.published_apps
SET allowed_origins = array_remove(allowed_origins, 'https://nodaro.ai/docs/concepts/apps')
WHERE slug = 'ai-portrait-studio-m4zb81'
  AND 'https://nodaro.ai/docs/concepts/apps' = ANY(allowed_origins);
