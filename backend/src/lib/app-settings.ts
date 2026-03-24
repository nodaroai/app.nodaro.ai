import { supabase } from "./supabase.js"

export interface AppSettings {
  ai_provider: "replicate" | "kie"
  cost_markup_percent: number
  apps_video_autoplay: boolean
  featured_app_ids: string[]
  featured_apps_limit: number
  apps_auto_scroll_seconds: number
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
    return { ai_provider: "replicate", ***REDACTED-OSS-SCRUB*** apps_video_autoplay: true, featured_app_ids: [], featured_apps_limit: 20, apps_auto_scroll_seconds: 4 }
  }

  const settings: AppSettings = {
    ai_provider: "replicate",
    ***REDACTED-OSS-SCRUB***
    apps_video_autoplay: true,
    featured_app_ids: [],
    featured_apps_limit: 20,
    apps_auto_scroll_seconds: 4,
  }

  for (const row of data ?? []) {
    if (row.key === "ai_provider" && typeof row.value === "string") {
      settings.ai_provider = row.value as "replicate" | "kie"
    } else if (row.key === "cost_markup_percent" && typeof row.value === "number") {
      settings.cost_markup_percent = row.value
    } else if (row.key === "apps_video_autoplay" && typeof row.value === "boolean") {
      settings.apps_video_autoplay = row.value
    } else if (row.key === "featured_app_ids" && Array.isArray(row.value)) {
      settings.featured_app_ids = row.value as string[]
    } else if (row.key === "featured_apps_limit" && typeof row.value === "number") {
      settings.featured_apps_limit = row.value
    } else if (row.key === "apps_auto_scroll_seconds" && typeof row.value === "number") {
      settings.apps_auto_scroll_seconds = row.value
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
 ***REDACTED-OSS-SCRUB***
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
