// backend/src/ee/concurrency-lanes/live-usage.ts — what Admin → Live usage
// shows of this environment right now (GET /v1/admin/lanes/live), and the
// drill-down of one user (GET /v1/admin/lanes/users/:id).
//
// Read from this environment's Redis: one gate snapshot (every line's lanes,
// every provider's counts), and the keys each process publishes
// (server-occupancy.ts) — its pools' occupancy and its counters of work that
// ran outside the gate — found through the publishers' index, or by one
// bounded SCAN when there is no index yet. Names, addresses and tiers come from one
// batched profile read (chunks of PROFILE_CHUNK ids, cached PROFILE_TTL_MS),
// overrides from the sizes' own cache. The assembled report is cached
// REPORT_TTL_MS with in-flight dedupe, so any number of open admin pages cost
// one snapshot per interval.
//
// While limits are off every acquire is granted: a lease that would have
// waited runs over its limit (`overLimit`), so the page shows who WOULD have
// waited. The deployment's payer account is never listed except to itself
// (hideDeploymentPayer), as on the users page.
import type { LaneSnapshot, LaneSizes, ConcurrencyLane, LaneUserEntry, PayerKey } from "../../lib/concurrency-lanes/types.js"
import type { ServerPool } from "../../lib/concurrency-lanes/server-share.js"
import { publishedIndexKey } from "../../lib/concurrency-lanes/server-occupancy.js"
import { effectiveTierOf } from "../billing/org-entitlements.js"

export const REPORT_TTL_MS = 2_500
export const PROFILE_TTL_MS = 30_000
/** Ids per profile query: keeps the request line well under the gateway's limit. */
export const PROFILE_CHUNK = 200
const MAX_PROFILE_ENTRIES = 10_000
/** Keys asked per SCAN call; the walk stops after SCAN_MAX_CALLS calls or SCAN_BUDGET_MS. */
export const SCAN_COUNT = 1_000
export const SCAN_MAX_CALLS = 2_000
export const SCAN_BUDGET_MS = 2_000
const MGET_CHUNK = 200
/** Users listed per provider. */
export const TOP_USERS = 5
/** MCP client names listed per line; the rest of the line's MCP entries are "others". */
export const MCP_CLIENTS_SHOWN = 5
/** Characters of an MCP client name shown. */
export const MCP_CLIENT_NAME_MAX = 40
/** The grade every workspace line is sized at (payer.ts). */
const WORKSPACE_TIER = "business"

const LANES: readonly ConcurrencyLane[] = ["provider", "llm", "local", "run"]
const POOLS: readonly ServerPool[] = ["video", "render", "orchestrator", "pipeline", "director"]

/** The slice of an ioredis client the reader uses; `status` other than "ready" skips the SCAN. */
export interface LiveRedis {
  readonly status?: string
  scan(cursor: string, matchToken: "MATCH", pattern: string, countToken: "COUNT", count: number): Promise<[string, string[]]>
  /** The publishers' index (server-occupancy.ts); without it the keys are found by SCAN. */
  zrangebyscore?(key: string, min: number | string, max: number | string): Promise<string[]>
  mget(...keys: string[]): Promise<Array<string | null>>
}

/** `found`: the account has a profile row. */
export interface ProfileInfo { email: string | null; name: string | null; tier: string | null; found: boolean }
/** How long one profile query may take. */
export const PROFILE_QUERY_TIMEOUT_MS = 5_000
export type ProfileLookup = (ids: readonly string[]) => Promise<ReadonlyMap<string, ProfileInfo>>

export interface LiveUsageDeps {
  snapshot: () => Promise<LaneSnapshot>
  redis: () => Promise<LiveRedis>
  profiles: ProfileLookup
  /** Every account's override; empty where there are no plans. */
  overrides: () => Promise<ReadonlyMap<string, Readonly<Partial<LaneSizes>>>>
  /** Whether lines have plans (Cloud): tiers and overrides are shown only then. */
  plans: boolean
  undeclaredPluginTypes: () => string[]
  available: () => boolean
  env: () => string
  now: () => number
  /** The gate's key prefix (`cl:v1:`). */
  prefix: string
  /** How long one Redis call may take. */
  callTimeoutMs: number
  /** Told when names could not be read; the report then shows ids (as the online-users list does). */
  onProfileError?: (err: unknown) => void
}

