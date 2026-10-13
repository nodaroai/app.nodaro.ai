import type { FastifyBaseLogger } from "fastify"
import { supabase } from "../../lib/supabase.js"
import { isMissingColumnError } from "../../lib/postgrest-errors.js"
import { isPublicEmailDomain } from "./public-email-providers.js"
import { getSignupGrantConfig } from "../lib/signup-grant-config.js"

/**
 * Free-credit abuse gate, PR 2: the decision.
 *
 * `decideSignupGrant` is pure — every input is a number or a list the caller
 * already read — so the rules are unit-testable without a database.
 * `evaluateSignupGrant` does the reads and FAILS OPEN on every one of them: a
 * provider list we could not fetch is `null`, a count we could not run is 0,
 * and both of those grant. A false negative costs one grant; a false positive
 * costs a customer who will never write in about it.
 *
 * THE PROVIDER GATE IS THE CLOSE. The platform's users sign in with Google,
 * and Google itself limits how many identities one person can mint. An
 * email/password account is minted with a curl loop. So the grant belongs to
 * accounts whose GoTrue-stamped provider set includes something other than
 * `email` — read from `app_metadata`, which only the service role can write,
 * never from `user_metadata`, which any client can. The device and network
 * rules below cover the residual: several real Google accounts, one machine.
 *
 * WHY THE DEVICE KEY IS NOT A HARD MATCH ON ITS OWN. It is hashed from
 * hardware-only attributes (GPU string, cores, memory, screen, platform,
 * timezone), which is what lets it survive a browser switch — and also what
 * makes two identical laptops in one timezone collide. The same key from the
 * same network is treated as the same machine; from different networks it
 * takes a cluster of them to fire.
 *
 * A BUSY NETWORK IS EVIDENCE TOO — ONLY A REAL ONE. One old neighbour on the
 * network says nothing (an office, a dorm, a carrier). A network that already
 * carries a crowd of accounts is the one thing a farm cannot vary when it
 * spreads its signups over days and hands each a fresh machine profile, so
 * past `ipEverOthersMax` the grant waits. Every network count reads rows
 * marked `ip_scheme = 'client'` (458) only: rows from before the backend read
 * real addresses (#1827) hold a hosting proxy's hash shared by every user, and
 * an unknown address hashes to a constant — neither is a network.
 *
 * A PURCHASE OUTRANKS THE SIGNALS. Every rule above is a proxy for one
 * question — is this a person we have not seen, or a farmed account — and
 * money moved from a real payment method answers it directly. An account with
 * a settled purchase on record (`transactions`, written only by the Stripe
 * webhook after settlement) is granted whatever the signals say. This is the
 * ONE read here that does not fail open: a count we could not make is 0, and
 * 0 leaves the rules to decide. The other order — a purchase AFTER a withhold
 * — is the webhook's job (`activateSignupGrantOnPurchase`, signup-grant.ts).
 */

