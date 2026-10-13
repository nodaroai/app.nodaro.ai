import { supabase } from "../../lib/supabase.js"

/**
 * The free-grant gate's runtime knobs — two `app_settings` rows, read with a
 * 60 s cache, the same shape as `welcome-offer-config.ts`:
 *
 *  - `signup_grant_domain_others_max` — how many OTHER accounts an
 *    organisation (Google `hd`, else the email domain) may already hold
 *    before a new one is withheld. 0 (the default) = one grant per
 *    organisation, ever.
 *  - `signup_grant_public_email_domains` — domains an admin adds to the
 *    compiled public-provider list (`billing/public-email-providers.ts`); a
 *    provider missed there otherwise withholds every second signup from a
 *    whole market until a deploy.
 *  - `signup_grant_cookie_rule` — the server-signed cookie decides (true) or
 *    is only recorded (false, the default): the shadow week before it counts.
 *
 * Absent rows are the defaults. A transient read error keeps the last good
 * answer and retries soon; a cold cache falls back to the defaults.
 */
export interface SignupGrantConfig {
  domainOthersMax: number
  publicEmailDomains: ReadonlySet<string>
  cookieRule: boolean
}

export const SIGNUP_GRANT_DOMAIN_OTHERS_MAX_KEY = "signup_grant_domain_others_max"
export const SIGNUP_GRANT_PUBLIC_DOMAINS_KEY = "signup_grant_public_email_domains"
export const SIGNUP_GRANT_COOKIE_RULE_KEY = "signup_grant_cookie_rule"

export const SIGNUP_GRANT_CONFIG_DEFAULTS: SignupGrantConfig = { domainOthersMax: 0, publicEmailDomains: new Set(), cookieRule: false }

const CACHE_TTL_MS = 60_000
const ERROR_RETRY_MS = 5_000
/** A setting is a knob, not a disable switch: past this it is read as the default. */
const DOMAIN_OTHERS_MAX_CEILING = 1_000
let cached: SignupGrantConfig | null = null
let cachedAt = 0
let inflight: Promise<SignupGrantConfig> | null = null

/** Only a non-negative integer counts; anything else (a string, a float, a huge number) is the default. */
export function parseDomainOthersMax(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= DOMAIN_OTHERS_MAX_CEILING
    ? value
    : SIGNUP_GRANT_CONFIG_DEFAULTS.domainOthersMax
}

/** Lower-cased, trimmed domains; anything that is not a plain domain is dropped. */
export function parsePublicEmailDomains(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value)) return new Set()
  const out = new Set<string>()
  for (const v of value) {
    if (typeof v !== "string") continue
    const d = v.trim().toLowerCase()
    if (/^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$/.test(d) && d.includes(".")) out.add(d)
  }
  return out
}

export async function getSignupGrantConfig(): Promise<SignupGrantConfig> {
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

type Read = { ok: true; config: SignupGrantConfig } | { ok: false }

async function readRows(): Promise<Read> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", [SIGNUP_GRANT_DOMAIN_OTHERS_MAX_KEY, SIGNUP_GRANT_PUBLIC_DOMAINS_KEY, SIGNUP_GRANT_COOKIE_RULE_KEY])
    if (error) return { ok: false }
    const config: SignupGrantConfig = { ...SIGNUP_GRANT_CONFIG_DEFAULTS }
    for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
      if (row.key === SIGNUP_GRANT_DOMAIN_OTHERS_MAX_KEY) config.domainOthersMax = parseDomainOthersMax(row.value)
      if (row.key === SIGNUP_GRANT_PUBLIC_DOMAINS_KEY) config.publicEmailDomains = parsePublicEmailDomains(row.value)
      if (row.key === SIGNUP_GRANT_COOKIE_RULE_KEY) config.cookieRule = row.value === true
    }
    return { ok: true, config }
  } catch {
    return { ok: false }
  }
}

async function refresh(): Promise<SignupGrantConfig> {
  const read = await readRows()
  if (read.ok) {
    cached = read.config
    cachedAt = Date.now()
    return cached
  }
  const fallback = cached ?? { ...SIGNUP_GRANT_CONFIG_DEFAULTS }
  cached = fallback
  cachedAt = Date.now() - CACHE_TTL_MS + ERROR_RETRY_MS
  return fallback
}

/** Tests and the admin write path: forget the cached rows. */
export function invalidateSignupGrantConfigCache(): void {
  cached = null
  cachedAt = 0
}