export interface LiveLane { running: number; overLimit: number; queued: number; limit: number | null }
export interface LiveLine {
  userId: string
  email: string | null
  name: string | null
  payer: string
  tier: string | null
  override: Partial<LaneSizes> | null
  lanes: Record<ConcurrencyLane, LiveLane>
  oldestWaitMs: number
  sources: Record<string, number>
  /**
   * The line's MCP entries by client name, most first, at most MCP_CLIENTS_SHOWN.
   * The name is the caller's own text, cleaned and shortened; MCP entries not
   * listed (past the cap, or with no usable name) are `sources.mcp` minus these.
   */
  mcpClients: Array<{ name: string; count: number }>
}
export interface LiveProvider {
  provider: string
  running: number
  ceiling: number | null
  topUsers: Array<{ userId: string; email: string | null; running: number }>
  completed15m: number
  failed15m: number
  /** failed / (completed + failed) over the last 15 minutes; null with no outcome. */
  failureRate15m: number | null
}
export interface LiveServer {
  processId: string
  at: number
  poolSize: number | null
  held: number
  userCap: number | null
  coordinators: number
  coordinatorCap: number | null
  /** Users holding more of the pool than the cap allows (counted, not refused, while limits are off). */
  overCapUsers: number
}
export interface LiveReport {
  checkedAt: string
  env: string
  enforced: boolean
  available: boolean
  totals: { activeUsers: number; running: number; queued: number; overLimit: number; longestWaitMs: number }
  lines: LiveLine[]
  providers: LiveProvider[]
  servers: Record<ServerPool, LiveServer[]>
  /** Calls that ran with no slot (by job type) and deliberately unlimited scopes (by reason), summed over this environment's processes. */
  ungated: Record<string, number>
  notLimited: Record<string, number>
  failOpen: Record<string, number>
  /** What the counters cover: each process counts from its own start. */
  counters: { processes: number; oldestStartedAt: string | null; newestStartedAt: string | null }
  /** False when the SCAN of the servers' keys stopped early or could not run: the strip and the counters may miss some. */
  serversComplete: boolean
  undeclaredPluginTypes: string[]
}

export interface Viewer {
  /** The deployment's payer account, when the viewer is not that account; null shows everyone. */
  hiddenUserId: string | null
}

// ------------------------------------------------------------------ helpers

/**
 * An MCP client name as the page may show it: the caller chose it, so format
 * characters (zero-width, direction marks) are dropped, control and other
 * invisible characters become spaces, runs of space collapse, and it is cut to
 * MCP_CLIENT_NAME_MAX characters.
 * Null when nothing readable is left.
 */
export function cleanClientName(raw: string): string | null {
  const flat = raw.normalize("NFC").replace(/\p{Cf}/gu, "").replace(/\p{C}/gu, " ").replace(/\s+/g, " ").trim()
  if (flat === "") return null
  const chars = [...flat]
  return chars.length > MCP_CLIENT_NAME_MAX ? `${chars.slice(0, MCP_CLIENT_NAME_MAX - 1).join("").trimEnd()}…` : flat
}

/** A line's MCP client counts, cleaned, merged where cleaning made two names one, most first, capped. */
export function topMcpClients(counts: Readonly<Record<string, number>> | undefined): Array<{ name: string; count: number }> {
  const merged = new Map<string, number>()
  for (const [raw, n] of Object.entries(counts ?? {})) {
    const name = cleanClientName(raw)
    if (name === null || !Number.isFinite(n) || n <= 0) continue
    merged.set(name, (merged.get(name) ?? 0) + n)
  }
  return [...merged]
    .sort(([na, a], [nb, b]) => b - a || (na < nb ? -1 : na > nb ? 1 : 0))
    .slice(0, MCP_CLIENTS_SHOWN)
    .map(([name, count]) => ({ name, count }))
}

