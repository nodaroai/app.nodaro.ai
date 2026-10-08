import type { FastifyBaseLogger } from "fastify"
import { supabase } from "../../lib/supabase.js"

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
  /** More than this many other claims from the network inside the lookback. */
  ipClaimsLookbackMax: 3,
  ipLookbackMs: 24 * 60 * 60 * 1000,
  /** A claim with no browser or device key: any other account ever seen on this network withholds. */
  keylessIpOthersMax: 0,
  /** Another account named like this one (the same name with other digits, same domain) withholds. */
  similarEmailOthersMax: 0,
  /** The fewest letters an email name must keep once its trailing digits are cut, to be compared at all. */
  similarEmailMinStem: 5,
  /** Only accounts made this recently count as "named like this one": a series is made in days, a namesake any time. */
  similarEmailLookbackMs: 30 * 24 * 60 * 60 * 1000,
} as const

export type GrantReason =
  | "email_only_provider"
  | "browser_match"
  | "device_ip_match"
  | "device_cluster"
  | "ip_velocity"
  | "keyless_ip_reuse"
  | "similar_email"

export interface GrantDecision {
  decision: "granted" | "withheld"
  reasons: GrantReason[]
}

export interface SignupSignalCounts {
  browserKeyOthers: number
  deviceKeySameIpOthers: number
  deviceKeyOthers: number
  ipClaimsInWindow: number
  /** Other accounts ever seen on this network — read only for a claim with no keys. */
  ipEverOthers?: number
  /** Other accounts whose email is this one's name with other digits, same domain. */
  similarEmailOthers?: number
}

export function decideSignupGrant(input: {
  providers: readonly string[] | null
  counts: SignupSignalCounts | null
  /** The claim carried neither a browser nor a device key (blocked, or a keyless fallback). */
  keyless?: boolean
  /** The account has a settled purchase on record — see the header: it outranks every rule. */
  hasPurchase?: boolean
}): GrantDecision {
  if (input.hasPurchase === true) return { decision: "granted", reasons: [] }

  const reasons: GrantReason[] = []

  // An empty list is a GoTrue quirk, not an identity claim — fail open on it
  // exactly like an unreadable one.
  if (input.providers && input.providers.length > 0 && input.providers.every((p) => p === "email")) {
    reasons.push("email_only_provider")
  }

  const c = input.counts
  if (c) {
    if (c.browserKeyOthers > SIGNUP_GRANT_RULES.browserKeyOthersMax) reasons.push("browser_match")
    if (c.deviceKeySameIpOthers > SIGNUP_GRANT_RULES.deviceKeySameIpOthersMax) reasons.push("device_ip_match")
    if (c.deviceKeyOthers > SIGNUP_GRANT_RULES.deviceKeyOthersMax) reasons.push("device_cluster")
    if (c.ipClaimsInWindow > SIGNUP_GRANT_RULES.ipClaimsLookbackMax) reasons.push("ip_velocity")
    // Without keys the device rules above see nothing, which is exactly what a
    // repeat signup that blocks fingerprinting relies on: the network is the
    // only observation left, so ANY earlier account on it withholds.
    if (input.keyless && (c.ipEverOthers ?? 0) > SIGNUP_GRANT_RULES.keylessIpOthersMax) reasons.push("keyless_ip_reuse")
    if ((c.similarEmailOthers ?? 0) > SIGNUP_GRANT_RULES.similarEmailOthersMax) reasons.push("similar_email")
  }

  return { decision: reasons.length > 0 ? "withheld" : "granted", reasons }
}

/**
 * The account's identity providers as GoTrue stamped them, and its email.
 * `null` providers when the read fails — the decision fails open on it.
 */
export async function readAuthUser(userId: string, log: FastifyBaseLogger): Promise<{ providers: string[] | null; email: string | null }> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error || !data?.user) {
      log.warn({ err: error, userId }, "signup grant: provider read failed")
      return { providers: null, email: null }
    }
    const meta = (data.user.app_metadata ?? {}) as { provider?: unknown; providers?: unknown }
    const providers = Array.isArray(meta.providers)
      ? meta.providers.filter((p): p is string => typeof p === "string")
      : typeof meta.provider === "string"
        ? [meta.provider]
        : null
    return { providers, email: typeof data.user.email === "string" ? data.user.email : null }
  } catch (err) {
    log.warn({ err, userId }, "signup grant: provider read threw")
    return { providers: null, email: null }
  }
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
  if (stem.replace(/[^a-z]/g, "").length < SIGNUP_GRANT_RULES.similarEmailMinStem) return null
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
  params: { userId: string; browserKey: string | null; deviceKey: string | null; ipHash: string },
  log: FastifyBaseLogger,
): Promise<SignupSignalCounts> {
  const { userId, browserKey, deviceKey, ipHash } = params
  const since = new Date(Date.now() - SIGNUP_GRANT_RULES.ipLookbackMs).toISOString()

  const keyless = !browserKey && !deviceKey
  const [browserKeyOthers, deviceKeySameIpOthers, deviceKeyOthers, ipClaimsInWindow, ipEverOthers] = await Promise.all([
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
    countOthers(
      (q) => q.eq("ip_hash", ipHash).gte("created_at", since).neq("user_id", userId),
      "ip_velocity",
      log,
    ),
    keyless ? countOthers((q) => q.eq("ip_hash", ipHash).neq("user_id", userId), "keyless_ip_reuse", log) : Promise.resolve(0),
  ])

  return { browserKeyOthers, deviceKeySameIpOthers, deviceKeyOthers, ipClaimsInWindow, ipEverOthers }
}

export async function evaluateSignupGrant(
  params: { userId: string; browserKey: string | null; deviceKey: string | null; ipHash: string },
  log: FastifyBaseLogger,
): Promise<GrantDecision> {
  const [{ providers, email }, counts, purchases] = await Promise.all([
    readAuthUser(params.userId, log),
    countSignupSignals(params, log),
    countPurchases(params.userId, log),
  ])
  const similarEmailOthers = await countSimilarEmails(params.userId, email, log)
  if (purchases > 0) log.info({ userId: params.userId, purchases }, "signup grant: purchase on record, granting")
  return decideSignupGrant({
    providers,
    counts: { ...counts, similarEmailOthers },
    keyless: !params.browserKey && !params.deviceKey,
    hasPurchase: purchases > 0,
  })
}
