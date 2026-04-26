/**
 * i18n resolver + lazy loader for parameter-node picker labels/descriptions.
 *
 * Usage from a picker component:
 *
 * ```ts
 * const locale = useUserLocale()                              // current user-selected locale
 * await ensureLocaleCatalogLoaded("styling", locale)          // call once per (catalog, locale), cached
 * const localized = getLocalizedEntry("styling", entry.id, locale)
 * const label = localized?.label ?? entry.label              // fallback to canonical English
 * const description = localized?.description ?? entry.description
 * ```
 *
 * For search filtering, use `entryMatchesQuery(entry, locale, query)` which
 * filters across BOTH the canonical English text AND the localized text.
 */

import type { I18nCatalogId, LocaleCatalogMap, LocaleId, LocalizedEntry } from "./types.js"

export * from "./types.js"

/**
 * In-memory cache of loaded locale catalogs. Key = `<catalog>:<locale>`.
 * `undefined` = never loaded; `null` = loaded but missing/empty.
 */
const cache = new Map<string, LocaleCatalogMap | null>()
const inflight = new Map<string, Promise<LocaleCatalogMap | null>>()

function cacheKey(catalog: I18nCatalogId, locale: LocaleId): string {
  return `${catalog}:${locale}`
}

/**
 * Lazy-load a sidecar catalog. Returns `null` if the locale is `en` (no
 * sidecar — English lives in the canonical catalog file) or if no sidecar
 * file exists for that (catalog, locale) pair.
 *
 * Implementation note: the dynamic import string is constructed so that
 * Vite can statically analyze the glob and code-split each locale into its
 * own chunk. The `/* @vite-ignore *\/` comment is required because the
 * locale variable defeats Vite's default static analysis; we accept the
 * runtime resolution and rely on the glob-discovery at module init.
 */
export async function ensureLocaleCatalogLoaded(
  catalog: I18nCatalogId,
  locale: LocaleId,
): Promise<LocaleCatalogMap | null> {
  if (locale === "en") return null
  const key = cacheKey(catalog, locale)
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const existing = inflight.get(key)
  if (existing) return existing
  const promise = loadLocaleCatalog(catalog, locale).then(
    (map) => {
      cache.set(key, map)
      inflight.delete(key)
      return map
    },
    (err) => {
      inflight.delete(key)
      // Cache the failure as null so we don't retry forever
      cache.set(key, null)
      // Don't throw — missing sidecars are expected during gradual rollout;
      // the picker just falls back to English.
      console.warn(`[i18n] failed to load ${key}:`, err)
      return null
    },
  )
  inflight.set(key, promise)
  return promise
}

/**
 * Resolved value lookup. Reads from the in-memory cache; returns `undefined`
 * if the locale's catalog hasn't been loaded yet (caller should await
 * `ensureLocaleCatalogLoaded` first).
 */
export function getLocalizedEntry(
  catalog: I18nCatalogId,
  id: string,
  locale: LocaleId,
): LocalizedEntry | undefined {
  if (locale === "en") return undefined
  const map = cache.get(cacheKey(catalog, locale))
  if (!map) return undefined
  return map[id]
}

/**
 * Synchronous resolver that returns the best label available right now.
 * Falls back to `englishLabel` when no translation exists (or the locale
 * sidecar isn't loaded yet).
 */
export function resolveLabel(
  catalog: I18nCatalogId,
  id: string,
  englishLabel: string,
  locale: LocaleId,
): string {
  if (locale === "en") return englishLabel
  return getLocalizedEntry(catalog, id, locale)?.label ?? englishLabel
}

/**
 * Synchronous resolver that returns the best description available now.
 * Falls back to `englishDescription` when no translation exists.
 */
export function resolveDescription(
  catalog: I18nCatalogId,
  id: string,
  englishDescription: string,
  locale: LocaleId,
): string {
  if (locale === "en") return englishDescription
  return getLocalizedEntry(catalog, id, locale)?.description ?? englishDescription
}

/**
 * Search predicate: returns true if `query` matches either the canonical
 * English label/description or the localized label/description for the
 * current locale.
 *
 * Empty query always matches.
 */
export function entryMatchesQuery(
  catalog: I18nCatalogId,
  id: string,
  englishLabel: string,
  englishDescription: string,
  locale: LocaleId,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (englishLabel.toLowerCase().includes(q)) return true
  if (englishDescription.toLowerCase().includes(q)) return true
  if (locale === "en") return false
  const localized = getLocalizedEntry(catalog, id, locale)
  if (!localized) return false
  if (localized.label && localized.label.toLowerCase().includes(q)) return true
  if (localized.description && localized.description.toLowerCase().includes(q)) return true
  return false
}

/**
 * Vite-bundled glob of every sidecar file at build time. Vite scans the
 * pattern at build time and REPLACES this call with a static object literal
 * mapping each matched path to a code-split loader function. At runtime
 * `import.meta.glob` does not exist as a real function — the syntax is a
 * compile-time marker; do NOT guard on `typeof === "function"` because that
 * check is false at runtime even in Vite-built output.
 *
 * On non-Vite runtimes (backend / Node tests) the call throws (`glob` is
 * undefined). We catch and fall back to an empty loader map; backend code
 * never resolves picker labels so this is harmless.
 */
type SidecarModule = { default?: LocaleCatalogMap } & Record<string, unknown>
type SidecarLoader = () => Promise<unknown>

let sidecarLoaders: Record<string, SidecarLoader> = {}
try {
  // Vite replaces this call with a static object literal at build time.
  sidecarLoaders = (import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, SidecarLoader>
  }).glob("./*.*.ts")
} catch {
  /* not in Vite (Node / tests) — leave empty */
}

async function loadLocaleCatalog(
  catalog: I18nCatalogId,
  locale: LocaleId,
): Promise<LocaleCatalogMap | null> {
  if (locale === "en") return null
  // Glob keys are like "./styling.fr.ts" (relative to this index.ts).
  const loader = sidecarLoaders[`./${catalog}.${locale}.ts`]
  if (!loader) return null
  try {
    const mod = (await loader()) as SidecarModule
    if (mod.default && typeof mod.default === "object") return mod.default
    // Fallback: convention-named export (e.g. STYLING_FR)
    const conventional = `${catalog.toUpperCase().replace(/-/g, "_")}_${locale.toUpperCase().replace(/-/g, "_")}`
    const named = mod[conventional]
    if (named && typeof named === "object") return named as LocaleCatalogMap
    return null
  } catch {
    return null
  }
}
