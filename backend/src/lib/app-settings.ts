import { supabase } from "./supabase.js"

/**
 * How the nodaro.ai credential participates in routing (4b, founder
 * decisions 2026-08-18). Written by the post-connect choice dialog; absent
 * row = legacy behavior (scope "all", precedence "local") so existing
 * connected installs keep routing exactly as before until they choose.
 *
 * - scope "all": nodaro serves every capability it covers.
 *   precedence "nodaro"  -> nodaro FIRST — "ignore my other providers".
 *   precedence "local"   -> local keys first, nodaro fills the gaps
 *                           (the pre-4b OAuth semantics).
 * - scope "exclusives": nodaro serves ONLY the exclusive nodes; commodity
 *   capabilities behave as if the credential did not exist.
 */
export interface NodaroProviderPrefs {
  scope: "all" | "exclusives"
  precedence: "nodaro" | "local"
}

export interface AppSettings {
  ai_provider: "replicate" | "kie"
  cost_markup_percent: number
  /**
   * Per-service margin overrides: identifier-prefix -> percent. A matched
   * prefix REPLACES the global cost_markup_percent for that identifier
   * (see ee/billing/service-margin.ts). Data-driven on purpose — which
   * services carry their own margin lives only in the DB, never in code.
   */
  service_margin_percent: Record<string, number>
  carousel_video_autoplay: boolean
  apps_page_video_autoplay: boolean
  featured_app_ids: string[]
  featured_apps_limit: number
  apps_auto_scroll_seconds: number
  /** null = no explicit choice stored — callers apply the legacy default. */
  nodaro_provider_prefs: NodaroProviderPrefs | null
  /** Runtime pause for the Workflow Copilot (on top of the COPILOT_ENABLED env kill switch). Default true. */
  copilot_enabled: boolean
}

// Cache settings for 60 seconds to avoid hitting the DB on every job
let cachedSettings: AppSettings | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60_000

// Stampede protection: if a refresh is in-flight, share the promise
let inflight: Promise<AppSettings> | null = null

export async function getAppSettings(): Promise<AppSettings> {
  const now = Date.now()

  // Return cached settings if still valid
  if (cachedSettings && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedSettings
  }

  // If another call is already refreshing, await it
  if (inflight) return inflight

  inflight = refreshSettings()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

async function refreshSettings(): Promise<AppSettings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")

  if (error) {
    console.error("[getAppSettings] Error fetching settings:", error.message)
    // Return defaults on error
    return { ai_provider: "replicate", cost_markup_percent: 0, service_margin_percent: {}, carousel_video_autoplay: true, apps_page_video_autoplay: true, featured_app_ids: [], featured_apps_limit: 20, apps_auto_scroll_seconds: 4, nodaro_provider_prefs: null, copilot_enabled: true }
  }

  const settings: AppSettings = {
    ai_provider: "replicate",
    cost_markup_percent: 0,
    service_margin_percent: {},
    carousel_video_autoplay: true,
    apps_page_video_autoplay: true,
    featured_app_ids: [],
    featured_apps_limit: 20,
    apps_auto_scroll_seconds: 4,
    nodaro_provider_prefs: null,
    copilot_enabled: true,
  }

  for (const row of data ?? []) {
    if (row.key === "copilot_enabled" && typeof row.value === "boolean") {
      settings.copilot_enabled = row.value
      continue
    }
    if (row.key === "ai_provider" && typeof row.value === "string") {
      settings.ai_provider = row.value as "replicate" | "kie"
    } else if (row.key === "cost_markup_percent" && typeof row.value === "number") {
      settings.cost_markup_percent = row.value
    } else if (row.key === "service_margin_percent" && row.value && typeof row.value === "object" && !Array.isArray(row.value)) {
      const margins: Record<string, number> = {}
      for (const [prefix, pct] of Object.entries(row.value as Record<string, unknown>)) {
        if (prefix.length > 0 && typeof pct === "number" && Number.isFinite(pct) && pct >= 0 && pct <= 500) {
          margins[prefix] = pct
        }
      }
      settings.service_margin_percent = margins
    } else if (row.key === "carousel_video_autoplay" && typeof row.value === "boolean") {
      settings.carousel_video_autoplay = row.value
    } else if (row.key === "apps_page_video_autoplay" && typeof row.value === "boolean") {
      settings.apps_page_video_autoplay = row.value
    } else if (row.key === "featured_app_ids" && Array.isArray(row.value)) {
      settings.featured_app_ids = row.value as string[]
    } else if (row.key === "featured_apps_limit" && typeof row.value === "number") {
      settings.featured_apps_limit = row.value
    } else if (row.key === "apps_auto_scroll_seconds" && typeof row.value === "number") {
      settings.apps_auto_scroll_seconds = row.value
    } else if (row.key === "nodaro_provider_prefs" && row.value && typeof row.value === "object" && !Array.isArray(row.value)) {
      const v = row.value as { scope?: unknown; precedence?: unknown }
      if (
        (v.scope === "all" || v.scope === "exclusives") &&
        (v.precedence === "nodaro" || v.precedence === "local")
      ) {
        settings.nodaro_provider_prefs = { scope: v.scope, precedence: v.precedence }
      }
    }
  }

  // Update cache
  cachedSettings = settings
  cacheTimestamp = Date.now()

  return settings
}

/**
 * Calculate display cost with markup applied
 * @param providerCost - The raw cost from the API response
 * @param markupPercent - The markup percentage (e.g., 20 for a 20% markup; default 0)
 * @returns The display cost with markup applied
 */
export function calculateDisplayCost(providerCost: number, markupPercent: number): number {
  return providerCost * (1 + markupPercent / 100)
}

/**
 * Invalidate the settings cache (call after updating settings)
 */
export function invalidateSettingsCache(): void {
  cachedSettings = null
  cacheTimestamp = 0
}

/**
 * Persist the nodaro.ai routing prefs (4b). Lives here — not in the route —
 * because app_settings is instance-global config that genuinely requires the
 * service-role client, and lib/ is the sanctioned home for those writes
 * (routes are tenant-scope linted). Invalidates this process's settings
 * cache; the worker converges on its own ≤60s cache expiry.
 */
export async function saveNodaroProviderPrefs(prefs: NodaroProviderPrefs): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: "nodaro_provider_prefs", value: prefs }, { onConflict: "key" })
  if (error) throw new Error(error.message)
  invalidateSettingsCache()
}
