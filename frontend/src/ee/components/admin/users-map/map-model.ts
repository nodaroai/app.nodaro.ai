import type { MapAccount, MapAxis, MapCluster, UsersMapResponse } from "./types"

/**
 * What the map draws, as plain data: each account's state, activity and the
 * links that tied it to its cluster, and each cluster's place on the floor.
 * The 3D world and the panels read only this, so the rules live in one place.
 */

export type AccountState = "granted" | "withheld" | "revoked" | "blocked" | "unclaimed"
export type LinkType = "browser" | "device" | "network"
export type Activity = "offline" | "online" | "generating"
export type ShowFilter = "all" | "suspects" | "legit" | "blocked"

export interface StateMeta {
  readonly label: string
  /** The swatch and screen colour. */
  readonly dot: string
  readonly desc: string
}

/** Order of every legend, bar and filter. */
export const STATE_KEYS: readonly AccountState[] = ["granted", "withheld", "revoked", "blocked", "unclaimed"]

export const STATES: Readonly<Record<AccountState, StateMeta>> = {
  granted: { label: "Granted", dot: "#3fb36b", desc: "Looked new at sign-up and received the free credits." },
  withheld: {
    label: "Withheld",
    dot: "#9aa5bb",
    desc: "Looked like a returning user. The account works without the free credits; a purchase unlocks them.",
  },
  revoked: { label: "Taken back", dot: "#e0584f", desc: "An admin took the free credits back." },
  blocked: { label: "Blocked", dot: "#8b6ad8", desc: "An admin blocked the account." },
  unclaimed: { label: "Not claimed", dot: "#c3cad8", desc: "Has not claimed the free credits." },
}

export interface LinkMeta {
  readonly key: LinkType
  readonly axis: MapAxis
  readonly label: string
  readonly short: string
  readonly border: string
  readonly color: string
}

export const LINKS: readonly LinkMeta[] = [
  { key: "browser", axis: "browser", label: "Same browser", short: "Browser", border: "3px solid", color: "#6f95ec" },
  { key: "device", axis: "device", label: "Same device", short: "Device", border: "3px solid", color: "var(--um-dev)" },
  { key: "network", axis: "ip", label: "Same network", short: "Network", border: "3px dashed", color: "#8fb0f0" },
]

export const ACTIVITY: Readonly<Record<Activity, { label: string; dot: string }>> = {
  offline: { label: "Offline", dot: "#c3cad8" },
  online: { label: "Online", dot: "#3fb36b" },
  generating: { label: "Generating now", dot: "#3b6fe0" },
}

export const HUES = ["#e8743b", "#d64fa0", "#3b9be8", "#2bb5a0", "#c9a227", "#e05a6a", "#5a6be0"] as const

export interface Acct {
  readonly id: string
  readonly email: string
  readonly role: string | null
  readonly state: AccountState
  readonly act: Activity
  /** The cluster's key, or null for a single desk. */
  readonly cluster: string | null
  readonly fired: readonly LinkType[]
  /** Sign-up time in ms; null when unknown. */
  readonly t: number | null
  readonly keys: MapAccount["keys"]
}

export interface ClusterView {
  readonly key: string
  readonly id: number
  readonly hue: string
  readonly size: number
  readonly hidden: number
  readonly links: readonly LinkType[]
  readonly keys: MapCluster["keys"]
  readonly members: readonly Acct[]
  readonly counts: Readonly<Record<AccountState, number>>
  readonly firstSeenAt: string
  readonly lastSeenAt: string
}

export interface MapModel {
  readonly clusters: readonly ClusterView[]
  readonly singles: readonly Acct[]
  readonly accounts: readonly Acct[]
  readonly byId: ReadonlyMap<string, Acct>
  readonly clusterByKey: ReadonlyMap<string, ClusterView>
}

const linkOfAxis = (axis: MapAxis): LinkType => (axis === "ip" ? "network" : axis)

export function accountState(a: MapAccount, blocked: ReadonlySet<string>): AccountState {
  if (blocked.has(a.userId)) return "blocked"
  if (a.state === "granted" || a.state === "withheld" || a.state === "revoked") return a.state
  return "unclaimed"
}

/** The links that tie this account to the cluster: its own key on an axis equals one of the cluster's keys. */
export function firedLinks(a: MapAccount, cluster: MapCluster): LinkType[] {
  if (!a.keys) return []
  const keys = a.keys
  return LINKS.filter((l) => {
    const own = keys[l.axis]
    return own !== null && cluster.keys.some((k) => k.axis === l.axis && k.token === own)
  }).map((l) => l.key)
}

export function emptyCounts(): Record<AccountState, number> {
  return { granted: 0, withheld: 0, revoked: 0, blocked: 0, unclaimed: 0 }
}

export function countStates(accts: readonly Acct[]): Record<AccountState, number> {
  return accts.reduce((c, a) => ({ ...c, [a.state]: c[a.state] + 1 }), emptyCounts())
}