export const SIGNUP_GRANT_RULES = {
  /** Any other account from this exact browser profile withholds. */
  browserKeyOthersMax: 0,
  /** Any other account from this hardware signature on this network withholds. */
  deviceKeySameIpOthersMax: 0,
  /** More than this many other accounts on the hardware signature, from anywhere. */
  deviceKeyOthersMax: 2,
  /**
   * More than this many other claims from the SAME ADDRESS inside the
   * lookback. 0 (2026-10-12, was 3): the second account from one address in a
   * rolling day gets nothing — the wave opened exactly four per address per
   * day, one under the old line.
   */
  ipClaimsLookbackMax: 0,
  ipLookbackMs: 24 * 60 * 60 * 1000,
  /**
   * More than this many other claims from the same NEIGHBOURHOOD (an IPv4
   * /24, an IPv6 /48 — `neighbourhoodKey`) inside the hour. 0: a second
   * account from the street within the hour gets nothing. An hour, not a day:
   * a carrier or a campus puts many real people on one /24, and only the
   * burst is the farm's shape.
   */
  netClaimsLookbackMax: 0,
  netLookbackMs: 60 * 60 * 1000,
  /** A claim with no browser or device key: any other account ever seen on this network withholds. */
  keylessIpOthersMax: 0,
  /** A keyed claim: more than this many other accounts EVER seen on the network withholds — a farm's one constant. */
  ipEverOthersMax: 4,
  /** Another account named like this one (the same name with other digits, same domain) withholds. */
  similarEmailOthersMax: 0,
  /**
   * The fewest letters OR digits an email name must keep once its trailing
   * digits are cut, to be compared at all. Counted over both: a name like
   * `yy516726652_27` cuts to `yy516726652_`, which has two letters and eleven
   * characters of identity — counting letters alone never compared that series
   * (2026-10-12: five accounts, one domain, hours apart, every one granted).
   */
  similarEmailMinStem: 5,
  /** Only accounts made this recently count as "named like this one": a series is made in days, a namesake any time. */
  similarEmailLookbackMs: 30 * 24 * 60 * 60 * 1000,
  /**
   * ONE GRANT PER ORGANISATION. More than this many other accounts EVER seen
   * from the same organisation — Google's signed `hd` claim, else the email's
   * domain; never a public mail provider — withholds. 0 = the second account
   * from a company domain gets nothing; a colleague who wants to try the
   * product uses a personal address, and the company pays.
   *
   * TEMPORARY, against the 2026-10 wave: the gate's close used to be "Google
   * limits how many identities one person can mint", and a Google Workspace
   * on a throwaway domain mints them without limit — 46 of the wave's 51
   * accounts were Workspace users on seven such domains, and in two months of
   * signups no external customer had two accounts on one domain. The number is
   * overridable at runtime (`signup_grant_domain_others_max`, lib/signup-grant-config.ts)
   * so it can be loosened without a deploy when a real organisation needs more.
   */
  domainOthersMax: 0,
} as const

export type GrantReason =
  | "email_only_provider"
  | "browser_match"
  | "device_ip_match"
  | "device_cluster"
  | "ip_velocity"
  | "net_velocity"
  | "hosting_network"
  | "keyless"
  | "keyless_ip_reuse"
  | "ip_reuse"
  | "similar_email"
  | "domain_reuse"

export interface GrantDecision {
  decision: "granted" | "withheld"
  reasons: GrantReason[]
}

export interface SignupSignalCounts {
  browserKeyOthers: number
  deviceKeySameIpOthers: number
  deviceKeyOthers: number
  ipClaimsInWindow: number
  /** Other claims from the same neighbourhood (/24, /48) inside the hour. */
  netClaimsInWindow?: number
  /** The claim came from a published hosting range — a server, not a person. */
  hosting?: boolean
  /** Other accounts ever seen on this network — real client networks only (ip_scheme = 'client'). */
  ipEverOthers?: number
  /** Other accounts whose email is this one's name with other digits, same domain. */
  similarEmailOthers?: number
  /** Other accounts ever seen from this organisation (`domain_key`); 0 when the account has no organisation key. */
  domainOthers?: number
}

