import {
  AXES,
  AXIS_LABELS,
  CHIP_CHARS,
  type ActiveTarget,
  type LinkageAxis,
  type LinkageCluster,
  type LinkageMember,
  type LinkageSummary,
  type LinkageUser,
  type UsersById,
} from "./types"

/**
 * The marking's rules, as values: which rows light up for what the admin
 * points at, which rows a filter keeps, what the chips say, who a cluster
 * block targets. Pure, so the page test can pin the wiring and this file's
 * test can pin the rules.
 */

export const isFlagged = (user: LinkageUser | undefined): boolean => (user?.clusterId ?? null) !== null

const tokenOf = (user: LinkageUser | undefined, axis: LinkageAxis): string | null =>
  user?.signals?.[axis]?.token ?? null

export function sameTarget(a: ActiveTarget, b: ActiveTarget): boolean {
  if (a.type !== b.type) return false
  if (a.type === "account" && b.type === "account") return a.userId === b.userId
  if (a.type === "cluster" && b.type === "cluster") return a.clusterId === b.clusterId
  if (a.type === "key" && b.type === "key") return a.axis === b.axis && a.token === b.token
  return false
}

/**
 * The axes on which `userId` is linked to what the admin points at. For a
 * cluster, only the keys somebody else actually holds — a member's unique
 * browser key is not evidence.
 */
export function sharedAxes(active: ActiveTarget | null, userId: string, users: UsersById): readonly LinkageAxis[] {
  if (!active) return []
  const user = users[userId]
  if (!user) return []
  switch (active.type) {
    case "key":
      return tokenOf(user, active.axis) === active.token ? [active.axis] : []
    case "cluster":
      return user.clusterId === active.clusterId ? AXES.filter((axis) => (user.signals?.[axis]?.count ?? 0) > 1) : []
    case "account": {
      if (active.userId === userId) return []
      const other = users[active.userId]
      return AXES.filter((axis) => {
        const token = tokenOf(user, axis)
        return token !== null && token === tokenOf(other, axis)
      })
    }
  }
}

/** A cluster pill lights up every member, keys or not. */
export function isLinked(active: ActiveTarget | null, userId: string, users: UsersById): boolean {
  if (!active) return false
  if (active.type === "cluster") return users[userId]?.clusterId === active.clusterId
  return sharedAxes(active, userId, users).length > 0
}

export const isActiveAccount = (active: ActiveTarget | null, userId: string): boolean =>
  active?.type === "account" && active.userId === userId

export function sharedLabel(active: ActiveTarget, axes: readonly LinkageAxis[]): string {
  const names = axes.map((axis) => AXIS_LABELS[axis].toLowerCase()).join(" + ")
  if (active.type === "cluster") return names ? `same cluster · ${names}` : "same cluster"
  return `shares ${names}`
}

/**
 * The rows that are not part of what the admin points at step back a little —
 * only when the pointer is on a key, a cluster or a flagged row. Pointing at a
 * clean row changes nothing.
 */
export function shouldDim(active: ActiveTarget | null, userId: string, users: UsersById): boolean {
  if (!active) return false
  if (isActiveAccount(active, userId) || isLinked(active, userId, users)) return false
  if (active.type === "account") return isFlagged(users[active.userId])
  return true
}

export type RowTone = "none" | "tint" | "linked" | "active"

export function rowTone(flagged: boolean, linked: boolean, activeSelf: boolean): RowTone {
  if (activeSelf) return "active"
  if (linked) return "linked"
  return flagged ? "tint" : "none"
}

/** A row pill fills in when it IS the pointed-at key, or holds the key the pointed-at row holds. */
export function isPillHot(
  active: ActiveTarget | null,
  userId: string,
  axis: LinkageAxis,
  token: string,
  users: UsersById,
): boolean {
  if (!active) return false
  if (active.type === "key") return active.axis === axis && active.token === token
  if (active.type === "account") return active.userId !== userId && tokenOf(users[active.userId], axis) === token
  return false
}

/** A cluster pill lights up when the pointer is on it, on one of its members, or on a key one of them holds. */
export function isClusterHot(active: ActiveTarget | null, cluster: LinkageCluster, users: UsersById): boolean {
  if (!active) return false
  switch (active.type) {
    case "cluster":
      return active.clusterId === cluster.id
    case "account":
      return users[active.userId]?.clusterId === cluster.id
    case "key":
      return (
        cluster.keys.some((k) => k.axis === active.axis && k.token === active.token) ||
        Object.values(users).some((u) => u.clusterId === cluster.id && tokenOf(u, active.axis) === active.token)
      )
  }
}

