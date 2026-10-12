/**
 * The Users page's map view: every cluster drawn as one person at a desk with
 * a screen per account, and the newest unlinked accounts at single desks.
 * Pure assembly — the route reads the rows; this decides what is drawn.
 *
 * BOUNDED BY DESIGN. A network cluster can hold a thousand accounts, and a
 * screen per account would freeze the tab: the map draws the largest
 * `MAP_CLUSTERS` clusters and at most `MAP_MEMBERS` screens each, and says how
 * many it left out (`hidden`). The table remains the complete view.
 */

/** Clusters drawn, largest first (the linkage's own "#n" order). */
export const MAP_CLUSTERS = 40
/** Screens per cluster; the rest are counted, never drawn. */
export const MAP_MEMBERS = 36
/** Newest accounts that belong to no cluster. */
export const MAP_SINGLES = 45
/** Profiles read to find `MAP_SINGLES` unlinked ones among the newest. */
export const MAP_SINGLES_SCAN = 150

export type MapAxis = "device" | "browser" | "ip"

export interface MapAccount {
  userId: string
  email: string | null
  /** profiles.free_grant_state: unclaimed | granted | withheld | revoked, or null. */
  state: string | null
  role: string | null
  createdAt: string | null
  /** The account's own keys as tokens; null when it has no claim-time signal row. */
  keys: Record<MapAxis, string | null> | null
}

export interface MapCluster {
  key: string
  id: number
  size: number
  firstSeenAt: string
  lastSeenAt: string
  /** The keys that joined the cluster, as tokens, with how many accounts hold each. */
  keys: Array<{ axis: MapAxis; token: string; count: number }>
  /** Drawn members, by sign-up order. */
  members: MapAccount[]
  /** Members not drawn: past the screen cap, or unnamed by the clusters RPC. */
  hidden: number
}

export interface UsersMapResponse {
  unavailable: boolean
  partial: boolean
  clusters: MapCluster[]
  singles: MapAccount[]
  /** Accounts with a run waiting or in progress right now. */
  generating: string[]
}

export const EMPTY_MAP: UsersMapResponse = { unavailable: true, partial: false, clusters: [], singles: [], generating: [] }

/** Oldest first; an account with no known time goes last, ties by id so the order is stable. */
export function bySignup(a: MapAccount, b: MapAccount): number {
  if (a.createdAt === b.createdAt) return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
  if (a.createdAt === null) return 1
  if (b.createdAt === null) return -1
  return a.createdAt < b.createdAt ? -1 : 1
}

/** The ids a cluster draws: the first `MAP_MEMBERS` of its known members. */
export function drawnIds(knownIds: readonly string[]): string[] {
  return knownIds.slice(0, MAP_MEMBERS)
}

/** The newest profiles that belong to no cluster, newest first, capped. */
export function pickSingles(newest: readonly MapAccount[], clustered: ReadonlySet<string>): MapAccount[] {
  return newest.filter((a) => !clustered.has(a.userId)).slice(0, MAP_SINGLES)
}
