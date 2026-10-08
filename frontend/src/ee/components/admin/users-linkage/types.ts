/**
 * Wire types for `GET /v1/admin/users/linkage` and `…/linkage/cluster`,
 * mirrored from backend/src/ee/routes/admin-users-linkage.ts exactly — a field
 * the backend never sends must not be optional here, and one it always sends
 * (like `unavailable`) must not be optional either.
 */

export type LinkageAxis = "device" | "browser" | "ip"
export type SizeTier = "large" | "medium" | "small"

export interface LinkageSignal {
  readonly token: string
  /** Accounts holding this key, this one included; 1 means unique. */
  readonly count: number
}

export interface LinkageUser {
  /** The display number of the account's cluster in THIS response, or null. */
  readonly clusterId: number | null
  /** null when the account has no claim-time signal row at all. */
  readonly signals: Readonly<Record<LinkageAxis, LinkageSignal | null>> | null
  readonly decision: string | null
  readonly reasons: readonly string[]
  readonly signalAt: string | null
}

export interface LinkageKey {
  readonly axis: LinkageAxis
  readonly token: string
  readonly count: number
}

export interface LinkageCluster {
  /** The cluster's identity across requests. Select, pin and fetch by this. */
  readonly key: string
  /** Display order by size — the "#n". It can shift when a cluster grows. */
  readonly id: number
  /** The true size; the cap can leave `unresolved` of them unnamed. */
  readonly size: number
  readonly unresolved: number
  readonly tier: SizeTier
  readonly firstSeenAt: string
  readonly lastSeenAt: string
  readonly withheld: number
  readonly granted: number
  readonly keys: readonly LinkageKey[]
}

export interface LinkageSummary {
  readonly clusters: number
  readonly accounts: number
  readonly withheld: number
  readonly granted: number
}

export interface LinkageResponse {
  /** True while migration 373 has not reached this database: render the page unmarked. */
  readonly unavailable: boolean
  /** True when an axis had more clusters than the route walks; the newest are here. */
  readonly partial: boolean
  readonly summary: LinkageSummary
  readonly clusters: readonly LinkageCluster[]
  readonly users: Readonly<Record<string, LinkageUser>>
}

export interface LinkageMember {
  readonly userId: string
  readonly email: string | null
  readonly state: string | null
  /** The block route refuses admins; the panel skips them up front. */
  readonly role: string | null
}

/** One cluster's members, read when the admin opens it. */
export interface ClusterMembers {
  readonly key: string
  readonly id: number
  readonly size: number
  readonly unresolved: number
  readonly members: readonly LinkageMember[]
}

export type UsersById = Readonly<Record<string, LinkageUser>>

export const AXES: readonly LinkageAxis[] = ["device", "browser", "ip"]

export const AXIS_LABELS: Readonly<Record<LinkageAxis, string>> = {
  device: "Device",
  browser: "Browser",
  ip: "Network",
}

export const TIERS: ReadonlyArray<{ readonly tier: SizeTier; readonly label: string }> = [
  { tier: "large", label: "≥10 accounts" },
  { tier: "medium", label: "5–9" },
  { tier: "small", label: "2–4" },
]

/** What the admin is pointing at: a flagged row, one key, or one cluster (by its display number, within one response). */
export type ActiveTarget =
  | { readonly type: "account"; readonly userId: string }
  | { readonly type: "key"; readonly axis: LinkageAxis; readonly token: string }
  | { readonly type: "cluster"; readonly clusterId: number }

/** A row pill shows this many characters of a token; the full token is its title. */
export const PILL_CHARS = 4
/** A key chip in the cluster card shows this many. */
export const CHIP_CHARS = 8
/** Cluster pills shown inline before the rest fold into the menu. */
export const INLINE_PILLS = 6
/** The block route's own limit (ADMIN_WRITE_LIMIT): past this a run pauses for the limit. */
export const BLOCKS_PER_MINUTE = 30