const timeOf = (iso: string | null): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

export function buildMapModel(
  data: UsersMapResponse,
  blocked: ReadonlySet<string>,
  online: ReadonlySet<string>,
): MapModel {
  const busy = new Set(data.generating)
  const activity = (id: string): Activity => (busy.has(id) ? "generating" : online.has(id) ? "online" : "offline")
  const toAcct = (a: MapAccount, cluster: MapCluster | null): Acct => ({
    id: a.userId,
    email: a.email ?? a.userId,
    role: a.role,
    state: accountState(a, blocked),
    act: activity(a.userId),
    cluster: cluster?.key ?? null,
    fired: cluster ? firedLinks(a, cluster) : [],
    t: timeOf(a.createdAt),
    keys: a.keys,
  })
  const clusters = data.clusters.map((c, i): ClusterView => {
    const members = c.members.map((m) => toAcct(m, c))
    return {
      key: c.key,
      id: c.id,
      hue: HUES[i % HUES.length]!,
      size: c.size,
      hidden: c.hidden,
      links: [...new Set(c.keys.map((k) => linkOfAxis(k.axis)))],
      keys: c.keys,
      members,
      counts: countStates(members),
      firstSeenAt: c.firstSeenAt,
      lastSeenAt: c.lastSeenAt,
    }
  })
  const singles = data.singles.map((s) => toAcct(s, null))
  const accounts = [...clusters.flatMap((c) => c.members), ...singles]
  return {
    clusters,
    singles,
    accounts,
    byId: new Map(accounts.map((a) => [a.id, a])),
    clusterByKey: new Map(clusters.map((c) => [c.key, c])),
  }
}

/** "Device + Network" — what joined the cluster. */
export function linkSummary(links: readonly LinkType[]): string {
  return LINKS.filter((l) => links.includes(l.key))
    .map((l) => l.short)
    .join(" + ")
}

/** "2 days", "5 hours", "10 minutes" — how long the cluster took to open. */
export function formatSpan(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 90) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hours`
  return `${Math.round(hours / 24)} days`
}

export type Focus = { readonly type: "account"; readonly id: string } | { readonly type: "cluster"; readonly key: string } | null

/**
 * What a search should fly to: the one account it names, or the one
 * cluster every hit sits in (a domain, a "#n"). Hits spread over several
 * desks, or none, focus nothing — the dimming says what matched.
 */
export function focusForQuery(model: MapModel, query: string): Focus {
  const q = query.trim()
  if (!q) return null
  const hits = model.accounts.filter((a) => matchesQuery(a, a.cluster ? (model.clusterByKey.get(a.cluster) ?? null) : null, q))
  if (hits.length === 0) return null
  if (hits.length === 1) return { type: "account", id: hits[0]!.id }
  const first = hits[0]!.cluster
  return first && hits.every((h) => h.cluster === first) ? { type: "cluster", key: first } : null
}

/** How long a sign-up counts as "just arrived" on the floor. */
export const FRESH_WINDOW_MS = 60 * 60_000

/** 1 for a sign-up this instant, fading to 0 at the window's end; 0 with no time. */
export function freshnessOf(t: number | null, now: number, windowMs: number = FRESH_WINDOW_MS): number {
  if (t === null) return 0
  const age = now - t
  if (age <= 0) return 1
  if (age >= windowMs) return 0
  return 1 - age / windowMs
}

export function matchesQuery(a: Acct, cluster: ClusterView | null, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (a.email.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)) return true
  return cluster !== null && `#${cluster.id}` === (q.startsWith("#") ? q : `#${q}`)
}

export interface DimContext {
  readonly selectedCluster: string | null
  readonly link: LinkType | null
  readonly query: string
  readonly show: ShowFilter
  readonly clusterByKey: ReadonlyMap<string, ClusterView>
}

/** 1 = lit; lower = dimmed. Never 0: a dimmed screen is still there to click. */
export function opacityOf(a: Acct, ctx: DimContext): number {
  let op = 1
  if (ctx.selectedCluster && a.cluster !== ctx.selectedCluster) op = 0.5
  if (ctx.link && a.cluster && !a.fired.includes(ctx.link)) op = Math.min(op, 0.3)
  const cluster = a.cluster ? (ctx.clusterByKey.get(a.cluster) ?? null) : null
  if (ctx.query && !matchesQuery(a, cluster, ctx.query)) op = 0.22
  if (ctx.show === "blocked" && a.state !== "blocked") op = Math.min(op, 0.3)
  return op
}

/** Whether a cluster's desk is shown under the filter. */
export function clusterVisible(c: ClusterView, show: ShowFilter): boolean {
  if (show === "legit") return false
  if (show === "blocked") return c.members.some((m) => m.state === "blocked")
  return true
}

export const singlesVisible = (show: ShowFilter): boolean => show === "all" || show === "legit"