export function decideSignupGrant(input: {
  providers: readonly string[] | null
  counts: SignupSignalCounts | null
  /** The claim carried neither a browser nor a device key (blocked, or a keyless fallback). */
  keyless?: boolean
  /** The account has a settled purchase on record — see the header: it outranks every rule. */
  hasPurchase?: boolean
  /** Runtime override of `SIGNUP_GRANT_RULES.domainOthersMax` (the admin setting). */
  domainOthersMax?: number
}): GrantDecision {
  if (input.hasPurchase === true) return { decision: "granted", reasons: [] }

  const reasons: GrantReason[] = []

  // An empty list is a GoTrue quirk, not an identity claim — fail open on it
  // exactly like an unreadable one.
  if (input.providers && input.providers.length > 0 && input.providers.every((p) => p === "email")) {
    reasons.push("email_only_provider")
  }

  // A claim that shows no browser and no device gets nothing (2026-10-12):
  // "who does not show who they are gets no gift". The next KEYED claim from
  // the same account is judged again (`retryKeylessWithhold`), so a person
  // whose privacy browser blocked the measurement gets the credits after a
  // reload in a regular one. Listed before the counts so the reason is there
  // even when the counts could not be read.
  if (input.keyless) reasons.push("keyless")

  const c = input.counts
  if (c) {
    if (c.browserKeyOthers > SIGNUP_GRANT_RULES.browserKeyOthersMax) reasons.push("browser_match")
    if (c.deviceKeySameIpOthers > SIGNUP_GRANT_RULES.deviceKeySameIpOthersMax) reasons.push("device_ip_match")
    if (c.deviceKeyOthers > SIGNUP_GRANT_RULES.deviceKeyOthersMax) reasons.push("device_cluster")
    if (c.ipClaimsInWindow > SIGNUP_GRANT_RULES.ipClaimsLookbackMax) reasons.push("ip_velocity")
    if ((c.netClaimsInWindow ?? 0) > SIGNUP_GRANT_RULES.netClaimsLookbackMax) reasons.push("net_velocity")
    // A server is not a person: the providers' own published ranges, no
    // inference. Residential and mobile networks never match.
    if (c.hosting === true) reasons.push("hosting_network")
    // Without keys the device rules above see nothing, which is exactly what a
    // repeat signup that blocks fingerprinting relies on: the network is the
    // only observation left, so ANY earlier account on it withholds.
    if (input.keyless && (c.ipEverOthers ?? 0) > SIGNUP_GRANT_RULES.keylessIpOthersMax) reasons.push("keyless_ip_reuse")
    // With keys, one old neighbour on the network is nothing — but a network
    // that already carries a crowd of accounts is the one thing a farm cannot
    // vary when it spreads its signups over days and gives each a fresh VM.
    if (!input.keyless && (c.ipEverOthers ?? 0) > SIGNUP_GRANT_RULES.ipEverOthersMax) reasons.push("ip_reuse")
    if ((c.similarEmailOthers ?? 0) > SIGNUP_GRANT_RULES.similarEmailOthersMax) reasons.push("similar_email")
    if ((c.domainOthers ?? 0) > (input.domainOthersMax ?? SIGNUP_GRANT_RULES.domainOthersMax)) reasons.push("domain_reuse")
  }

  return { decision: reasons.length > 0 ? "withheld" : "granted", reasons }
}

/** The reasons a keyless claim can carry that a KEYED retry may overturn. */
export const KEYLESS_ONLY_REASONS: ReadonlySet<GrantReason> = new Set<GrantReason>(["keyless", "keyless_ip_reuse"])

/**
 * Rule 6 — the first of a series (2026-10-13). The first account a farm
 * opens always looks new: nothing came before it. When a LATER claim is
 * withheld because it is the same browser, the same device, or the same
 * address within the day, that is the evidence the first one lacked — and
 * the gift it received, if it was given within the window and the account
 * has not paid, is taken back. Only the exact links count: a network
 * neighbourhood or a domain is not the same person.
 */
export const SIBLING_TAKEBACK_REASONS: ReadonlySet<GrantReason> = new Set<GrantReason>([
  "browser_match",
  "device_ip_match",
  "device_cluster",
  "ip_velocity",
])
export const SIBLING_TAKEBACK_WINDOW_MS = 24 * 60 * 60 * 1000

/** Whether a withhold's reasons are evidence against an earlier account on the same device, browser or address. */
export function siblingTakebackDue(reasons: readonly string[] | null | undefined): boolean {
  return (reasons ?? []).some((r) => (SIBLING_TAKEBACK_REASONS as ReadonlySet<string>).has(r))
}

/** Withheld only because the claim showed no browser and no device — a keyed retry decides afresh. */
export function withheldForKeylessOnly(reasons: readonly string[] | null | undefined): boolean {
  if (!reasons || reasons.length === 0) return false
  return reasons.every((r) => (KEYLESS_ONLY_REASONS as ReadonlySet<string>).has(r))
}