function bounded<T>(p: Promise<T>, ms: number): Promise<T> {
  p.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms)
    timer.unref?.()
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)

function addCounts(into: Record<string, number>, from: unknown): void {
  if (!isRecord(from)) return
  for (const [k, v] of Object.entries(from)) if (typeof v === "number" && Number.isFinite(v)) into[k] = (into[k] ?? 0) + v
}

/** The account a payer line bills: the user, the deployment payer, or a workspace (no account). */
function accountOf(payer: string, userId: string): { kind: "user" | "workspace" | "deployment"; id: string } {
  const i = payer.indexOf(":")
  const kind = payer.slice(0, i)
  if (kind === "deployment") return { kind, id: payer.slice(i + 1) }
  if (kind === "workspace") return { kind, id: payer.slice(i + 1) }
  return { kind: "user", id: userId }
}

/** A payer line as a viewer may see it: the hidden payer's id is never named. */
export function visiblePayer(payer: string, hiddenUserId: string | null): string {
  return hiddenUserId !== null && payer === `deployment:${hiddenUserId}` ? "deployment" : payer
}

// ----------------------------------------------------------------- profiles

/**
 * A profile lookup over `from("profiles")`: ids read in chunks of
 * PROFILE_CHUNK, each answer kept PROFILE_TTL_MS (an id with no row too). With
 * `plans`, the account's effective tier as billing reads it; else no tier.
 */
export function createProfileLookup(opts: { db: { from(table: string): unknown }; plans: boolean; now?: () => number }): ProfileLookup {
  const now = opts.now ?? Date.now
  const cache = new Map<string, { at: number; value: ProfileInfo }>()
  const cols = opts.plans ? "id, email, full_name, tier, subscription_tier, lifetime_topup_credits" : "id, email, full_name"
  type Row = { id: string; email?: string | null; full_name?: string | null; tier?: string | null; subscription_tier?: string | null; lifetime_topup_credits?: number | null }
  type Select = { select(c: string): { in(col: string, ids: string[]): PromiseLike<{ data: Row[] | null; error: { message?: string } | null }> } }
  return async (ids) => {
    const at = now()
    const out = new Map<string, ProfileInfo>()
    const missing: string[] = []
    for (const id of new Set(ids)) {
      const hit = cache.get(id)
      if (hit && at - hit.at < PROFILE_TTL_MS) out.set(id, hit.value)
      else missing.push(id)
    }
    const chunks: string[][] = []
    for (let i = 0; i < missing.length; i += PROFILE_CHUNK) chunks.push(missing.slice(i, i + PROFILE_CHUNK))
    // Every chunk at once, each bounded; any failure fails the lookup (the caller then shows ids).
    const answers = await Promise.all(chunks.map(async (chunk) => {
      const { data, error } = await bounded(Promise.resolve((opts.db.from("profiles") as Select).select(cols).in("id", chunk)), PROFILE_QUERY_TIMEOUT_MS)
      if (error) throw new Error(`could not read profiles: ${error.message ?? "unknown error"}`)
      return { chunk, byId: new Map((data ?? []).map((r) => [r.id, r])) }
    }))
    for (const { chunk, byId } of answers) {
      for (const id of chunk) {
        const r = byId.get(id)
        const value: ProfileInfo = {
          email: r?.email ?? null,
          name: r?.full_name ?? null,
          tier: r && opts.plans
            ? effectiveTierOf({ tier: r.tier ?? null, subscription_tier: r.subscription_tier ?? null, lifetime_topup_credits: r.lifetime_topup_credits ?? 0 })
            : null,
          found: r !== undefined,
        }
        out.set(id, value)
        cache.delete(id)
        cache.set(id, { at, value })
      }
    }
    // Bounded: the oldest answers go first.
    for (const id of cache.keys()) {
      if (cache.size <= MAX_PROFILE_ENTRIES) break
      cache.delete(id)
    }
    return out
  }
}

// ------------------------------------------------------------------ reader

interface Published { servers: Record<ServerPool, LiveServer[]>; ungated: Record<string, number>; notLimited: Record<string, number>; failOpen: Record<string, number>; startedAt: number[]; complete: boolean }

