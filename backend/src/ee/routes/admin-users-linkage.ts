import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { config } from "../../lib/config.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { requireAdmin } from "../middleware/require-admin.js"
import {
  chunk,
  isMissingFunctionError,
  keyToken,
  HYDRATION_CHUNK,
  KEY_TOKEN_LENGTH,
  type ClusterRow,
} from "../lib/signup-signal-clusters.js"
import {
  buildLinkage,
  countFor,
  keyCounts,
  LINKAGE_AXES,
  type AxisClusterRow,
  type LinkageAxis,
  type LinkageCluster,
  type SizeTier,
  type UserSignalRow,
} from "../lib/signup-linkage.js"

/**
 * The Users page's linked-account marking.
 *
 * GET /v1/admin/users/linkage?ids=…          one page of the users table: which
 *   of these accounts belong to a cluster (accounts joined by a shared device,
 *   browser profile or network), every cluster in the system for the toolbar,
 *   and each page row's own signals for the Signals column and the opened row.
 * GET /v1/admin/users/linkage/cluster?key=…  one cluster's members, by email,
 *   read when the admin opens that cluster — never shipped with the list, so a
 *   NAT cluster of a thousand accounts costs the page nothing until it is
 *   opened.
 *
 * Reads are admin, like the free-grants clusters card this is built on; the
 * routes write nothing. The "Block N" the page offers goes through the
 * existing per-account block route, one account at a time, so every block row
 * carries its own reason and audit entry.
 *
 * ONE WALK A MINUTE. `signup_signal_clusters` is a per-axis GROUP BY over the
 * whole signals table; this module walks all three axes to their total_count,
 * reads every member's grant state once, and keeps both for a minute (counted
 * from the moment the walk finished), shared by every caller that arrives
 * meanwhile. The page's own signal rows are read fresh on every call, and a
 * cluster's members (email, state, role) are read fresh when it is opened —
 * those are what an admin's action just changed.
 *
 * TOLERATES A MISSING FUNCTION, like the card: migrations reach the database
 * on a push to main, so staging serves this code before 373 exists there. The
 * page renders exactly as it did before this route when `unavailable` is true.
 *
 * TOKENS, NEVER HASHES. Every key on the wire — a signal's, a shared key's, a
 * cluster's identity — is `keyToken` of the stored hash (see
 * signup-signal-clusters.ts for why a slice of the hash would leak the IP
 * behind it).
 */

/** Must equal the SQL clamp in migration 373 (`LEAST(…, 200)`): above it every walk would stop after one page. */
export const RPC_PAGE = 200
/** 5,000 clusters per axis; past that the response says `partial`. */
export const MAX_PAGES_PER_AXIS = 25
export const LINKAGE_CACHE_MS = 60_000
export const MAX_IDS = 200

const CLUSTER_TOKEN_SECRET = config.SUPABASE_SERVICE_ROLE_KEY

export interface LinkageSignal {
  token: string
  /** Accounts holding this key, the page row included. 1 means unique. */
  count: number
}

export interface LinkageUser {
  clusterId: number | null
  /** null when the account has no claim-time signal row. */
  signals: Record<LinkageAxis, LinkageSignal | null> | null
  decision: string | null
  reasons: string[]
  signalAt: string | null
}

export interface LinkageClusterWire {
  /** The cluster's identity across requests — select by this, never by `id`. */
  key: string
  /** Display order, by size: the "#n" on the page. Can shift when a cluster grows. */
  id: number
  size: number
  unresolved: number
  tier: SizeTier
  firstSeenAt: string
  lastSeenAt: string
  withheld: number
  granted: number
  keys: Array<{ axis: LinkageAxis; token: string; count: number }>
}

export interface LinkageResponse {
  unavailable: boolean
  partial: boolean
  summary: { clusters: number; accounts: number; withheld: number; granted: number }
  clusters: LinkageClusterWire[]
  users: Record<string, LinkageUser>
}

export interface LinkageMember {
  userId: string
  email: string | null
  state: string | null
  /** The profile role: the block route refuses admins, so the page can skip them up front. */
  role: string | null
}

export interface ClusterMembersResponse {
  data: { key: string; id: number; size: number; unresolved: number; members: LinkageMember[] }
}

const EMPTY_SUMMARY = { clusters: 0, accounts: 0, withheld: 0, granted: 0 }

const linkageQuery = z.object({
  ids: z
    .string()
    .min(1)
    .transform((s) => s.split(",").map((part) => part.trim().toLowerCase()).filter((part) => part.length > 0))
    .pipe(z.array(z.uuid()).min(1).max(MAX_IDS)),
})

const clusterQuery = z.object({
  key: z.string().regex(new RegExp(`^[0-9a-f]{${KEY_TOKEN_LENGTH}}$`)),
})

