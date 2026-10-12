/**
 * Wire types for `GET /v1/admin/users/linkage/map`, mirrored from
 * backend/src/ee/lib/users-map.ts exactly — a field the backend always sends
 * is never optional here.
 */

export type MapAxis = "device" | "browser" | "ip"

export interface MapAccount {
  readonly userId: string
  readonly email: string | null
  /** profiles.free_grant_state: unclaimed | granted | withheld | revoked, or null. */
  readonly state: string | null
  readonly role: string | null
  readonly createdAt: string | null
  /** The account's own keys as tokens; null when it has no claim-time signal row. */
  readonly keys: Readonly<Record<MapAxis, string | null>> | null
}

export interface MapClusterKey {
  readonly axis: MapAxis
  readonly token: string
  readonly count: number
}

export interface MapCluster {
  /** Identity across requests — select by this, never by `id`. */
  readonly key: string
  /** The "#n": display order by size, shared with the table's toolbar. */
  readonly id: number
  readonly size: number
  readonly firstSeenAt: string
  readonly lastSeenAt: string
  readonly keys: readonly MapClusterKey[]
  /** Drawn members, by sign-up order. */
  readonly members: readonly MapAccount[]
  /** Members not drawn: past the screen cap, or unnamed by the clusters RPC. */
  readonly hidden: number
}

export interface UsersMapResponse {
  /** True while the clusters function is not on this database: the map has nothing to draw. */
  readonly unavailable: boolean
  readonly partial: boolean
  readonly clusters: readonly MapCluster[]
  readonly singles: readonly MapAccount[]
  /** Accounts with a run waiting or in progress right now. */
  readonly generating: readonly string[]
}
