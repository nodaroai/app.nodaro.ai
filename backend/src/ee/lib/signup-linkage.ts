/**
 * Linked-account clusters for the admin Users page.
 *
 * The free-grants card answers one axis at a time: every device key two
 * accounts claimed from, then every browser profile, then every network. The
 * Users page asks the question the way an operator asks it — WHICH accounts
 * belong together, across all three axes at once. Two accounts on one device,
 * a third sharing the second's browser profile, a fourth on the third's
 * network: one cluster, one number, one colour.
 *
 * Pure on purpose. The route hands this the RPC's rows (and the signal rows of
 * the accounts on screen) and gets numbered clusters back; nothing here touches
 * supabase, so every rule below unit-tests without a mock.
 *
 * THE 25-ID CAP. `signup_signal_clusters` (migration 373) returns
 * `member_count` as the TRUE size of a key but `user_ids` capped at the 25
 * newest. A key shared by thirty accounts has five members no row can name.
 * Two consequences, both handled here: a cluster's `size` is the largest
 * member count among its keys (never less than the ids we can name), with the
 * difference reported as `unresolved`; and the accounts on the current page are
 * attached through THEIR OWN signal rows, so a row on screen is never shown as
 * clean merely because the cap hid it.
 *
 * NUMBER VERSUS IDENTITY. Clusters are numbered by size, then by first
 * sighting, then by their lowest key — a deterministic DISPLAY order: the same
 * rows always number the same way, and two clusters of equal size and age
 * cannot swap places. The number is not an identity, though: a cluster that
 * gains a member can move up the list. What identifies a cluster across
 * requests is its `anchorKey`, the lowest key it is built from; the route puts
 * a keyed token of it on the wire and the page selects by that, never by "#3".
 */

export type LinkageAxis = "device" | "browser" | "ip"

export const LINKAGE_AXES: readonly LinkageAxis[] = ["device", "browser", "ip"]

/** One RPC row, already lifted out of its snake_case and tagged with its axis. */
export interface AxisClusterRow {
  axis: LinkageAxis
  key: string
  memberCount: number
  firstSeenAt: string
  lastSeenAt: string
  userIds: readonly string[]
}

/** One account's own `signup_signals` row (source = 'claim'). */
export interface UserSignalRow {
  userId: string
  deviceKey: string | null
  browserKey: string | null
  ipHash: string | null
  decision: string | null
  reasons: readonly string[]
  createdAt: string
}

export type SizeTier = "large" | "medium" | "small"

export interface LinkageKey {
  axis: LinkageAxis
  key: string
  /** The key's true account count, as the RPC reported it. */
  count: number
}

export interface LinkageCluster {
  /** 1-based display order, by size then age then key — see the header. */
  id: number
  /** The cluster's identity across requests: the lowest of its keys. Never sent raw. */
  anchorKey: string
  /** The true size: at least the ids we can name, at most the biggest key. */
  size: number
  /** Members the RPC's cap left unnamed: `size - knownIds.length`. */
  unresolved: number
  tier: SizeTier
  firstSeenAt: string
  lastSeenAt: string
  knownIds: readonly string[]
  keys: readonly LinkageKey[]
}

export interface Linkage {
  clusters: readonly LinkageCluster[]
  clusterOfUser: ReadonlyMap<string, number>
}

const LARGE_FROM = 10
const MEDIUM_FROM = 5

export function sizeTier(size: number): SizeTier {
  if (size >= LARGE_FROM) return "large"
  if (size >= MEDIUM_FROM) return "medium"
  return "small"
}

const AXIS_ORDER: Record<LinkageAxis, number> = { device: 0, browser: 1, ip: 2 }

const keyNode = (axis: LinkageAxis, key: string) => `k:${axis}:${key}`
const userNode = (id: string) => `u:${id}`

/** The non-empty keys of one signal row, in axis order. */
export function signalKeys(signal: UserSignalRow): ReadonlyArray<readonly [LinkageAxis, string]> {
  const pairs: Array<readonly [LinkageAxis, string | null]> = [
    ["device", signal.deviceKey],
    ["browser", signal.browserKey],
    ["ip", signal.ipHash],
  ]
  return pairs.filter((p): p is readonly [LinkageAxis, string] => typeof p[1] === "string" && p[1] !== "")
}

/** `axis:key` → the key's true account count; a key not in the map is unique. */
export function keyCounts(rows: readonly AxisClusterRow[]): ReadonlyMap<string, number> {
  return new Map(rows.filter((r) => r.key !== "").map((r) => [`${r.axis}:${r.key}`, r.memberCount]))
}