/** The full picture before a viewer's hiding; cached. */
interface Base {
  at: number
  /** False when names could not be read: such a report is never cached. */
  named: boolean
  snap: LaneSnapshot
  published: Published
  profiles: ReadonlyMap<string, ProfileInfo>
  overrides: ReadonlyMap<string, Readonly<Partial<LaneSizes>>>
}

export class LiveUsage {
  private cached: Base | null = null
  private inFlight: Promise<Base> | null = null

  constructor(private readonly deps: LiveUsageDeps) {}

  /** The report as `viewer` may see it. Throws when the gate cannot be read. */
  async live(viewer: Viewer): Promise<LiveReport> {
    return this.render(await this.base(), viewer)
  }

  /**
   * One user's running and queued entries per payer line, as `viewer` may see
   * them; null when the user is hidden, or has no profile and nothing in the
   * lanes (no such user). A failed profile read never answers null.
   */
  async user(userId: string, entries: LaneUserEntry[], viewer: Viewer): Promise<{
    userId: string; email: string | null; name: string | null
    lines: Array<{ payer: string; tier: string | null; override: Partial<LaneSizes> | null; entries: LaneUserEntry[] }>
  } | null> {
    if (viewer.hiddenUserId !== null && userId === viewer.hiddenUserId) return null
    const payers = [...new Set(entries.map((e) => e.payer))]
    const accounts = payers.map((p) => accountOf(p, userId))
    const [{ profiles, named }, overrides] = await Promise.all([
      this.profilesOrIds([userId, ...accounts.filter((a) => a.kind === "deployment").map((a) => a.id)]),
      this.deps.plans ? this.deps.overrides() : Promise.resolve(new Map<string, Partial<LaneSizes>>()),
    ])
    const me = profiles.get(userId)
    if (named && me?.found !== true && entries.length === 0) return null
    return {
      userId,
      email: me?.email ?? null,
      name: me?.name ?? null,
      lines: payers.map((payer, i) => ({
        payer: visiblePayer(payer, viewer.hiddenUserId),
        ...this.planOf(accounts[i]!, profiles, overrides, viewer.hiddenUserId),
        entries: entries.filter((e) => e.payer === payer).map((e) => ({ ...e, payer: visiblePayer(e.payer, viewer.hiddenUserId) as PayerKey })),
      })),
    }
  }

  /** A line's plan and override; a hidden deployment payer's are not shown (they are that account's). */
  private planOf(
    account: { kind: "user" | "workspace" | "deployment"; id: string },
    profiles: ReadonlyMap<string, ProfileInfo>,
    overrides: ReadonlyMap<string, Readonly<Partial<LaneSizes>>>,
    hiddenUserId: string | null,
  ): { tier: string | null; override: Partial<LaneSizes> | null } {
    if (!this.deps.plans) return { tier: null, override: null }
    if (account.kind === "deployment" && account.id === hiddenUserId) return { tier: null, override: null }
    if (account.kind === "workspace") return { tier: WORKSPACE_TIER, override: null }
    const o = overrides.get(account.id)
    return { tier: profiles.get(account.id)?.tier ?? null, override: o ? { ...o } : null }
  }

  /** The profiles of `ids`, or none (the report shows ids) when they cannot be read. */
  private async profilesOrIds(ids: readonly string[]): Promise<{ profiles: ReadonlyMap<string, ProfileInfo>; named: boolean }> {
    try {
      return { profiles: await this.deps.profiles(ids), named: true }
    } catch (err) {
      this.deps.onProfileError?.(err)
      return { profiles: new Map(), named: false }
    }
  }

  private base(): Promise<Base> {
    const at = this.deps.now()
    if (this.cached && at - this.cached.at < REPORT_TTL_MS) return Promise.resolve(this.cached)
    this.inFlight ??= this.read(at).then(
      (b) => { this.cached = b.named ? b : null; this.inFlight = null; return b },
      (err: unknown) => { this.inFlight = null; throw err },
    )
    return this.inFlight
  }