type Walk =
  | { unavailable: true }
  | { unavailable: false; rows: AxisClusterRow[]; partial: boolean; states: ReadonlyMap<string, string | null> }

let cached: { at: number; walk: Promise<Walk> } | null = null

/** Tests, and nothing else, forget the cached walk. */
export function resetLinkageCache(): void {
  cached = null
}

function toAxisRow(axis: LinkageAxis, row: ClusterRow): AxisClusterRow {
  return {
    axis,
    key: row.cluster_key,
    memberCount: Number(row.member_count),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    userIds: row.user_ids ?? [],
  }
}

type AxisLoad = { unavailable: true } | { unavailable: false; rows: AxisClusterRow[]; partial: boolean }

async function loadAxis(axis: LinkageAxis): Promise<AxisLoad> {
  const rows: AxisClusterRow[] = []
  for (let page = 0; page < MAX_PAGES_PER_AXIS; page++) {
    const { data, error } = await supabase.rpc("signup_signal_clusters", {
      p_axis: axis,
      p_limit: RPC_PAGE,
      p_offset: page * RPC_PAGE,
    })
    if (error) {
      if (isMissingFunctionError(error)) return { unavailable: true }
      throw error
    }
    const batch = (data ?? []) as ClusterRow[]
    rows.push(...batch.map((row) => toAxisRow(axis, row)))
    const total = Number(batch[0]?.total_count ?? 0)
    if (batch.length < RPC_PAGE || rows.length >= total) return { unavailable: false, rows, partial: false }
  }
  return { unavailable: false, rows, partial: true }
}

interface StateRecord {
  id: string
  free_grant_state: string | null
}

/** `.in()` rides on the URL — chunked, like the free-grants hydration. */
async function readStates(ids: readonly string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  for (const part of chunk(ids, HYDRATION_CHUNK)) {
    const { data, error } = await supabase.from("profiles").select("id, free_grant_state").in("id", part)
    if (error) throw error
    for (const p of (data ?? []) as StateRecord[]) map.set(p.id, p.free_grant_state)
  }
  return map
}

async function walkAxes(): Promise<Walk> {
  const loads = await Promise.all(LINKAGE_AXES.map(loadAxis))
  const available = loads.filter((l): l is Extract<AxisLoad, { unavailable: false }> => !l.unavailable)
  if (available.length < loads.length) return { unavailable: true }
  const rows = available.flatMap((l) => l.rows)
  const memberIds = [...new Set(rows.flatMap((r) => r.userIds))]
  const states = memberIds.length ? await readStates(memberIds) : new Map<string, string | null>()
  return { unavailable: false, rows, partial: available.some((l) => l.partial), states }
}

/** One walk per minute, shared by every request that arrives meanwhile; a failed walk is forgotten. */
function cachedWalk(): Promise<Walk> {
  const now = Date.now()
  if (cached && now - cached.at < LINKAGE_CACHE_MS) return cached.walk
  const walk = walkAxes()
  const entry = { at: now, walk }
  cached = entry
  walk.then(
    () => {
      // The minute starts when the walk finished, so a slow walk cannot start a second, overlapping one.
      if (cached === entry) cached = { at: Date.now(), walk }
    },
    () => {
      if (cached === entry) cached = null
    },
  )
  return walk
}

interface SignalRecord {
  user_id: string
  device_key: string | null
  browser_key: string | null
  ip_hash: string | null
  /** 'client' when ip_hash is a real client network (458); null before real addresses were read, or unknown. */
  ip_scheme: string | null
  decision: string | null
  reasons: string[] | null
  created_at: string
}

/**
 * A network is a signal only when it is a real client network. A row written
 * before the backend read real addresses holds a hosting proxy's hash shared
 * by every user of the platform, and an unknown address hashes to a constant —
 * shown as a network, either would link strangers. The RPC applies the same
 * rule to its network axis (492), so the two never disagree.
 */
function toSignal(record: SignalRecord): UserSignalRow {
  return {
    userId: record.user_id,
    deviceKey: record.device_key,
    browserKey: record.browser_key,
    ipHash: record.ip_scheme === "client" ? record.ip_hash : null,
    decision: record.decision,
    reasons: Array.isArray(record.reasons) ? record.reasons : [],
    createdAt: record.created_at,
  }
}

async function readSignals(ids: readonly string[]): Promise<UserSignalRow[]> {
  const out: UserSignalRow[] = []
  for (const part of chunk(ids, HYDRATION_CHUNK)) {
    const { data, error } = await supabase
      .from("signup_signals")
      .select("user_id, device_key, browser_key, ip_hash, ip_scheme, decision, reasons, created_at")
      .in("user_id", part)
      .eq("source", "claim")
    if (error) throw error
    out.push(...((data ?? []) as SignalRecord[]).map(toSignal))
  }
  return out
}

interface MemberRecord {
  id: string
  email: string | null
  free_grant_state: string | null
  role: string | null
}

