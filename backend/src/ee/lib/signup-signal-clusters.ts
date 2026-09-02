/**
 * Signup-signal clusters: the pure shaping the admin routes hand their rows to.
 *
 * Nothing here touches supabase or fastify on purpose — the grouping, the
 * ordering, the truncation and the "is this RPC even in the database yet"
 * question are all decidable from values, so they unit-test without a mock.
 */

import { createHmac } from "node:crypto"

export type ClusterAxis = "device" | "browser" | "ip"

/** One row as the RPC returns it. */
export interface ClusterRow {
  cluster_key: string
  member_count: number
  first_seen_at: string
  last_seen_at: string
  user_ids: string[]
  total_count: number
}

export interface ProfileRow {
  id: string
  email: string | null
  full_name: string | null
  subscription_credits: number | null
  free_grant_state: string | null
}

export interface SignalRow {
  user_id: string
  created_at: string
  reasons: string[] | null
}

export interface ClusterMember {
  userId: string
  email: string | null
  fullName: string | null
  state: string | null
  subscriptionCredits: number
  signalAt: string | null
  reasons: string[]
}

export interface Cluster {
  keyPrefix: string
  memberCount: number
  firstSeenAt: string
  lastSeenAt: string
  members: ClusterMember[]
}

export interface RelatedAccount extends ClusterMember {
  matches: ClusterAxis[]
}

/**
 * A cluster's display token: 12 hex characters of a KEYED digest of the stored
 * hash — never the head of the hash itself.
 *
 * WHY KEYED, AND NOT A SLICE. `ip_hash` is an UNSALTED sha256 of the caller's
 * IP (`callerKeyHash`, src/routes/oauth-register.ts). IPv4 is a 2^32 space, so
 * 48 bits of that digest pin the address down uniquely: anyone holding the head
 * of the hash — an operator's DevTools, a HAR file, a screenshot in a support
 * ticket — recovers the plaintext IP with a commodity brute force. Migration
 * 365 §2 states the opposite invariant for this table ("nothing here can be
 * read back into a raw fingerprint, an IP, or a user agent"), so the head of
 * the hash must not go on the wire. Re-hashing would NOT help; the candidate
 * space is still 2^32. An HMAC is stable the way the UI needs — the same key
 * always renders the same token, so rows still group and pages still agree —
 * while inverting it additionally requires the server key.
 *
 * ALL THREE AXES go through it. Device and browser keys are high-entropy
 * browser fingerprints and not enumerable today, but nothing enforces that, and
 * one tokeniser with no axis switch cannot drift when a fourth axis is added.
 */
export const KEY_TOKEN_LENGTH = 12
/** `.in()` is a GET query param — a NAT cluster must not build a 500-id URL. */
export const HYDRATION_CHUNK = 100
export const RELATED_PER_AXIS_LIMIT = 100
export const RELATED_MAX = 200

export function keyToken(key: string | null | undefined, secret: string): string | null {
  if (!key) return null
  return createHmac("sha256", secret).update(`signup-signal-cluster:${key}`).digest("hex").slice(0, KEY_TOKEN_LENGTH)
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function uniqueIds(rows: readonly ClusterRow[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of rows) {
    for (const id of row.user_ids ?? []) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

/**
 * "The function is not in the database yet" — the only supabase error the
 * cluster route answers with an empty page instead of a 500. Migrations reach
 * the database on a push to main, so staging runs this code for days first.
 */
export function isMissingFunctionError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  const record = err as { code?: unknown; message?: unknown }
  if (record.code === "PGRST202" || record.code === "42883") return true
  return typeof record.message === "string" && /could not find the function/i.test(record.message)
}

function memberFor(
  userId: string,
  profiles: ReadonlyMap<string, ProfileRow>,
  signal: SignalRow | undefined,
): ClusterMember {
  const profile = profiles.get(userId)
  const reasons = signal?.reasons
  return {
    userId,
    email: profile?.email ?? null,
    fullName: profile?.full_name ?? null,
    state: profile?.free_grant_state ?? null,
    subscriptionCredits: profile?.subscription_credits ?? 0,
    signalAt: signal?.created_at ?? null,
    reasons: Array.isArray(reasons) ? [...reasons] : [],
  }
}

/** null sorts last on both orderings; ties break on the id so paging is stable. */
function compareBySignalAt(a: ClusterMember, b: ClusterMember, direction: 1 | -1): number {
  if (a.signalAt !== b.signalAt) {
    if (a.signalAt === null) return 1
    if (b.signalAt === null) return -1
    return a.signalAt < b.signalAt ? -direction : direction
  }
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
}

export function buildClusters(
  rows: readonly ClusterRow[],
  profiles: ReadonlyMap<string, ProfileRow>,
  signals: ReadonlyMap<string, SignalRow>,
  secret: string,
): Cluster[] {
  return rows.map((row) => {
    // Built from the RPC's ids, never from the profile query: a member whose
    // profile row is gone is still a member of the cluster.
    const members = (row.user_ids ?? [])
      .map((id) => memberFor(id, profiles, signals.get(id)))
      .sort((a, b) => compareBySignalAt(a, b, 1))
    return {
      // The wire field keeps its `keyPrefix` name; the value is a keyed token.
      keyPrefix: keyToken(row.cluster_key, secret) ?? "",
      memberCount: row.member_count,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      members,
    }
  })
}

export function mergeRelated(
  perAxis: ReadonlyArray<{ axis: ClusterAxis; rows: readonly SignalRow[] }>,
  profiles: ReadonlyMap<string, ProfileRow>,
): RelatedAccount[] {
  const byUser = new Map<string, RelatedAccount>()
  for (const { axis, rows } of perAxis) {
    for (const row of rows) {
      const existing = byUser.get(row.user_id)
      if (existing) {
        if (!existing.matches.includes(axis)) existing.matches = [...existing.matches, axis]
        continue
      }
      byUser.set(row.user_id, { ...memberFor(row.user_id, profiles, row), matches: [axis] })
    }
  }
  return [...byUser.values()].sort((a, b) => compareBySignalAt(a, b, -1)).slice(0, RELATED_MAX)
}
