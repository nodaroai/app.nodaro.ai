import { supabase } from "../../lib/supabase.js"

/**
 * Admin-tunable knobs for the marketing-consent prompt. Stored as individual
 * `consent_*` rows in `app_settings` (same table + admin route the rest of the
 * instance config uses) and read here with a 60s cache — NOT baked into the
 * core AppSettings object, because the whole feature is Cloud-only ee/ code.
 *
 * `enabled` defaults FALSE on purpose. Staging shares the production database,
 * so a dev deploy runs ahead of migration 371 landing on main; until an admin
 * turns this on (after the table exists) the prompt stays dormant and every
 * read degrades to "don't show". That is the migrate-then-enable safety window.
 */
export interface ConsentConfig {
  /** Master on/off. False = the prompt never shows, anywhere. */
  enabled: boolean
  /** Hours between asks for a user who has never answered. */
  cadenceHours: number
  /** Lifetime cap on total prompt shows per user, across every state. */
  maxAsks: number
  /** Hours between asks for a user who granted then opted out in settings. */
  withdrawnCadenceHours: number
  /** What counts as a "login" for cadence purposes — informational today; the
   *  cadence is time-based until a login-count source exists. */
  loginDefinition: "session" | "app_open"
  /** The consent copy shown in the prompt. */
  text: string
  /** Bumped when the copy changes materially; stored on each grant. */
  version: number
}

export const CONSENT_CONFIG_DEFAULTS: ConsentConfig = {
  enabled: false,
  cadenceHours: 24,
  maxAsks: 5,
  withdrawnCadenceHours: 720, // 30 days — the time-based stand-in for "re-ask occasionally"
  loginDefinition: "session",
  text: "We'll email you when we ship something worth knowing about. A few times a month, no more.",
  version: 1,
}

const CACHE_TTL_MS = 60_000
let cached: ConsentConfig | null = null
let cachedAt = 0
let inflight: Promise<ConsentConfig> | null = null

const KEYS = [
  "consent_enabled",
  "consent_cadence_hours",
  "consent_max_asks",
  "consent_withdrawn_cadence_hours",
  "consent_login_definition",
  "consent_text",
  "consent_version",
] as const

export async function getConsentConfig(): Promise<ConsentConfig> {
  const now = Date.now()
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached
  if (inflight) return inflight
  inflight = refresh()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

async function refresh(): Promise<ConsentConfig> {
  const cfg: ConsentConfig = { ...CONSENT_CONFIG_DEFAULTS }

  // A missing table / any read error leaves `enabled: false` — dormant, never a
  // 500 on the read the client polls every load.
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", KEYS as unknown as string[])

  if (error) {
    cached = cfg
    cachedAt = Date.now()
    return cfg
  }

  for (const row of data ?? []) {
    const v = row.value
    switch (row.key) {
      case "consent_enabled":
        if (typeof v === "boolean") cfg.enabled = v
        break
      case "consent_cadence_hours":
        if (typeof v === "number" && Number.isFinite(v) && v > 0) cfg.cadenceHours = v
        break
      case "consent_max_asks":
        if (typeof v === "number" && Number.isInteger(v) && v >= 1) cfg.maxAsks = v
        break
      case "consent_withdrawn_cadence_hours":
        if (typeof v === "number" && Number.isFinite(v) && v > 0) cfg.withdrawnCadenceHours = v
        break
      case "consent_login_definition":
        if (v === "session" || v === "app_open") cfg.loginDefinition = v
        break
      case "consent_text":
        if (typeof v === "string" && v.trim().length > 0) cfg.text = v
        break
      case "consent_version":
        if (typeof v === "number" && Number.isInteger(v) && v >= 1) cfg.version = v
        break
    }
  }

  cached = cfg
  cachedAt = Date.now()
  return cfg
}

/** Call after an admin writes a consent_* setting so the change takes effect
 *  immediately instead of on the ≤60s cache expiry. */
export function invalidateConsentConfigCache(): void {
  cached = null
  cachedAt = 0
}