async function readMembers(ids: readonly string[]): Promise<LinkageMember[]> {
  const byId = new Map<string, MemberRecord>()
  for (const part of chunk(ids, HYDRATION_CHUNK)) {
    const { data, error } = await supabase.from("profiles").select("id, email, free_grant_state, role").in("id", part)
    if (error) throw error
    for (const p of (data ?? []) as MemberRecord[]) byId.set(p.id, p)
  }
  // Built from the cluster's ids, never from the profile query: a member whose
  // profile row is gone is still a member of the cluster.
  return ids.map((userId) => {
    const p = byId.get(userId)
    return { userId, email: p?.email ?? null, state: p?.free_grant_state ?? null, role: p?.role ?? null }
  })
}

const tokenOf = (key: string): string => keyToken(key, CLUSTER_TOKEN_SECRET) ?? ""

function wireCluster(cluster: LinkageCluster, states: ReadonlyMap<string, string | null>): LinkageClusterWire {
  const stateOf = (id: string) => states.get(id) ?? null
  return {
    key: tokenOf(cluster.anchorKey),
    id: cluster.id,
    size: cluster.size,
    unresolved: cluster.unresolved,
    tier: cluster.tier,
    firstSeenAt: cluster.firstSeenAt,
    lastSeenAt: cluster.lastSeenAt,
    withheld: cluster.knownIds.filter((id) => stateOf(id) === "withheld").length,
    granted: cluster.knownIds.filter((id) => stateOf(id) === "granted").length,
    keys: cluster.keys.map((k) => ({ axis: k.axis, token: tokenOf(k.key), count: k.count })),
  }
}

function wireUser(
  clusterId: number | null,
  signal: UserSignalRow | undefined,
  counts: ReadonlyMap<string, number>,
): LinkageUser {
  if (!signal) return { clusterId, signals: null, decision: null, reasons: [], signalAt: null }
  const of = (axis: LinkageAxis, key: string | null): LinkageSignal | null =>
    key ? { token: tokenOf(key), count: countFor(counts, axis, key) } : null
  return {
    clusterId,
    signals: { device: of("device", signal.deviceKey), browser: of("browser", signal.browserKey), ip: of("ip", signal.ipHash) },
    decision: signal.decision,
    reasons: [...signal.reasons],
    signalAt: signal.createdAt,
  }
}

export async function adminUsersLinkageRoutes(app: FastifyInstance) {
  app.get("/v1/admin/users/linkage", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = linkageQuery.safeParse(req.query ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid id list" } })
    }
    const ids = [...new Set(parsed.data.ids)]

    try {
      const walk = await cachedWalk()
      if (walk.unavailable) {
        req.log.warn("signup_signal_clusters is not in the database yet — serving the Users page unmarked")
        const empty: LinkageResponse = { unavailable: true, partial: false, summary: EMPTY_SUMMARY, clusters: [], users: {} }
        return empty
      }

      const signals = await readSignals(ids)
      const { clusters, clusterOfUser } = buildLinkage(walk.rows, signals)
      const counts = keyCounts(walk.rows)
      const signalOf = new Map(signals.map((s) => [s.userId, s]))

      const wired = clusters.map((c) => wireCluster(c, walk.states))
      const users = Object.fromEntries(
        ids
          .filter((id) => signalOf.has(id) || clusterOfUser.has(id))
          .map((id) => [id, wireUser(clusterOfUser.get(id) ?? null, signalOf.get(id), counts)]),
      )

      const response: LinkageResponse = {
        unavailable: false,
        partial: walk.partial,
        summary: {
          clusters: wired.length,
          accounts: wired.reduce((n, c) => n + c.size, 0),
          withheld: wired.reduce((n, c) => n + c.withheld, 0),
          granted: wired.reduce((n, c) => n + c.granted, 0),
        },
        clusters: wired,
        users,
      }
      return response
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to load linked accounts")
    }
  })

  app.get("/v1/admin/users/linkage/cluster", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = clusterQuery.safeParse(req.query ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid cluster key" } })
    }
    const { key } = parsed.data

    try {
      const walk = await cachedWalk()
      if (walk.unavailable) {
        return reply.status(503).send({
          error: { code: "not_available_yet", message: "Linked-account clusters are not available on this database yet." },
        })
      }
      const cluster = buildLinkage(walk.rows).clusters.find((c) => tokenOf(c.anchorKey) === key)
      if (!cluster) {
        return reply.status(404).send({
          error: { code: "not_found", message: "No such cluster any more — the clusters have changed since the page loaded." },
        })
      }
      const response: ClusterMembersResponse = {
        data: {
          key,
          id: cluster.id,
          size: cluster.size,
          unresolved: cluster.unresolved,
          members: await readMembers(cluster.knownIds),
        },
      }
      return response
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to load the cluster")
    }
  })
}
