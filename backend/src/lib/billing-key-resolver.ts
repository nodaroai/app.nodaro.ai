/**
 * The billing integration key — a machine credential for the deployment's
 * billing surface, and the ONLY module that names its table.
 *
 * Shape: `ndr_bill_<64 hex>`. Resolved by the auth hook (`middleware/auth.ts`)
 * in a branch that runs BEFORE the personal-token branch, because `ndr_bill_`
 * also starts with `ndr_`, and only while a deployment payer is configured — so
 * on mainline the prefix is unknown and the bearer is refused by the ordinary
 * personal-token path exactly as any other unknown `ndr_` string.
 *
 * WHY THE FULL SHA-256, NOT THE 32-CHARACTER SLICE. `auth.ts`'s JWT verification
 * cache keys on `sha256(token).slice(0, 32)` because it is a CACHE key — a
 * collision there would be a wrong cache hit on a token the caller already
 * holds. This hash is an AUTHENTICATOR: it is what the database stores in place
 * of the bearer and what a lookup matches on, so it uses the whole digest, like
 * the `ndr_app_` scheme and like `hashApiToken`.
 *
 * WHAT THIS FILE MAY NEVER DO. The plaintext bearer is returned by
 * `mintBillingKey` and nowhere else: it is not cached, not logged, not written
 * to any column, and not returned by any read. The cache below is keyed by
 * hash, so nothing in this process holds a bearer after the mint response is
 * serialised.
 *
 * THE 60-SECOND CACHE mirrors `api-token-resolver.ts`. Two consequences are
 * load-bearing and both are handled here rather than by the caller:
 *   * a revocation must not wait out the TTL, so `revokeBillingKey` invalidates
 *     the entry in the same call that writes the row; and
 *   * a key whose `expires_at` falls INSIDE a cached window must stop working
 *     at the expiry, not at the end of the window — so expiry is re-checked on
 *     every cache hit, not only on the read that populated it.
 *
 * The cache is PER PROCESS, so on a multi-replica deployment the invalidation
 * above only reaches the replica that served the revoke; every other replica
 * forgets the key within one TTL, which bounds a revocation at 60 seconds
 * fleet-wide. Identical to the personal-token resolver's property, and the
 * reason the TTL is short.
 */

import { createHash, randomBytes } from "node:crypto"
import { isIP } from "node:net"
import { supabase } from "./supabase.js"

export const BILLING_KEY_PREFIX = "ndr_bill_"

/** First 12 characters of a bearer: `ndr_bill_` plus three hex. Enough to name
 *  a key on the page and in an audit line; far too little to reconstruct one. */
const PREFIX_CHARS = 12

const TABLE = "deployment_integration_keys"

/** Never selects `token_hash`. Nothing downstream needs it, and a column that
 *  is never read cannot be leaked by a route that forgets to strip it. */
const KEY_COLUMNS = "id, name, token_prefix, created_by, created_at, expires_at, last_used_at, revoked_at, allowed_cidrs"

const CACHE_TTL_MS = 60_000
const TOUCH_THROTTLE_MS = 60_000

/** The most keys that may be live at once. One for the integration, one for a
 *  rotation in progress; beyond that a credential class just accumulates
 *  forgotten live keys. */
export const MAX_LIVE_BILLING_KEYS = 5

export interface ResolvedBillingKey {
  id: string
  name: string
  /** Canonical CIDR strings; null means "any source". */
  allowedCidrs: string[] | null
  expiresAt: string | null
}

/** A row as the page renders it. `token_hash` is deliberately absent. */
export interface BillingKeyRow {
  id: string
  name: string
  token_prefix: string
  created_by: string
  created_at: string
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  allowed_cidrs: string[] | null
}

interface CacheEntry {
  key: ResolvedBillingKey
  /** When this CACHE entry goes stale — distinct from the credential's own
   *  `expiresAt`, which is re-checked on every hit. */
  staleAt: number
}