/**
 * The organisation an account belongs to, as the domain rule keys it: Google's
 * signed `hd` claim when there is one (a Workspace user — the claim is
 * Google's, not the user's), else the email's domain. Null for a public mail
 * provider (compiled list + the admin's additions) and for an unusable email:
 * those accounts have no organisation, and the rule never sees them.
 */
export function domainKeyOf(
  email: string | null,
  hd: string | null,
  extraPublicDomains: ReadonlySet<string> = new Set(),
): string | null {
  const fromHd = hd?.trim().toLowerCase() ?? ""
  const at = email?.lastIndexOf("@") ?? -1
  const fromEmail = at > 0 ? email!.slice(at + 1).trim().toLowerCase() : ""
  const key = fromHd || fromEmail
  if (!key || !key.includes(".")) return null
  return isPublicEmailDomain(key, extraPublicDomains) ? null : key
}

/**
 * The account's identity providers as GoTrue stamped them, and its email.
 * `null` providers when the read fails — the decision fails open on it.
 */
export interface AuthUserFacts {
  providers: string[] | null
  email: string | null
  /** Google's hosted-domain claim (`identity_data.custom_claims.hd`, where GoTrue files the claims it does not map) — a Workspace user. */
  hd: string | null
}

/** The `hd` claim off the Google identity, wherever GoTrue filed it. */
export function hostedDomainOf(identities: unknown): string | null {
  if (!Array.isArray(identities)) return null
  for (const identity of identities as Array<{ provider?: unknown; identity_data?: Record<string, unknown> | null }>) {
    if (identity?.provider !== "google") continue
    const data = identity.identity_data ?? {}
    const custom = (data.custom_claims as Record<string, unknown> | null | undefined) ?? {}
    const hd = typeof custom.hd === "string" ? custom.hd : typeof data.hd === "string" ? data.hd : null
    if (hd && hd.trim()) return hd.trim().toLowerCase()
  }
  return null
}

export async function readAuthUser(userId: string, log: FastifyBaseLogger): Promise<AuthUserFacts> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error || !data?.user) {
      log.warn({ err: error, userId }, "signup grant: provider read failed")
      return { providers: null, email: null, hd: null }
    }
    const meta = (data.user.app_metadata ?? {}) as { provider?: unknown; providers?: unknown }
    const providers = Array.isArray(meta.providers)
      ? meta.providers.filter((p): p is string => typeof p === "string")
      : typeof meta.provider === "string"
        ? [meta.provider]
        : null
    return {
      providers,
      email: typeof data.user.email === "string" ? data.user.email : null,
      hd: hostedDomainOf((data.user as { identities?: unknown }).identities),
    }
  } catch (err) {
    log.warn({ err, userId }, "signup grant: provider read threw")
    return { providers: null, email: null, hd: null }
  }
}

/**
 * Write the organisation key onto the account's claim row, so the next claim
 * from the same organisation can count it. Best-effort, after the row exists
 * (`recordSignals` in signup-grant.ts runs first): a key we failed to store is
 * a weaker corpus, never a reason to withhold. Tolerates a database that does
 * not have the column yet (staging runs ahead of migration 506).
 */
export async function recordDomainKey(userId: string, domainKey: string | null, log: FastifyBaseLogger): Promise<void> {
  if (!domainKey) return
  try {
    const { error } = await supabase.from("signup_signals").update({ domain_key: domainKey }).eq("user_id", userId).eq("source", "claim")
    if (error && !isMissingColumnError(error)) log.warn({ err: error, userId }, "signup grant: domain key write failed")
  } catch (err) {
    log.warn({ err, userId }, "signup grant: domain key write threw")
  }
}

/** Other accounts ever seen from this organisation. A failed read is 0 (fail open); a missing column (pre-506) too. */
export async function countDomainOthers(userId: string, domainKey: string | null, log: FastifyBaseLogger): Promise<number> {
  if (!domainKey) return 0
  return countOthers((q) => q.eq("domain_key", domainKey).neq("user_id", userId), "domain_reuse", log)
}