  private async read(at: number): Promise<Base> {
    const [snap, published] = await Promise.all([this.deps.snapshot(), this.readPublished()])
    const ids = new Set<string>()
    for (const l of snap.lines) {
      ids.add(l.userId)
      const a = accountOf(l.payer, l.userId)
      if (a.kind === "deployment") ids.add(a.id)
    }
    for (const p of snap.providers) for (const u of Object.keys(p.byUser)) ids.add(u)
    const [{ profiles, named }, overrides] = await Promise.all([
      this.profilesOrIds([...ids]),
      this.deps.plans ? this.deps.overrides() : Promise.resolve(new Map<string, Partial<LaneSizes>>()),
    ])
    return { at, named, snap, published, profiles, overrides }
  }

  /** Every process's published occupancy and counters in this environment. Never throws: what cannot be read is left out. */
  private async readPublished(): Promise<Published> {
    const servers = Object.fromEntries(POOLS.map((p) => [p, [] as LiveServer[]])) as Record<ServerPool, LiveServer[]>
    const out: Published = { servers, ungated: {}, notLimited: {}, failOpen: {}, startedAt: [], complete: false }
    const env = this.deps.env()
    const serverPrefix = `${this.deps.prefix}servers:${env}:`
    const counterPrefix = `${this.deps.prefix}counters:${env}:`
    try {
      const client = await this.deps.redis()
      if (typeof client.status === "string" && client.status !== "ready") return out
      const ours = (k: string) => k.startsWith(serverPrefix) || k.startsWith(counterPrefix)
      // The publishers' index first: O(processes). Expired members are dropped by score.
      const keys: string[] = client.zrangebyscore
        ? (await bounded(client.zrangebyscore(publishedIndexKey(this.deps.prefix, env), this.deps.now(), "+inf"), this.deps.callTimeoutMs)).filter(ours)
        : []
      if (keys.length > 0) {
        out.complete = true
      } else {
        // No index yet (processes from before it, or a Redis that lost it): one
        // bounded walk for both kinds of key — SCAN's cost is the keyspace, not the pattern.
        const started = this.deps.now()
        let cursor = "0"
        let calls = 0
        do {
          const [next, batch] = await bounded(client.scan(cursor, "MATCH", `${this.deps.prefix}*:${env}:*`, "COUNT", SCAN_COUNT), this.deps.callTimeoutMs)
          cursor = next
          calls += 1
          keys.push(...batch.filter(ours))
        } while (cursor !== "0" && calls < SCAN_MAX_CALLS && this.deps.now() - started < SCAN_BUDGET_MS)
        out.complete = cursor === "0"
      }
      const unique = [...new Set(keys)]
      for (let i = 0; i < unique.length; i += MGET_CHUNK) {
        const chunk = unique.slice(i, i + MGET_CHUNK)
        const values = await bounded(client.mget(...chunk), this.deps.callTimeoutMs)
        chunk.forEach((key, j) => this.absorb(out, key, values[j] ?? null, serverPrefix))
      }
    } catch {
      out.complete = false
    }
    for (const pool of POOLS) servers[pool].sort((a, b) => (a.processId < b.processId ? -1 : a.processId > b.processId ? 1 : 0))
    return out
  }

  private absorb(out: Published, key: string, raw: string | null, serverPrefix: string): void {
    if (raw === null) return
    let v: unknown
    try {
      v = JSON.parse(raw)
    } catch {
      return
    }
    if (!isRecord(v)) return
    if (key.startsWith(serverPrefix)) {
      const pool = v.pool as ServerPool
      if (!POOLS.includes(pool)) return
      const userCap = numOrNull(v.userCap)
      const byUser = isRecord(v.byUser) ? Object.values(v.byUser).map(num) : []
      out.servers[pool].push({
        processId: String(v.processId ?? key.slice(serverPrefix.length + pool.length + 1)),
        at: num(v.at),
        poolSize: numOrNull(v.poolSize),
        held: num(v.held),
        userCap,
        coordinators: num(v.coordinators),
        coordinatorCap: numOrNull(v.coordinatorCap),
        overCapUsers: userCap === null ? 0 : byUser.filter((n) => n > userCap).length,
      })
      return
    }
    addCounts(out.ungated, v.ungated)
    addCounts(out.notLimited, v.notLimited)
    addCounts(out.failOpen, v.failOpen)
    if (typeof v.startedAt === "number" && Number.isFinite(v.startedAt)) out.startedAt.push(v.startedAt)
  }