const cache = new Map<string, CacheEntry>()
/** key id → its hash, so a revocation can find the entry it must drop. The
 *  cache is keyed by hash and the plaintext is never stored, so without this
 *  index a key cannot be found by id at all. */
const hashById = new Map<string, string>()
const lastTouched = new Map<string, number>()

export function hashBillingKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex")
}

export function billingKeyPrefix(plaintext: string): string {
  return plaintext.slice(0, PREFIX_CHARS)
}

/** Forget one key, so the next request re-reads it. Called by the revoke route
 *  in the same breath as the write. */
export function invalidateBillingKeyCache(keyId: string): void {
  const hash = hashById.get(keyId)
  if (!hash) return
  cache.delete(hash)
  hashById.delete(keyId)
}

/** Test hook: drop the whole cache. */
export function __resetBillingKeyCacheForTests(): void {
  cache.clear()
  hashById.clear()
  lastTouched.clear()
}

// ---------------------------------------------------------------------------
// The source restriction
// ---------------------------------------------------------------------------

/**
 * The forwarded client address, or null when there is none to be had.
 *
 * Deliberately the SAME derivation as `routes/oauth-register.ts`'s
 * `callerKeyHash` and `app.ts`'s `rateLimitKeyGenerator`: the leftmost
 * `X-Forwarded-For` hop, else the socket address. It is duplicated rather than
 * imported because both existing copies are inlined inside functions that do
 * something else with the result (one hashes it, one builds a rate-limit key),
 * and extracting a shared helper would edit two files this change does not own.
 * A `callerIp()` in `lib/request-helpers.ts` with all three callers using it is
 * the right end state.
 *
 * Leftmost is trustworthy HERE because the deployment's reverse proxy rewrites
 * the header to the single real client address before the request reaches this
 * process. `req.ip` alone is not a substitute: behind that proxy every external
 * request arrives from 127.0.0.1.
 */
export function callerIp(req: { headers: Record<string, string | string[] | undefined>; ip?: string }): string | null {
  const xff = req.headers["x-forwarded-for"]
  const first = typeof xff === "string" && xff.length > 0 ? xff.split(",")[0]?.trim() : undefined
  const raw = first && first.length > 0 ? first : req.ip
  return raw && raw.length > 0 ? raw : null
}

interface ParsedAddress {
  version: 4 | 6
  bits: bigint
}

function parseAddress(raw: string): ParsedAddress | null {
  const version = isIP(raw)
  if (version === 4) {
    const octets = raw.split(".")
    let bits = 0n
    for (const o of octets) bits = (bits << 8n) | BigInt(Number(o))
    return { version: 4, bits }
  }
  if (version !== 6) return null

  // An IPv4-mapped address (`::ffff:1.2.3.4`) IS the v4 address — a proxy that
  // hands one over must still match a `10.0.0.0/8` entry.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw)
  if (mapped?.[1]) return parseAddress(mapped[1])

  const [head, tail] = raw.includes("::") ? raw.split("::") : [raw, null]
  const headParts = head && head.length > 0 ? head.split(":") : []
  const tailParts = tail && tail.length > 0 ? tail.split(":") : []

  // A trailing dotted quad inside a v6 literal expands to two groups.
  const expand = (parts: string[]): string[] => {
    const out: string[] = []
    for (const p of parts) {
      if (p.includes(".")) {
        const v4 = parseAddress(p)
        if (!v4) return []
        out.push(((v4.bits >> 16n) & 0xffffn).toString(16), (v4.bits & 0xffffn).toString(16))
      } else {
        out.push(p)
      }
    }
    return out
  }

  const headGroups = expand(headParts)
  const tailGroups = expand(tailParts)
  const missing = 8 - headGroups.length - tailGroups.length
  if (missing < 0) return null
  const groups =
    tail === null ? headGroups : [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups]
  if (groups.length !== 8) return null

  let bits = 0n
  for (const g of groups) {
    const n = Number.parseInt(g === "" ? "0" : g, 16)
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) return null
    bits = (bits << 16n) | BigInt(n)
  }
  return { version: 6, bits }
}