export async function readAuthProviders(userId: string, log: FastifyBaseLogger): Promise<string[] | null> {
  return (await readAuthUser(userId, log)).providers
}

/**
 * An email's comparable name: its domain, and its name with Gmail's ignored
 * dots and any +tag dropped and the trailing digits cut — "a.name27+x@googlemail.com"
 * → { stem: "aname", domain: "googlemail.com" }. Null when too little is left
 * to compare without catching strangers.
 */
export function emailStem(email: string): { stem: string; domain: string; local: string } | null {
  const at = email.lastIndexOf("@")
  if (at <= 0) return null
  const domain = email.slice(at + 1).trim().toLowerCase()
  let local = email.slice(0, at).trim().toLowerCase().split("+")[0] ?? ""
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "")
  const stem = local.replace(/\d+$/, "")
  if (stem === local) return null // no trailing digits: not a numbered series
  if (stem.replace(/[^a-z0-9]/g, "").length < SIGNUP_GRANT_RULES.similarEmailMinStem) return null
  return { stem, domain, local }
}

/** Other accounts named like this one: the same stem with other digits, at the same domain. */
export async function countSimilarEmails(userId: string, email: string | null, log: FastifyBaseLogger): Promise<number> {
  const parts = email ? emailStem(email) : null
  if (!parts) return 0
  try {
    const prefix = parts.stem.replace(/[\\%_]/g, (ch) => `\\${ch}`)
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email")
      .ilike("email", `${prefix}%@${parts.domain.replace(/[\\%_]/g, (ch) => `\\${ch}`)}`)
      .neq("id", userId)
      .gte("created_at", new Date(Date.now() - SIGNUP_GRANT_RULES.similarEmailLookbackMs).toISOString())
      .limit(200)
    if (error) {
      log.warn({ err: error }, "signup grant: similar email count failed")
      return 0
    }
    return (data ?? []).filter((row) => {
      const other = typeof row.email === "string" ? emailStem(row.email) : null
      return other !== null && other.stem === parts.stem && other.domain === parts.domain
    }).length
  } catch (err) {
    log.warn({ err }, "signup grant: similar email count threw")
    return 0
  }
}

/**
 * Settled purchases on record for the account: `transactions` rows (top-ups and
 * subscription invoices), which only the Stripe webhook writes, after
 * settlement. A failed read is 0 — the one input here that does not fail
 * open: a count we could not make must never become the reason to grant.
 */
export async function countPurchases(userId: string, log: FastifyBaseLogger): Promise<number> {
  try {
    // Counted on the column the filter already names, so the query cannot
    // depend on a column this module never otherwise reads.
    const { count, error } = await supabase
      .from("transactions")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", userId)
    if (error) {
      log.warn({ err: error, userId }, "signup grant: purchase count failed")
      return 0
    }
    return count ?? 0
  } catch (err) {
    log.warn({ err, userId }, "signup grant: purchase count threw")
    return 0
  }
}

/** One head-count against signup_signals. A failed query counts as 0. */
async function countOthers(
  build: (q: ReturnType<typeof signalsHead>) => PromiseLike<{ count: number | null; error: unknown }>,
  label: string,
  log: FastifyBaseLogger,
): Promise<number> {
  try {
    const { count, error } = await build(signalsHead())
    if (error) {
      log.warn({ err: error, rule: label }, "signup grant: signal count failed")
      return 0
    }
    return count ?? 0
  } catch (err) {
    log.warn({ err, rule: label }, "signup grant: signal count threw")
    return 0
  }
}

function signalsHead() {
  return supabase.from("signup_signals").select("user_id", { count: "exact", head: true })
}

/**
 * How many OTHER accounts share each signal. The caller has already upserted
 * this account's own row, so every query excludes `userId`; rows are unique
 * per (user_id, source), so a row count is an account count.
 */
