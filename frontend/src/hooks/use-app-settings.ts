"use client"

import { useCallback, useEffect, useState } from "react"
import { isCommunity } from "@/lib/edition"

export interface AppSettings {
  readonly ai_provider: "replicate" | "kie"
  readonly cost_markup_percent: number
}

const DEFAULT_SETTINGS: AppSettings = {
  ai_provider: "replicate",
  ***REDACTED-OSS-SCRUB***
}

// Global cache to avoid refetching
let cachedSettings: AppSettings | null = null
let fetchPromise: Promise<AppSettings> | null = null

async function fetchAppSettings(): Promise<AppSettings> {
  // Community edition always uses replicate
  if (isCommunity()) {
    return DEFAULT_SETTINGS
  }

  try {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
    const response = await fetch(`${API_BASE_URL}/v1/admin/settings`)
    if (!response.ok) {
      console.warn("[useAppSettings] Failed to fetch settings, using defaults")
      return DEFAULT_SETTINGS
    }
    const data = await response.json()
    const settings = data.settings as Record<string, unknown>
    return {
      ai_provider: (settings.ai_provider as "replicate" | "kie") ?? "replicate",
      cost_markup_percent: (settings.cost_markup_percent as number) ?? 25,
    }
  } catch (err) {
    console.warn("[useAppSettings] Error fetching settings:", err)
    return DEFAULT_SETTINGS
  }
}

/**
 * Hook to get app settings (ai_provider, cost_markup_percent)
 * Caches the result globally to avoid refetching
 */
export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(cachedSettings ?? DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(!cachedSettings)

  useEffect(() => {
    if (cachedSettings) {
      setSettings(cachedSettings)
      setLoading(false)
      return
    }

    // Use shared promise to avoid multiple fetches
    if (!fetchPromise) {
      fetchPromise = fetchAppSettings()
    }

    fetchPromise.then((result) => {
      cachedSettings = result
      setSettings(result)
      setLoading(false)
    })
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    fetchPromise = fetchAppSettings()
    const result = await fetchPromise
    cachedSettings = result
    setSettings(result)
    setLoading(false)
    return result
  }, [])

  return { settings, loading, refresh }
}

/**
 * Check if KIE.ai is the active provider
 */
export function useIsKieProvider(): boolean {
  const { settings } = useAppSettings()
  return settings.ai_provider === "kie"
}
