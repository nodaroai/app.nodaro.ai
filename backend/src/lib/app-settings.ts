import { supabase } from "./supabase.js"

export interface AppSettings {
  ai_provider: "replicate" | "kie"
  cost_markup_percent: number
}

// Cache settings for 60 seconds to avoid hitting the DB on every job
let cachedSettings: AppSettings | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60_000

export async function getAppSettings(): Promise<AppSettings> {
  const now = Date.now()

  // Return cached settings if still valid
  if (cachedSettings && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedSettings
  }

  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")

  if (error) {
    console.error("[getAppSettings] Error fetching settings:", error.message)
    // Return defaults on error
    return { ai_provider: "replicate", ***REDACTED-OSS-SCRUB*** }
  }

  const settings: AppSettings = {
    ai_provider: "replicate",
    ***REDACTED-OSS-SCRUB***
  }

  for (const row of data ?? []) {
    if (row.key === "ai_provider" && typeof row.value === "string") {
      settings.ai_provider = row.value as "replicate" | "kie"
    } else if (row.key === "cost_markup_percent" && typeof row.value === "number") {
      settings.cost_markup_percent = row.value
    }
  }

  // Update cache
  cachedSettings = settings
  cacheTimestamp = now

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