export interface RowFilters {
  readonly onlyFlagged: boolean
  readonly clusterId: number | null
}

/** The marking's own filters; the text search runs on the server and never touches this. */
export function visibleUsers<T extends { readonly id: string }>(rows: readonly T[], users: UsersById, filters: RowFilters): T[] {
  return rows.filter((row) => {
    const mark = users[row.id]
    if (filters.onlyFlagged && !isFlagged(mark)) return false
    if (filters.clusterId !== null && mark?.clusterId !== filters.clusterId) return false
    return true
  })
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function summaryLine(summary: LinkageSummary): string {
  if (summary.clusters === 0) return "No linked accounts found."
  return `${plural(summary.clusters, "cluster", "clusters")} · ${plural(summary.accounts, "account", "accounts")} · ${summary.withheld} withheld · ${summary.granted} granted`
}

export function formatWhen(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
}

/** "date hh:mm–hh:mm" within one day, both ends dated otherwise. */
export function clusterSpan(cluster: Pick<LinkageCluster, "firstSeenAt" | "lastSeenAt">): string {
  const first = new Date(cluster.firstSeenAt)
  const last = new Date(cluster.lastSeenAt)
  const time = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  if (first.toDateString() === last.toDateString()) return `${first.toLocaleDateString()} ${time(first)}–${time(last)}`
  return `${formatWhen(cluster.firstSeenAt)} – ${formatWhen(cluster.lastSeenAt)}`
}

export function detailSubline(cluster: LinkageCluster, onPage: number): string {
  const parts = [
    clusterSpan(cluster),
    `${cluster.withheld} withheld`,
    `${cluster.granted} granted`,
    `${onPage} on this page`,
    ...(cluster.unresolved > 0 ? [`${cluster.unresolved} not listed`] : []),
  ]
  return parts.join(" · ")
}

/** What a key's count means; after a partial walk a count of one proves nothing. */
export function sharedText(count: number, partial = false): string {
  if (count <= 1) return partial ? "not checked (too many clusters)" : "unique in system"
  return `shared with ${plural(count - 1, "other account", "other accounts")}`
}

export function gateLine(user: LinkageUser, cluster: LinkageCluster | null): string {
  const when = user.signalAt ? ` · ${formatWhen(user.signalAt)}` : ""
  const where = cluster ? ` · cluster #${cluster.id}` : ""
  if (user.decision === "withheld") return `Free credits withheld at signup${when}${where}`
  if (user.decision === "granted") {
    return user.reasons.length > 0
      ? `Free credits granted at signup${when}${where}`
      : `Free credits granted at signup — no matching signals${when}${where}`
  }
  return "No gate decision recorded for this account."
}

export const memberName = (member: LinkageMember): string => member.email ?? member.userId

export interface BlockPlan {
  /** Who the run will block, by email. */
  readonly targets: readonly LinkageMember[]
  readonly alreadyBlocked: number
  /** Admins and the viewer: the block route refuses them, so they are left out up front. */
  readonly admins: number
}

const isAdminRole = (role: string | null) => role === "admin" || role === "super_admin"

export function planBlock(members: readonly LinkageMember[], blockedIds: ReadonlySet<string>, viewerId: string): BlockPlan {
  const open = members.filter((m) => !blockedIds.has(m.userId))
  const protectedOnes = open.filter((m) => isAdminRole(m.role) || m.userId === viewerId)
  const targets = open
    .filter((m) => !protectedOnes.includes(m))
    .slice()
    .sort((a, b) => memberName(a).localeCompare(memberName(b)))
  return { targets, alreadyBlocked: members.length - open.length, admins: protectedOnes.length }
}

const REASON_MAX = 500

/** The block row's own explanation: which cluster, how big, joined by what. */
export function blockReason(cluster: LinkageCluster): string {
  const keys = cluster.keys
    .map((k) => `${AXIS_LABELS[k.axis].toLowerCase()} ${k.token.slice(0, CHIP_CHARS)} (${k.count})`)
    .join(", ")
  const text = `Linked-account cluster #${cluster.id}: ${cluster.size} accounts sharing ${keys}`
  return text.length > REASON_MAX ? `${text.slice(0, REASON_MAX - 1)}…` : text
}
