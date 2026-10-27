import type { ModelMakerId } from "@nodaro/shared/model-catalog"
import { supabase } from "./supabase.js"
import type { GalleryWordEntry } from "./gallery-word-filter.js"
import { MODEL_MAKER_LOGOS_KEY, parseModelMakerLogos } from "./maker-logo-settings.js"
import { NODARO_MOTION_MASKING_KEY, parseNodaroMotionMasking, type NodaroMotionMasking } from "./nodaro-motion-masking.js"
import { NODARO_MOTION_PROMPT_PARTS_KEY, parseNodaroMotionPromptParts, type NodaroMotionPromptParts } from "./nodaro-motion-prompt-parts.js"
import { NODARO_MOTION_MOTION_KEY, parseNodaroMotionMotion, type NodaroMotionMotion } from "./nodaro-motion-motion.js"
import {
  GALLERY_BANNED_EMAIL_PATTERNS_KEY,
  GALLERY_BANNED_USERS_KEY,
  GALLERY_BLOCKED_WORDS_KEY,
  parseGalleryBannedUsers,
  parseGalleryEmailPatterns,
  parseGalleryWordEntries,
  type GalleryBannedEmailPattern,
  type GalleryBannedUser,
} from "./gallery-moderation-settings.js"

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
  /** Which tier a NEW copilot thread starts on. Absent = the compiled default. */
  copilot_default_tier: string | null
  /** Admin overrides for per-tier caps (minutes + counts). Absent fields fall back to compiled defaults. */
  copilot_tier_caps: Record<string, unknown> | null
  /** Words an admin barred from the public gallery, with translations and exceptions. */
  gallery_blocked_words: GalleryWordEntry[]
  /** Creators whose work never reaches the public gallery. */
  gallery_banned_users: GalleryBannedUser[]
  /** Email patterns whose accounts are all blocked from the public gallery. */
  gallery_banned_email_patterns: GalleryBannedEmailPattern[]
  /**
   * The makers whose mark this deployment publishes (maker-logo-settings.ts).
   * A declaration only: `maker-logos.ts` serves an address once storage holds
   * the file too. Default (and on a read failure): none.
   */
  model_maker_logos: ModelMakerId[]
  /**
   * Nodaro Motion's face masking per engine (nodaro-motion-masking.ts), for
   * direct runs. null = never saved (no masking). Each engine's entry is
   * validated on its own; an invalid one is dropped.
   */
  nodaro_motion_masking: NodaroMotionMasking | null
  /**
   * Nodaro Motion's prompt part overrides per engine and style
   * (nodaro-motion-prompt-parts.ts), for direct runs. null = never saved (the
   * engine's defaults). Each engine's entry is validated on its own; an
   * invalid one is dropped.
   */
  nodaro_motion_prompt_parts: NodaroMotionPromptParts | null
  /**
   * Nodaro Motion's Motion setting per engine (nodaro-motion-motion.ts), for
   * direct runs with `style: "motion"`. null = never saved (the Precise
   * masking with the Flexible prompt). Each engine's entry is validated on
   * its own; an invalid one is dropped.
   */
  nodaro_motion_motion: NodaroMotionMotion | null
}

// Cache settings for 60 seconds to avoid hitting the DB on every job
let cachedSettings: AppSettings | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60_000

// Stampede protection: if a refresh is in-flight, share the promise
let inflight: Promise<AppSettings> | null = null

// The defaults handed out when the settings could not be read — so a reader
// that must not fall back to empty rules (the gallery's moderation) can tell.
const readFailures = new WeakSet<AppSettings>()

/** True for the stand-in defaults returned when the settings could not be read. */
export function settingsReadFailed(settings: AppSettings): boolean {
  return readFailures.has(settings)
}

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
    const fallback: AppSettings = { ai_provider: "replicate", cost_markup_percent: 0, service_margin_percent: {}, carousel_video_autoplay: true, apps_page_video_autoplay: true, featured_app_ids: [], featured_apps_limit: 20, apps_auto_scroll_seconds: 4, nodaro_provider_prefs: null, copilot_enabled: true, copilot_default_tier: null, copilot_tier_caps: null, gallery_blocked_words: [], gallery_banned_users: [], gallery_banned_email_patterns: [], model_maker_logos: [], nodaro_motion_masking: null, nodaro_motion_prompt_parts: null, nodaro_motion_motion: null }
    readFailures.add(fallback)
    return fallback
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
    copilot_default_tier: null,
    copilot_tier_caps: null,
    gallery_blocked_words: [],
    gallery_banned_users: [],
    gallery_banned_email_patterns: [],
    model_maker_logos: [],
    nodaro_motion_masking: null,
    nodaro_motion_prompt_parts: null,
    nodaro_motion_motion: null,
  }

  for (const row of data ?? []) {
    if (row.key === NODARO_MOTION_MASKING_KEY) {
      settings.nodaro_motion_masking = parseNodaroMotionMasking(row.value)
      continue
    }
    if (row.key === NODARO_MOTION_MOTION_KEY) {
      settings.nodaro_motion_motion = parseNodaroMotionMotion(row.value)
      continue
    }
    if (row.key === NODARO_MOTION_PROMPT_PARTS_KEY) {
      settings.nodaro_motion_prompt_parts = parseNodaroMotionPromptParts(row.value)
      continue
    }
    if (row.key === MODEL_MAKER_LOGOS_KEY) {
      settings.model_maker_logos = parseModelMakerLogos(row.value)
      continue
    }
    if (row.key === GALLERY_BLOCKED_WORDS_KEY) {
      settings.gallery_blocked_words = parseGalleryWordEntries(row.value)
      continue
    }
    if (row.key === GALLERY_BANNED_EMAIL_PATTERNS_KEY) {
      settings.gallery_banned_email_patterns = parseGalleryEmailPatterns(row.value)
      continue
    }
    if (row.key === GALLERY_BANNED_USERS_KEY) {
      settings.gallery_banned_users = parseGalleryBannedUsers(row.value)
      continue
    }
    if (row.key === "copilot_enabled" && typeof row.value === "boolean") {
      settings.copilot_enabled = row.value
      continue
    }
    if (row.key === "copilot_default_tier" && typeof row.value === "string") {
      settings.copilot_default_tier = row.value
      continue
    }
    if (row.key === "copilot_tier_caps" && row.value && typeof row.value === "object" && !Array.isArray(row.value)) {
      settings.copilot_tier_caps = row.value as Record<string, unknown>
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