export function countFor(counts: ReadonlyMap<string, number>, axis: LinkageAxis, key: string): number {
  return counts.get(`${axis}:${key}`) ?? 1
}

/** Disjoint sets over string nodes; path-compressing, union by assignment. */
class UnionFind {
  private readonly parent = new Map<string, string>()

  find(node: string): string {
    let root = node
    for (;;) {
      const up = this.parent.get(root)
      if (up === undefined || up === root) break
      root = up
    }
    let cursor = node
    while (cursor !== root) {
      const next = this.parent.get(cursor) ?? root
      this.parent.set(cursor, root)
      cursor = next
    }
    if (!this.parent.has(root)) this.parent.set(root, root)
    return root
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

interface Group {
  rows: AxisClusterRow[]
  ids: Set<string>
}

function groupFor(groups: Map<string, Group>, root: string): Group {
  const existing = groups.get(root)
  if (existing) return existing
  const fresh: Group = { rows: [], ids: new Set() }
  groups.set(root, fresh)
  return fresh
}

const compareKeys = (a: LinkageKey, b: LinkageKey): number =>
  b.count - a.count || AXIS_ORDER[a.axis] - AXIS_ORDER[b.axis] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

const time = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

type Unnumbered = Omit<LinkageCluster, "id">

function shape(group: Group): Unnumbered {
  const keys = group.rows.map((r): LinkageKey => ({ axis: r.axis, key: r.key, count: r.memberCount })).sort(compareKeys)
  const knownIds = [...group.ids].sort()
  const size = Math.max(knownIds.length, ...group.rows.map((r) => r.memberCount))
  const firstSeenAt = group.rows.reduce(
    (min, r) => (time(r.firstSeenAt) < time(min) ? r.firstSeenAt : min),
    group.rows[0]!.firstSeenAt,
  )
  const lastSeenAt = group.rows.reduce(
    (max, r) => (time(r.lastSeenAt) > time(max) ? r.lastSeenAt : max),
    group.rows[0]!.lastSeenAt,
  )
  const anchorKey = keys.reduce((min, k) => (k.key < min ? k.key : min), keys[0]!.key)
  return { anchorKey, size, unresolved: size - knownIds.length, tier: sizeTier(size), firstSeenAt, lastSeenAt, knownIds, keys }
}

const compareClusters = (a: Unnumbered, b: Unnumbered): number =>
  b.size - a.size ||
  time(a.firstSeenAt) - time(b.firstSeenAt) ||
  (a.anchorKey < b.anchorKey ? -1 : a.anchorKey > b.anchorKey ? 1 : 0)

/**
 * Connected components over "shares a key": every account in a row joins that
 * row's key, and an account in two rows joins the two keys. A page row joins a
 * key only when some other account already holds it — a key nobody shares is
 * not a cluster, so a page row with unique keys stays clean.
 */
export function buildLinkage(rows: readonly AxisClusterRow[], pageSignals: readonly UserSignalRow[] = []): Linkage {
  const keyed = rows.filter((r) => r.key !== "")
  const sets = new UnionFind()
  const rowOfNode = new Map<string, AxisClusterRow>()

  for (const row of keyed) {
    const node = keyNode(row.axis, row.key)
    rowOfNode.set(node, row)
    sets.find(node)
    for (const id of row.userIds) sets.union(userNode(id), node)
  }
  const attachments = pageSignals.flatMap((signal) =>
    signalKeys(signal)
      .map(([axis, value]) => keyNode(axis, value))
      .filter((node) => rowOfNode.has(node))
      .map((node) => ({ node, userId: signal.userId })),
  )
  for (const { node, userId } of attachments) sets.union(userNode(userId), node)

  const groups = new Map<string, Group>()
  for (const [node, row] of rowOfNode) {
    const group = groupFor(groups, sets.find(node))
    group.rows.push(row)
    for (const id of row.userIds) group.ids.add(id)
  }
  for (const { node, userId } of attachments) groupFor(groups, sets.find(node)).ids.add(userId)

  const clusters = [...groups.values()]
    .map(shape)
    .sort(compareClusters)
    .map((cluster, index): LinkageCluster => ({ id: index + 1, ...cluster }))

  const clusterOfUser = new Map<string, number>()
  for (const cluster of clusters) for (const id of cluster.knownIds) clusterOfUser.set(id, cluster.id)
  return { clusters, clusterOfUser }
}