export async function countSignupSignals(
  params: { userId: string; browserKey: string | null; deviceKey: string | null; ipHash: string; netKeyHash?: string | null },
  log: FastifyBaseLogger,
): Promise<SignupSignalCounts> {
  const { userId, browserKey, deviceKey, ipHash } = params
  const netKeyHash = params.netKeyHash ?? null
  const since = new Date(Date.now() - SIGNUP_GRANT_RULES.ipLookbackMs).toISOString()
  const netSince = new Date(Date.now() - SIGNUP_GRANT_RULES.netLookbackMs).toISOString()

  const keyless = !browserKey && !deviceKey
  const [browserKeyOthers, deviceKeySameIpOthers, deviceKeyOthers, ipClaimsInWindow, ipEverOthers, netClaimsInWindow] = await Promise.all([
    browserKey
      ? countOthers((q) => q.eq("browser_key", browserKey).neq("user_id", userId), "browser_match", log)
      : Promise.resolve(0),
    deviceKey
      ? countOthers(
          (q) => q.eq("device_key", deviceKey).eq("ip_hash", ipHash).neq("user_id", userId),
          "device_ip_match",
          log,
        )
      : Promise.resolve(0),
    deviceKey
      ? countOthers((q) => q.eq("device_key", deviceKey).neq("user_id", userId), "device_cluster", log)
      : Promise.resolve(0),
    // Network counts read REAL client networks only (see the header): a row
    // without the 458 marker holds a hosting proxy's hash or a constant.
    countOthers(
      (q) => q.eq("ip_hash", ipHash).eq("ip_scheme", "client").gte("created_at", since).neq("user_id", userId),
      "ip_velocity",
      log,
    ),
    countOthers(
      (q) => q.eq("ip_hash", ipHash).eq("ip_scheme", "client").neq("user_id", userId),
      keyless ? "keyless_ip_reuse" : "ip_reuse",
      log,
    ),
    // The neighbourhood is only ever written for a real client address (507),
    // so no scheme filter is needed; a missing column (pre-507) counts 0.
    netKeyHash
      ? countOthers((q) => q.eq("net_key_hash", netKeyHash).gte("created_at", netSince).neq("user_id", userId), "net_velocity", log)
      : Promise.resolve(0),
  ])

  return { browserKeyOthers, deviceKeySameIpOthers, deviceKeyOthers, ipClaimsInWindow, ipEverOthers, netClaimsInWindow }
}

export async function evaluateSignupGrant(
  params: {
    userId: string
    browserKey: string | null
    deviceKey: string | null
    ipHash: string
    /** Hash of the claim's neighbourhood (`neighbourhoodKey` → `networkHash`); null for an unknown address. */
    netKeyHash?: string | null
    /** The claim came from a published hosting range. */
    hosting?: boolean
  },
  log: FastifyBaseLogger,
): Promise<GrantDecision> {
  const [{ providers, email, hd }, counts, purchases, config] = await Promise.all([
    readAuthUser(params.userId, log),
    countSignupSignals(params, log),
    countPurchases(params.userId, log),
    getSignupGrantConfig(),
  ])
  const domainKey = domainKeyOf(email, hd, config.publicEmailDomains)
  // The key is written before the count so the row this claim leaves behind
  // carries it; the count excludes this account either way.
  await recordDomainKey(params.userId, domainKey, log)
  const [similarEmailOthers, domainOthers] = await Promise.all([
    countSimilarEmails(params.userId, email, log),
    countDomainOthers(params.userId, domainKey, log),
  ])
  if (purchases > 0) log.info({ userId: params.userId, purchases }, "signup grant: purchase on record, granting")
  return decideSignupGrant({
    providers,
    counts: { ...counts, similarEmailOthers, domainOthers, hosting: params.hosting === true },
    keyless: !params.browserKey && !params.deviceKey,
    hasPurchase: purchases > 0,
    domainOthersMax: config.domainOthersMax,
  })
}
