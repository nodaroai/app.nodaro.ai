import { useQuery, type QueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase"
import { queryKeys } from "@/lib/query-keys"

/**
 * The registry of client apps built on the Nodaro SDK (`client_apps`).
 *
 * `workflowsListed` answers ONE question: are this app's workflows first-class
 * objects the user can open here (studio), or private app storage that would be
 * junk in their workflow list (voice-changer-pro)? It is a property of the APP,
 * not of the row — flipping an app's mind is one UPDATE, not a rewrite of a
 * million workflows.
 *
 * CORE, not ee/: the workflow list needs it on every load. The ee admin screen
 * imports from here (core -> ee imports are forbidden; ee -> core is fine).
 */
export interface ClientApp {
  readonly slug: string
  readonly name: string
  readonly workflowsListed: boolean
}

interface DbClientAppRow {
  readonly slug: string
  readonly name: string
  readonly workflows_listed: boolean
}

/**
 * Studio's slug. The one app with a dedicated dashboard tab, so it is the one
 * slug core code names directly; every other app is handled generically through
 * the registry.
 */
export const STUDIO_APP_SLUG = "studio"

/** Slugs are app identifiers we mint ourselves: lowercase, digits, hyphens. */
const SAFE_SLUG = /^[a-z0-9-]+$/

async function fetchClientApps(): Promise<ClientApp[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("client_apps")
    .select("slug, name, workflows_listed")
    .order("slug", { ascending: true })

  if (error) throw error
  return ((data ?? []) as DbClientAppRow[]).map((row) => ({
    slug: row.slug,
    name: row.name,
    workflowsListed: row.workflows_listed === true,
  }))
}

/**
 * Shared query options. The registry is tiny and changes almost never (an admin
 * toggling one flag), so it is cached hard — a workflow-list render must not pay
 * for a second round-trip. The admin screen invalidates `clientApps.list()`
 * after a toggle, which is the only thing that moves it.
 */
export const clientAppsQueryOptions = {
  queryKey: queryKeys.clientApps.list(),
  queryFn: fetchClientApps,
  staleTime: Infinity,
  gcTime: Infinity,
} as const

/** Read the registry. Powers the ee admin screen. */
export function useClientApps() {
  return useQuery(clientAppsQueryOptions)
}

/**
 * The listed-app slug set, fetched through the react-query cache (deduped and
 * shared with any live `useClientApps()`).
 *
 * FAILS CLOSED. If the registry is unreachable we return NO listed slugs, which
 * degrades the visibility rule to "native only". The failure modes are
 * asymmetric: junk in everyone's workflow list is the bug we are fixing, whereas
 * an app whose workflows are wrongly invisible is noticed immediately by its own
 * developer. Never invert this — do not "fail open" to show everything.
 */
export async function fetchListedAppSlugs(queryClient: QueryClient): Promise<string[]> {
  try {
    const apps = await queryClient.fetchQuery(clientAppsQueryOptions)
    return apps
      .filter((app) => app.workflowsListed)
      .map((app) => app.slug)
      .filter((slug) => SAFE_SLUG.test(slug))
  } catch {
    // Registry unreachable (network, or a pre-migration DB with no client_apps
    // table) → nothing is listed → native-only. Safe in both directions: no junk
    // appears, and the user's own native workflows still render.
    return []
  }
}

/**
 * THE VISIBILITY RULE — the single place it is expressed.
 *
 * A workflow appears in app.nodaro.ai's workflow list iff:
 *   app_slug IS NULL          (native — created in app.nodaro.ai itself)
 *   OR its app is registered with workflows_listed = true.
 *
 * An unknown / unregistered / misconfigured `app_slug` is therefore HIDDEN.
 * That is deliberate and must not be inverted.
 *
 * Returns a PostgREST `or=` filter string. With an empty listed set we emit the
 * bare `app_slug.is.null` — an `in.()` with no values is a PostgREST syntax
 * error, not an empty match.
 */
export function workflowVisibilityFilter(listedSlugs: readonly string[]): string {
  const safe = listedSlugs.filter((slug) => SAFE_SLUG.test(slug))
  if (safe.length === 0) return "app_slug.is.null"
  return `app_slug.is.null,app_slug.in.(${safe.join(",")})`
}

/**
 * `projects.app_slug` carries the same semantics as `workflows.app_slug`, so the
 * SAME visibility rule hides a client app's dedicated project (voice-changer-pro's
 * "Voice Changer Pro" project) from the dashboard's project list. Aliased rather
 * than duplicated so the rule lives in exactly one place.
 */
export const projectVisibilityFilter = workflowVisibilityFilter

/**
 * localStorage key for the admin-only "show client-app content in my lists"
 * override. When set, the dashboard's project + workflow list fetchers skip the
 * visibility filter so an admin can SEE the otherwise-hidden client-app rows
 * (voice-changer-pro conversions and its project). Off by default — the whole
 * point is that these are hidden for everyone, admins included.
 */
export const SHOW_CLIENT_APPS_STORAGE_KEY = "nodaro:admin:show-client-apps"

/** Read the admin override flag. SSR-safe and never throws (private-mode etc.). */
export function readShowClientAppsFlag(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(SHOW_CLIENT_APPS_STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

/** Persist the admin override flag. SSR-safe and never throws. */
export function writeShowClientAppsFlag(value: boolean): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(SHOW_CLIENT_APPS_STORAGE_KEY, value ? "true" : "false")
  } catch {
    // best-effort; a blocked localStorage just means the toggle doesn't persist
  }
}

/**
 * True when a PostgREST error means `projects.app_slug` does not exist yet — a DB
 * that has not applied migration 256. Lets the project-list fetchers degrade to
 * an unfiltered query (list still renders) if the frontend deploys ahead of the
 * migration, mirroring how useMyWorkflows tolerates a missing `is_default`.
 * Codes: 42703 (undefined_column) / PGRST204 (schema-cache miss).
 */
export function isAppSlugColumnMissing(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null
  if (!e) return false
  if (e.code === "42703" || e.code === "PGRST204") return true
  return typeof e.message === "string" && e.message.includes("app_slug")
}