  private render(b: Base, viewer: Viewer): LiveReport {
    const hidden = viewer.hiddenUserId
    const lines: LiveLine[] = b.snap.lines
      .filter((l) => l.userId !== hidden)
      .map((l) => {
        const profile = b.profiles.get(l.userId)
        const lanes = Object.fromEntries(LANES.map((lane) => {
          const s = l.lanes[lane]
          const limit = l.limits?.[lane] ?? 0
          return [lane, { running: s.running, overLimit: s.overLimit, queued: s.queued, limit: limit > 0 ? limit : null }]
        })) as Record<ConcurrencyLane, LiveLane>
        return {
          userId: l.userId,
          email: profile?.email ?? null,
          name: profile?.name ?? null,
          payer: visiblePayer(l.payer, hidden),
          ...this.planOf(accountOf(l.payer, l.userId), b.profiles, b.overrides, hidden),
          lanes,
          oldestWaitMs: l.oldestWaitMs,
          sources: { ...l.sources },
          mcpClients: topMcpClients(l.mcpClients),
        }
      })
      .filter((l) => LANES.some((lane) => l.lanes[lane].running + l.lanes[lane].queued > 0))
    const sum = (l: LiveLine, k: "running" | "queued" | "overLimit") => LANES.reduce((n, lane) => n + l.lanes[lane][k], 0)
    lines.sort((a, b2) => sum(b2, "queued") - sum(a, "queued") || sum(b2, "overLimit") - sum(a, "overLimit")
      || sum(b2, "running") - sum(a, "running") || (a.userId < b2.userId ? -1 : a.userId > b2.userId ? 1 : a.payer < b2.payer ? -1 : 1))
    const providers: LiveProvider[] = b.snap.providers.map((p) => {
      const outcomes = p.completed15m + p.failed15m
      return {
        provider: p.provider,
        running: p.running,
        ceiling: p.ceiling,
        topUsers: Object.entries(p.byUser)
          .filter(([u]) => u !== hidden)
          .sort(([ua, a], [ub, c]) => c - a || (ua < ub ? -1 : 1))
          .slice(0, TOP_USERS)
          .map(([userId, running]) => ({ userId, email: b.profiles.get(userId)?.email ?? null, running })),
        completed15m: p.completed15m,
        failed15m: p.failed15m,
        failureRate15m: outcomes > 0 ? p.failed15m / outcomes : null,
      }
    })
    const startedAt = b.published.startedAt
    return {
      checkedAt: new Date(b.at).toISOString(),
      env: this.deps.env(),
      enforced: b.snap.enforced,
      available: this.deps.available(),
      totals: {
        activeUsers: new Set(lines.map((l) => l.userId)).size,
        running: lines.reduce((n, l) => n + sum(l, "running"), 0),
        queued: lines.reduce((n, l) => n + sum(l, "queued"), 0),
        overLimit: lines.reduce((n, l) => n + sum(l, "overLimit"), 0),
        longestWaitMs: lines.reduce((n, l) => Math.max(n, l.oldestWaitMs), 0),
      },
      lines,
      providers,
      servers: b.published.servers,
      ungated: { ...b.published.ungated, ...b.snap.ungated },
      notLimited: { ...b.published.notLimited, ...b.snap.notLimited },
      failOpen: { ...b.published.failOpen },
      counters: {
        processes: startedAt.length,
        oldestStartedAt: startedAt.length > 0 ? new Date(Math.min(...startedAt)).toISOString() : null,
        newestStartedAt: startedAt.length > 0 ? new Date(Math.max(...startedAt)).toISOString() : null,
      },
      serversComplete: b.published.complete,
      undeclaredPluginTypes: this.deps.undeclaredPluginTypes(),
    }
  }
}
