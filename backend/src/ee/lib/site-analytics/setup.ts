/**
 * What Site Analytics needs to read Google: a service account (the key file
 * Google hands out), the GA4 property it reads traffic from, and the Search
 * Console site it reads search data from. Read from three environment
 * variables, parsed on first use and never at import, so a value that cannot
 * be right shows as a problem on the admin page instead of stopping the
 * server.
 */

export interface ServiceAccount {
  readonly clientEmail: string
  readonly privateKey: string
}

export type ServiceAccountParse =
  | { readonly ok: true; readonly account: ServiceAccount }
  | { readonly ok: false; readonly problem: string }

export interface SiteAnalyticsEnv {
  readonly serviceAccountJson: string
  readonly ga4PropertyId: string
  readonly searchConsoleSite: string
}

export interface SiteAnalyticsSetup {
  readonly account: ServiceAccount | null
  readonly ga4PropertyId: string | null
  readonly searchConsoleSite: string | null
  /** One sentence per variable that is missing or cannot be right, naming it. */
  readonly problems: readonly string[]
}

const KEY_FILE_PROBLEM =
  "SITE_ANALYTICS_SERVICE_ACCOUNT_JSON is not a service account key file. Paste the JSON Google downloads for the key (or its base64)."
const RSA_KEY_PROBLEM =
  "SITE_ANALYTICS_SERVICE_ACCOUNT_JSON holds a key in the older RSA format. Create a new JSON key for the service account in Google Cloud and paste that file unchanged."
const PKCS8_HEADER = "-----BEGIN PRIVATE KEY-----"
const PKCS8_FOOTER = "-----END PRIVATE KEY-----"

function keyFileText(raw: string): string | null {
  if (raw.startsWith("{")) return raw
  const decoded = Buffer.from(raw, "base64").toString("utf8").trim()
  return decoded.startsWith("{") ? decoded : null
}

/** The key file as pasted, or its base64 — a one-line variable often holds it that way. */
export function parseServiceAccount(raw: string): ServiceAccountParse {
  const text = keyFileText(raw.trim())
  if (!text) return { ok: false, problem: KEY_FILE_PROBLEM }
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    return { ok: false, problem: KEY_FILE_PROBLEM }
  }
  const { client_email: email, private_key: key } = (file ?? {}) as { client_email?: unknown; private_key?: unknown }
  if (typeof email !== "string" || !email.includes("@") || typeof key !== "string") return { ok: false, problem: KEY_FILE_PROBLEM }
  if (key.includes("BEGIN RSA PRIVATE KEY")) return { ok: false, problem: RSA_KEY_PROBLEM }
  // Google's key files hold a PKCS#8 key; anything else would only fail later, when signing.
  if (!key.includes(PKCS8_HEADER) || !key.includes(PKCS8_FOOTER)) return { ok: false, problem: KEY_FILE_PROBLEM }
  // A key whose newlines arrived escaped ("\\n" after parsing) would not import.
  const privateKey = key.includes("\n") ? key : key.replace(/\\n/g, "\n")
  return { ok: true, account: { clientEmail: email.trim(), privateKey } }
}

/** "537345785" or "properties/537345785" — not the "G-…" measurement id, which is a different thing. */
function propertyIdOf(raw: string): string | null {
  const match = /^(?:properties\/)?(\d+)$/.exec(raw.trim())
  return match ? (match[1] ?? null) : null
}

/**
 * A domain property ("sc-domain:nodaro.ai") or a URL-prefix one
 * ("https://nodaro.ai/"), as Search Console names it. A prefix always ends in
 * "/", so "https://example.com/blog/" never covers "/blogger".
 */
function searchConsoleSiteOf(raw: string): string | null {
  const value = raw.trim()
  const domain = /^sc-domain:([a-z0-9.-]+)$/i.exec(value)
  if (domain) return `sc-domain:${(domain[1] ?? "").toLowerCase()}`
  // A query or fragment — even a bare "?" or "#", which URL parsing drops — is never part of a site.
  if (!/^https?:\/\//i.test(value) || /[?#]/.test(value)) return null
  try {
    const url = new URL(value)
    if (url.username || url.password) return null
    return url.href.endsWith("/") ? url.href : `${url.href}/`
  } catch {
    return null
  }
}

/** A variable's value, or why there is none: unset, or set to something that cannot be right. */
type Read<T> = { readonly value: T | null; readonly problem: string | null }
type Parsed<T> = { readonly value: T } | { readonly problem: string }

function readVariable<T>(name: string, raw: string, parse: (raw: string) => Parsed<T>): Read<T> {
  if (!raw.trim()) return { value: null, problem: `${name} is not set.` }
  const parsed = parse(raw)
  return "value" in parsed ? { value: parsed.value, problem: null } : { value: null, problem: parsed.problem }
}

/** A parser that says only yes or no, with the one sentence for no. */
const orProblem =
  <T>(parse: (raw: string) => T | null, problem: string) =>
  (raw: string): Parsed<T> => {
    const value = parse(raw)
    return value === null ? { problem } : { value }
  }

export function resolveSetup(env: SiteAnalyticsEnv): SiteAnalyticsSetup {
  // The key file's own reason (an RSA key, a missing email…) is the one the admin reads.
  const account = readVariable<ServiceAccount>("SITE_ANALYTICS_SERVICE_ACCOUNT_JSON", env.serviceAccountJson, (raw) => {
    const parsed = parseServiceAccount(raw)
    return parsed.ok ? { value: parsed.account } : { problem: parsed.problem }
  })
  const property = readVariable(
    "SITE_ANALYTICS_GA4_PROPERTY_ID",
    env.ga4PropertyId,
    orProblem(propertyIdOf, "SITE_ANALYTICS_GA4_PROPERTY_ID must be the property number (e.g. 537345785), not the G-… measurement id."),
  )
  const site = readVariable(
    "SITE_ANALYTICS_SEARCH_CONSOLE_SITE",
    env.searchConsoleSite,
    orProblem(searchConsoleSiteOf, "SITE_ANALYTICS_SEARCH_CONSOLE_SITE must be sc-domain:<domain> or a https:// address, as Search Console names the site."),
  )
  return {
    account: account.value,
    ga4PropertyId: property.value,
    searchConsoleSite: site.value,
    problems: [account.problem, property.problem, site.problem].filter((p): p is string => p !== null),
  }
}
