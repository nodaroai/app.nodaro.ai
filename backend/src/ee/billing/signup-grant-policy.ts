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
} as const

export type GrantReason =
  | "email_only_provider"
  | "browser_match"
  | "device_ip_match"
  | "device_cluster"
  | "ip_velocity"

export interface GrantDecision {
  decision: "granted" | "withheld"
  reasons: GrantReason[]
}

export interface SignupSignalCounts {
  browserKeyOthers: number
  deviceKeySameIpOthers: number
  deviceKeyOthers: number
  ipClaimsInWindow: number
}

export function decideSignupGrant(input: {
  providers: readonly string[] | null
  counts: SignupSignalCounts | null
}): GrantDecision {
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
  }

  return { decision: reasons.length > 0 ? "withheld" : "granted", reasons }
}

/**
 * The account's identity providers as GoTrue stamped them. `null` when the
 * read fails — the decision fails open on it.
 */
export async function readAuthProviders(userId: string, log: FastifyBaseLogger): Promise<string[] | null> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error || !data?.user) {
      log.warn({ err: error, userId }, "signup grant: provider read failed")
      return null
    }
    const meta = (data.user.app_metadata ?? {}) as { provider?: unknown; providers?: unknown }
    if (Array.isArray(meta.providers)) {
      return meta.providers.filter((p): p is string => typeof p === "string")
    }
    return typeof meta.provider === "string" ? [meta.provider] : null
  } catch (err) {
    log.warn({ err, userId }, "signup grant: provider read threw")
    return null
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

  const [browserKeyOthers, deviceKeySameIpOthers, deviceKeyOthers, ipClaimsInWindow] = await Promise.all([
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
  ])

  return { browserKeyOthers, deviceKeySameIpOthers, deviceKeyOthers, ipClaimsInWindow }
}

export async function evaluateSignupGrant(
  params: { userId: string; browserKey: string | null; deviceKey: string | null; ipHash: string },
  log: FastifyBaseLogger,
): Promise<GrantDecision> {
  const [providers, counts] = await Promise.all([
    readAuthProviders(params.userId, log),
    countSignupSignals(params, log),
  ])
  return decideSignupGrant({ providers, counts })
}
