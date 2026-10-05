import { supabase } from "../../lib/supabase.js"
import { isMissingColumnError } from "../../lib/postgrest-errors.js"
import { isPrivateOrReservedIP } from "../../lib/safe-fetch.js"
import { canonicalAddress, compileCidrList, isCloudflareEdgeAddress, networkKey, normalizeCidr, parseAddress, formatAddress } from "../../lib/ip-address.js"

/**
 * The rules for choosing a network to block (admin → Blocks). The enforcement
 * is `lib/access-blocks.ts` + `middleware/network-block.ts`; this file decides
 * what an admin may put on the list.
 *
 * A network comes from one of two places:
 * - an account's SIGNUP network (`signup_signals.ip_hash`), never shown raw —
 *   only rows marked `ip_scheme = 'client'` (a real client address; older rows
 *   hold a hosting proxy's hash and an unknown address is never blockable);
 * - an address or range the admin types.
 *
 * Collateral is the danger: a mobile carrier or a campus puts thousands of
 * people behind one address. So a network that many accounts — or any paying
 * account, the target included — signed up from needs a super_admin; a typed
 * range wider than one network needs a super_admin (nobody can count who is
 * behind it); and the admin's own network is refused. A block that needed a
 * super_admin is marked, and only a super_admin lifts it.
 */

/** Other accounts that signed up from a network before only a super_admin may block it. */
export const COLLATERAL_ACCOUNTS_THRESHOLD = 20
/**
 * Widest range an admin may type, by family (prefix length): ONE network — a
 * single IPv4 address, or one IPv6 /64 (what one line rotates inside). Wider
 * needs a super admin, down to the floor below.
 */
export const ADMIN_MIN_PREFIX = { 4: 32, 6: 64 } as const
export const SUPER_ADMIN_MIN_PREFIX = { 4: 16, 6: 32 } as const
export const BLOCK_DURATION_DAYS = [1, 7, 30, 90] as const
export type BlockDurationDays = (typeof BLOCK_DURATION_DAYS)[number]
export const DEFAULT_BLOCK_DAYS: BlockDurationDays = 30

export interface SignupNetwork {
  hash: string
  /** Only a real client address may become a block. */
  blockable: boolean
  signupAt: string
}

/** The account's signup network, or null when it never claimed. */
export async function signupNetworkOf(userId: string): Promise<SignupNetwork | null> {
  const read = (columns: string) =>
    supabase.from("signup_signals").select(columns).eq("user_id", userId).eq("source", "claim").maybeSingle()
  let { data, error } = await read("ip_hash, ip_scheme, created_at")
  // Before migration 458 there is no marker: nothing is blockable yet.
  if (error && isMissingColumnError(error)) ({ data, error } = await read("ip_hash, created_at"))
  if (error) throw error
  if (!data) return null
  const row = data as unknown as { ip_hash: string; ip_scheme?: string | null; created_at: string }
  return { hash: row.ip_hash, blockable: row.ip_scheme === "client", signupAt: row.created_at }
}

export interface NetworkCollateral {
  /** Other accounts that signed up from this network (capped read: exact up to the cap). */
  otherAccounts: number
  /** Of those, how many have ever paid (see `payingAmong`). */
  payingAccounts: number
  /** The account the block is taken from has ever paid. */
  targetPaying: boolean
}

const COLLATERAL_SAMPLE = 500

/**
 * Which of these accounts have ever paid: a paid tier now, any subscription
 * row (a cancelled one too), or any purchased top-up. Shutting a customer out
 * is a super admin's call.
 */
export async function payingAmong(ids: readonly string[]): Promise<Set<string>> {
  const paying = new Set<string>()
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100)
    const { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select("id, tier, subscription_tier, lifetime_topup_credits")
      .in("id", part)
    if (pErr) throw pErr
    for (const p of (profiles ?? []) as Array<{
      id: string
      tier: string | null
      subscription_tier: string | null
      lifetime_topup_credits: number | null
    }>) {
      const tier = p.tier ?? p.subscription_tier ?? "free"
      if (tier !== "free" || (p.lifetime_topup_credits ?? 0) > 0) paying.add(p.id)
    }
    const { data: subs, error: sErr } = await supabase.from("subscriptions").select("user_id").in("user_id", part)
    if (sErr) throw sErr
    for (const s of (subs ?? []) as Array<{ user_id: string }>) paying.add(s.user_id)
  }
  return paying
}