/**
 * Canonicalise one entry of `allowedCidrs`, or null if it is not one.
 *
 * A bare address becomes a single-host block (`/32`, `/128`). HOST BITS SET
 * ARE A REFUSAL, not a silent mask: Postgres's `cidr` type rejects
 * `10.0.0.1/24` outright, so accepting it here would turn a typo into a 500 at
 * insert time — and quietly widening it to `10.0.0.0/24` would grant the key a
 * range the payer did not ask for.
 */
export function normalizeCidr(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const value = raw.trim()
  if (value.length === 0 || value.length > 64) return null

  const slash = value.lastIndexOf("/")
  const addressPart = slash === -1 ? value : value.slice(0, slash)
  // A zone-suffixed IPv6 literal (fe80::1%eth0) is not a range Postgres's cidr
  // type accepts; refuse it here (400) rather than let the insert fail (500).
  if (addressPart.includes("%")) return null
  const parsed = parseAddress(addressPart)
  if (!parsed) return null
  const width = parsed.version === 4 ? 32 : 128

  if (slash === -1) return `${addressPart}/${width}`

  const prefixPart = value.slice(slash + 1)
  if (!/^\d{1,3}$/.test(prefixPart)) return null
  const prefix = Number(prefixPart)
  if (prefix < 0 || prefix > width) return null

  const hostBits = BigInt(width - prefix)
  if (hostBits > 0n && (parsed.bits & ((1n << hostBits) - 1n)) !== 0n) return null
  return `${addressPart}/${prefix}`
}

