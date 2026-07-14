import { supabase } from "./supabase.js"

/**
 * Server-side origin stamping for the client-apps registry (see migration 253 /
 * 256 and `client_apps`).
 *
 * A workflow or project created by a client app (voice-changer-pro, studio, …)
 * must be stamped with that app's `app_slug` so the dashboard's list fetchers
 * can hide an app whose `workflows_listed = false`. Clients don't send the slug
 * on every write, but they DO write their private state under a known top-level
 * `settings` key — vcp writes `settings.vcp`, studio writes `settings.studio`.
 * The `client_apps.settings_key` column maps that key back to the slug, so this
 * inference is data-driven: registering a new app (with its settings_key) is
 * enough, no code change.
 *
 * This is the root fix: it works for every client with no client deploy, because
 * it keys off the settings payload clients already send.
 *
 * The SAME cached registry also answers the admin `viewAll` filter's question
 * ("which apps are listed?") via `getListedAppSlugs` — one round-trip, two uses.
 */

interface RegistryEntry {
  /** Top-level `settings` key this app writes (null = no marker). */
  readonly settingsKey: string | null
  readonly slug: string
  /** Whether this app's workflows are listed in app.nodaro.ai's own lists. */
  readonly workflowsListed: boolean
}

/** Slugs are app identifiers we mint ourselves: lowercase, digits, hyphens. */
const SAFE_SLUG = /^[a-z0-9-]+$/

/**
 * In-process cache of the client-apps registry. It is a handful of rows that
 * changes only when an admin registers an app or flips its listed flag, so a
 * short TTL keeps every workflow write (and every admin viewAll) from paying for
 * a registry round-trip while staying fresh enough that a change takes effect
 * within a minute.
 */
const CACHE_TTL_MS = 60_000
let cache: RegistryEntry[] | null = null
let cachedAt = 0

async function loadRegistry(): Promise<RegistryEntry[]> {
  const now = Date.now()
  if (cache && now - cachedAt < CACHE_TTL_MS) return cache

  // Fail SAFE to "empty registry" on any problem — a blip must never break a
  // workflow/project write, and it must never LEAK a client app's rows. Both
  // uses degrade in their own safe direction from an empty registry: stamping
  // simply infers nothing (the row stays native, the pre-existing behaviour;
  // the next write or the migration backfill reclassifies it), and the viewAll
  // filter falls back to native-only (hides every client-app row rather than
  // showing them). We leave `cachedAt` stale on failure so the next call retries.
  try {
    const { data, error } = await supabase
      .from("client_apps")
      .select("slug, settings_key, workflows_listed")

    if (error || !Array.isArray(data)) return cache ?? []

    cache = data
      .filter((row): row is { slug: string; settings_key: string | null; workflows_listed: boolean | null } =>
        typeof row?.slug === "string",
      )
      .map((row) => ({
        slug: row.slug,
        settingsKey:
          typeof row.settings_key === "string" && row.settings_key.length > 0
            ? row.settings_key
            : null,
        workflowsListed: row.workflows_listed === true,
      }))
    cachedAt = now
    return cache
  } catch {
    return cache ?? []
  }
}

/**
 * Infer the client-app slug that owns an incoming `settings` object, or null if
 * none is registered. Returns the slug of the FIRST registered `settings_key`
 * present as a top-level key. Pure lookup against the cached registry — no write.
 */
export async function inferAppSlugFromSettings(settings: unknown): Promise<string | null> {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null
  const registry = await loadRegistry()
  const obj = settings as Record<string, unknown>
  for (const { settingsKey, slug } of registry) {
    if (settingsKey && Object.prototype.hasOwnProperty.call(obj, settingsKey)) return slug
  }
  return null
}

/**
 * The slugs of apps whose workflows are LISTED (`workflows_listed = true`) — the
 * apps whose rows stay visible in app.nodaro.ai's own lists. Powers the admin
 * `viewAll` default exclusion: `app_slug IS NULL OR app_slug IN (listed)`.
 *
 * Reads the same cached registry as `inferAppSlugFromSettings`, so the admin
 * "all users" list pays no extra round-trip. Fails safe: an unreachable registry
 * yields `[]`, which degrades the filter to native-only (hides client-app rows).
 */
export async function getListedAppSlugs(): Promise<string[]> {
  const registry = await loadRegistry()
  return registry
    .filter((entry) => entry.workflowsListed && SAFE_SLUG.test(entry.slug))
    .map((entry) => entry.slug)
}

/**
 * PostgREST `.or()` filter string for "native OR a listed client app":
 *   app_slug.is.null                 (native — created in app.nodaro.ai itself)
 *   OR app_slug.in.(listed slugs)
 *
 * The exact backend mirror of the frontend `workflowVisibilityFilter`. An empty
 * listed set emits the bare `app_slug.is.null` — an `in.()` with no values is a
 * PostgREST syntax error, not an empty match. An unknown / unregistered slug is
 * therefore HIDDEN; that is deliberate and must not be inverted.
 */
export function clientAppVisibilityFilter(listedSlugs: readonly string[]): string {
  const safe = listedSlugs.filter((slug) => SAFE_SLUG.test(slug))
  if (safe.length === 0) return "app_slug.is.null"
  return `app_slug.is.null,app_slug.in.(${safe.join(",")})`
}

/** Test-only: drop the in-process registry cache so a test can seed a fresh map. */
export function _resetClientAppStampCacheForTests(): void {
  cache = null
  cachedAt = 0
}