/** Who a block on this signup network would shut out: the other accounts from it, and the account it is taken from. */
export async function collateralOf(hash: string, targetUserId: string | null): Promise<NetworkCollateral> {
  let q = supabase.from("signup_signals").select("user_id", { count: "exact" }).eq("ip_hash", hash).eq("source", "claim")
  if (targetUserId) q = q.neq("user_id", targetUserId)
  const { data, error, count } = await q.limit(COLLATERAL_SAMPLE)
  if (error) throw error
  const ids = ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
  const paying = await payingAmong(targetUserId ? [...ids, targetUserId] : ids)
  return {
    otherAccounts: count ?? ids.length,
    payingAccounts: ids.filter((id) => paying.has(id)).length,
    targetPaying: targetUserId !== null && paying.has(targetUserId),
  }
}

/** Does blocking this collateral need a super_admin? */
export function needsSuperAdmin(c: NetworkCollateral): boolean {
  return c.otherAccounts >= COLLATERAL_ACCOUNTS_THRESHOLD || c.payingAccounts > 0 || c.targetPaying
}

export type RangeRefusal =
  | "invalid_address"
  | "not_public"
  | "cloudflare"
  | "too_wide"
  | "too_wide_for_admin"
  | "own_network"

export const RANGE_REFUSAL_MESSAGE: Record<
  RangeRefusal | "not_blockable" | "own_signup_network" | "needs_super_admin" | "super_admin_to_lift",
  string
> = {
  invalid_address: "That is not an address or range.",
  not_public: "Private, internal and reserved addresses cannot be blocked.",
  cloudflare: "That is a Cloudflare server, not a person — it cannot be blocked.",
  too_wide: "That range is too wide to block.",
  too_wide_for_admin: "Only a super admin can block a range. An admin can block one address.",
  own_network: "That range includes the network you are on right now.",
  not_blockable: "This account's signup address was not recorded as a real client address, so it cannot be blocked.",
  own_signup_network: "That is the network you are on right now.",
  needs_super_admin: "Many accounts, or a paying account, signed up from this network — only a super admin can block it.",
  super_admin_to_lift: "A super admin placed this block — only a super admin can lift it.",
}

/**
 * A typed address or range → the canonical range to store, or a refusal.
 * A single IPv6 address blocks its /64 (the unit one line rotates inside);
 * a single IPv4 address is itself. `superAdminOnly`: wider than one network,
 * so only a super admin could place it — and only one may lift it.
 */
export function rangeToBlock(
  input: string,
  opts: { superAdmin: boolean; adminAddress: string | null },
): { cidr: string; superAdminOnly: boolean } | { refusal: RangeRefusal } {
  const trimmed = input.trim()
  let cidr: string | null
  if (trimmed.includes("/")) {
    cidr = normalizeCidr(trimmed)
  } else {
    const address = canonicalAddress(trimmed)
    const key = address ? networkKey(address) : null
    cidr = key ? (key.includes("/") ? key : `${key}/${key.includes(":") ? 128 : 32}`) : null
  }
  if (!cidr) return { refusal: "invalid_address" }

  const slash = cidr.lastIndexOf("/")
  const base = cidr.slice(0, slash)
  const prefix = Number(cidr.slice(slash + 1))
  const parsed = parseAddress(base)
  if (!parsed) return { refusal: "invalid_address" }
  const family = parsed.version
  const canonicalBase = formatAddress(parsed)

  if (isPrivateOrReservedIP(canonicalBase)) return { refusal: "not_public" }
  if (isCloudflareEdgeAddress(canonicalBase)) return { refusal: "cloudflare" }
  if (prefix < SUPER_ADMIN_MIN_PREFIX[family]) return { refusal: "too_wide" }
  if (!opts.superAdmin && prefix < ADMIN_MIN_PREFIX[family]) return { refusal: "too_wide_for_admin" }
  if (opts.adminAddress && compileCidrList([cidr]).matches(opts.adminAddress)) return { refusal: "own_network" }
  return { cidr, superAdminOnly: prefix < ADMIN_MIN_PREFIX[family] }
}

export function expiryFromDays(days: BlockDurationDays, now = Date.now()): string {
  return new Date(now + days * 24 * 60 * 60 * 1000).toISOString()
}