/** Is `ip` inside any of `cidrs`? A null or empty list means "any source". */
export function ipInAnyCidr(ip: string | null, cidrs: string[] | null | undefined): boolean {
  if (!cidrs || cidrs.length === 0) return true
  if (!ip) return false
  const addr = parseAddress(ip)
  if (!addr) return false

  for (const entry of cidrs) {
    const slash = entry.lastIndexOf("/")
    if (slash === -1) continue
    const net = parseAddress(entry.slice(0, slash))
    if (!net || net.version !== addr.version) continue
    const width = net.version === 4 ? 32 : 128
    const prefix = Number(entry.slice(slash + 1))
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > width) continue
    const hostBits = BigInt(width - prefix)
    if (addr.bits >> hostBits === net.bits >> hostBits) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function isLive(row: { expires_at: string | null; revoked_at: string | null }): boolean {
  if (row.revoked_at) return false
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return false
  return true
}

/**
 * A bearer → the key it names, or null.
 *
 * NULL IS THE ONLY FAILURE VALUE, deliberately: unknown, revoked and expired
 * are indistinguishable to the caller, so the 401 the auth hook sends cannot
 * tell an attacker whether a bearer was ever real.
 */
export async function resolveBillingKey(token: string): Promise<ResolvedBillingKey | null> {
  const hash = hashBillingKey(token)

  const cached = cache.get(hash)
  if (cached && Date.now() < cached.staleAt) {
    // Re-checked on the HIT, not only on the read that filled the entry: a key
    // that expires 30 seconds into a 60-second window must die at 30.
    if (cached.key.expiresAt && new Date(cached.key.expiresAt).getTime() <= Date.now()) {
      cache.delete(hash)
      hashById.delete(cached.key.id)
      return null
    }
    return cached.key
  }

  const { data, error } = await supabase.from(TABLE).select(KEY_COLUMNS).eq("token_hash", hash).maybeSingle()
  if (error || !data) return null

  const row = data as unknown as BillingKeyRow
  if (!isLive(row)) return null

  const resolved: ResolvedBillingKey = {
    id: row.id,
    name: row.name,
    allowedCidrs: row.allowed_cidrs ?? null,
    expiresAt: row.expires_at ?? null,
  }
  cache.set(hash, { key: resolved, staleAt: Date.now() + CACHE_TTL_MS })
  hashById.set(resolved.id, hash)
  return resolved
}

/** Stamp `last_used_at`, at most once a minute per key, fire-and-forget. The
 *  column is an activity signal for the page, not an audit record — a dropped
 *  write must never cost the request that carried it. */
export function touchBillingKeyLastUsed(keyId: string): void {
  const last = lastTouched.get(keyId) ?? 0
  if (Date.now() - last < TOUCH_THROTTLE_MS) return
  lastTouched.set(keyId, Date.now())
  void Promise.resolve(
    supabase
      .from(TABLE)
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", keyId),
  ).catch(() => {})
}

// ---------------------------------------------------------------------------
// Mint, list, revoke
// ---------------------------------------------------------------------------

export type MintBillingKeyResult =
  | { ok: true; token: string; row: BillingKeyRow }
  | { ok: false; code: "write_failed" }

/**
 * Mint a key. The plaintext is generated here, hashed here, and returned to the
 * caller exactly once — the route puts it in one response body and it exists
 * nowhere else, ever.
 *
 * 32 random bytes: the same entropy as a personal token, and the same source.
 */
export async function mintBillingKey(input: {
  name: string
  expiresAt: string | null
  allowedCidrs: string[] | null
  createdBy: string
}): Promise<MintBillingKeyResult> {
  const token = BILLING_KEY_PREFIX + randomBytes(32).toString("hex")
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      name: input.name,
      token_hash: hashBillingKey(token),
      token_prefix: billingKeyPrefix(token),
      created_by: input.createdBy,
      expires_at: input.expiresAt,
      allowed_cidrs: input.allowedCidrs,
    })
    .select(KEY_COLUMNS)
    .single()

  if (error || !data) {
    // The message, never the payload — an insert payload carries the hash.
    console.error("[billing-key] mint failed:", (error as { message?: string } | null)?.message ?? "no row returned")
    return { ok: false, code: "write_failed" }
  }
  return { ok: true, token, row: data as unknown as BillingKeyRow }
}

/** Every key, newest first — live, revoked and expired alike, because the page
 *  has to be able to show WHY a key stopped working. */
export async function listBillingKeys(): Promise<BillingKeyRow[] | null> {
  const { data, error } = await supabase.from(TABLE).select(KEY_COLUMNS).order("created_at", { ascending: false })
  if (error) {
    console.error("[billing-key] list failed:", error.message)
    return null
  }
  return (data ?? []) as unknown as BillingKeyRow[]
}

/** How many of `rows` are usable right now. The cap counts these, not the
 *  table: revoked and expired keys are history, not credentials. */
export function countLiveBillingKeys(rows: readonly BillingKeyRow[]): number {
  return rows.filter((r) => isLive(r)).length
}

export type RevokeBillingKeyResult = "revoked" | "not_found" | "write_failed"

/**
 * Revoke one key and drop its cache entry.
 *
 * `revoked_at IS NULL` is part of the WHERE, so an id that is unknown and an id
 * that is already revoked answer the same: there is no LIVE key with that id.
 * That keeps the original revocation timestamp — the audit fact — instead of
 * moving it on every replayed DELETE.
 */
export async function revokeBillingKey(keyId: string): Promise<RevokeBillingKeyResult> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .is("revoked_at", null)
    .select("id, revoked_at")
    .maybeSingle()

  if (error) {
    console.error("[billing-key] revoke failed:", error.message)
    return "write_failed"
  }
  if (!data) return "not_found"
  // In the same call as the write: a revocation that waited out the 60-second
  // cache would leave the key working after the payer was told it was dead.
  invalidateBillingKeyCache(keyId)
  return "revoked"
}
