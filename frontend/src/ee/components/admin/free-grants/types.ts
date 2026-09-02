/**
 * Wire types and labels shared by the free-grant admin surfaces.
 *
 * These mirror the shapes returned by `GET /v1/admin/free-grants`,
 * `…/clusters` and `…/:userId/related` exactly — a field the backend never
 * sends must not be optional here, and a field it always sends (like
 * `unavailable`) must not be optional either.
 */

export type ClusterAxis = "device" | "browser" | "ip"

export interface FreeGrantRow {
  userId: string
  email: string | null
  fullName: string | null
  createdAt: string
  subscriptionCredits: number
  state: "withheld" | "granted" | "unclaimed"
  reasons: string[]
  decidedAt: string | null
}

export interface ClusterMember {
  userId: string
  email: string | null
  fullName: string | null
  /** `null` when the account's profile row is gone — render `—`, not an empty badge. */
  state: string | null
  subscriptionCredits: number
  signalAt: string | null
  reasons: string[]
}

export interface Cluster {
  keyPrefix: string
  /** The TRUE size. The RPC caps `members` at 25, so this may exceed it. */
  memberCount: number
  firstSeenAt: string
  lastSeenAt: string
  members: ClusterMember[]
}

export interface ClustersResponse {
  data: Cluster[]
  total: number
  /** Echoed back so a fast tab-switch can discard a stale response. */
  axis: ClusterAxis
  /** True while migration 373 has not reached this database yet. */
  unavailable: boolean
}

export interface RelatedAccount extends ClusterMember {
  matches: ClusterAxis[]
}

export interface RelatedSignal {
  browserKeyPrefix: string | null
  deviceKeyPrefix: string | null
  ipHashPrefix: string
  signalAt: string
}

export interface RelatedResponse {
  data: {
    userId: string
    signal: RelatedSignal | null
    related: RelatedAccount[]
    /** True when an axis hit its server-side cap — the list is a sample, not the set. */
    truncated: boolean
  }
}

export const REASON_LABELS: Record<string, string> = {
  email_only_provider: "Email/password only (no Google)",
  browser_match: "Same browser as another account",
  device_ip_match: "Same device + network as another account",
  device_cluster: "Device signature shared by several accounts",
  ip_velocity: "Signup burst from one network",
}

export const AXES: ReadonlyArray<{ value: ClusterAxis; label: string }> = [
  { value: "device", label: "Device" },
  { value: "browser", label: "Browser" },
  { value: "ip", label: "Network" },
]

export const MATCH_LABELS: Record<ClusterAxis, string> = {
  device: "Device",
  browser: "Browser",
  ip: "Network",
}

export const PAGE_LIMIT = 50
