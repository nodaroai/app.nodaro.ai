import { supabase } from "../../lib/supabase.js"
import { surfaceLabel, type OnlineUsersLookup } from "./online-users.js"
import type { PresenceSource } from "./presence.js"

/**
 * The admin's "Surfaces used": the surfaces each account has used, from
 * `user_surfaces` (migration 607) — the durable sibling of "Signed in now"
 * (online-users.ts), which forgets after fifteen minutes. One row per account
 * and surface, the latest first, each with the person's name and email and
 * the surface's label. A kind of caller, and the account this admin may not
 * see, are left out by the read itself: only the newest rows are read, and
 * the web rows alone would soon push every extension row past the cap of a
 * "read everything, filter here" list — and a count is only right when the
 * database applies the same conditions.
 */

/** Every column read; `user-surfaces-columns.test.ts` checks each exists. */
export const USER_SURFACE_COLUMNS = "user_id, source, detail, first_seen_at, last_seen_at, touches"

/** How many rows one answer carries at most: the newest. */
export const USER_SURFACES_LIMIT = 500

/** A row as the table holds it (`detail` is '' where there is nothing more to say). */
export interface UserSurfaceRecord {
  readonly user_id: string
  readonly source: PresenceSource
  readonly detail: string
  readonly first_seen_at: string
  readonly last_seen_at: string
  readonly touches: number
}

export interface UserSurfacesQuery {
  readonly source: PresenceSource | null
  /** An account left out of the rows and the count (the deployment's payer, to anyone but itself). */
  readonly hiddenUserId: string | null
  readonly limit: number
}

/**
 * The newest rows the query admits, how many such rows there are in all, and
 * when recording began — the oldest first sighting of anyone, null while the
 * table is empty.
 */
export type UserSurfacesRead = (query: UserSurfacesQuery) => Promise<{ rows: readonly UserSurfaceRecord[]; total: number; recordedSince: string | null }>

export interface UserSurfaceRow {
  readonly userId: string
  readonly email: string | null
  readonly name: string | null
  readonly source: PresenceSource
  /** A host, an app id, an MCP client, a client version; null for a bare API call. */
  readonly detail: string | null
  /** What the page shows: APP, STUDIO, EXT, CLI, "MCP · Claude", a developer app's name. */
  readonly label: string
  readonly firstSeenAt: string
  readonly lastSeenAt: string
  /** The server's hourly touches, not requests (user-surfaces.ts). */
  readonly touches: number
}

export interface UserSurfacesReport {
  readonly checkedAt: string
  readonly source: PresenceSource | null
  /** When recording began: the oldest first sighting in the table; null while it is empty. */
  readonly recordedSince: string | null
  /** One per account and surface, the latest first. */
  readonly rows: readonly UserSurfaceRow[]
  /** Distinct accounts among `rows`. */
  readonly people: number
  /** Rows matching the query in all; `rows` holds the newest of them. */
  readonly total: number
  readonly truncated: boolean
}

export async function listUserSurfaces(opts: {
  readonly read: UserSurfacesRead
  readonly lookup: OnlineUsersLookup
  readonly source: PresenceSource | null
  /** An account this caller may not see (the deployment's payer, to anyone but itself). */
  readonly hiddenUserId?: string | null
  readonly limit?: number
  readonly now?: () => number
  /** Told when names cannot be read. The list still answers, with bare ids
   *  in their place, so the failure must reach the log. */
  readonly onLookupError?: (what: "profiles" | "apps", error: unknown) => void
}): Promise<UserSurfacesReport> {
  const checkedAt = new Date((opts.now ?? Date.now)()).toISOString()
  const read = await opts.read({ source: opts.source, hiddenUserId: opts.hiddenUserId ?? null, limit: opts.limit ?? USER_SURFACES_LIMIT })
  const userIds = [...new Set(read.rows.map((record) => record.user_id))]
  const appIds = [...new Set(read.rows.filter((record) => record.source === "app" && record.detail !== "").map((record) => record.detail))]

  const [profiles, apps] = await Promise.all([
    userIds.length > 0
      ? opts.lookup.profiles(userIds).catch((error: unknown) => {
          opts.onLookupError?.("profiles", error)
          return new Map<string, { email: string | null; name: string | null }>()
        })
      : new Map<string, { email: string | null; name: string | null }>(),
    appIds.length > 0
      ? opts.lookup.apps(appIds).catch((error: unknown) => {
          opts.onLookupError?.("apps", error)
          return new Map<string, { name: string; mcp: boolean }>()
        })
      : new Map<string, { name: string; mcp: boolean }>(),
  ])

  const rows = read.rows.map((record): UserSurfaceRow => {
    const detail = record.detail === "" ? null : record.detail
    const profile = profiles.get(record.user_id)
    return {
      userId: record.user_id,
      email: profile?.email ?? null,
      name: profile?.name ?? null,
      source: record.source,
      detail,
      label: surfaceLabel(record.source, detail, record.source === "app" && detail ? apps.get(detail) : undefined),
      firstSeenAt: record.first_seen_at,
      lastSeenAt: record.last_seen_at,
      touches: record.touches,
    }
  })
  return {
    checkedAt,
    source: opts.source,
    recordedSince: read.recordedSince,
    rows,
    people: userIds.length,
    total: read.total,
    truncated: read.total > read.rows.length,
  }
}

/** The table, read with the service role — the route is admin-only. The rows
 *  come newest first; the count is of every row the query admits; the oldest
 *  first sighting of anyone says when recording began. */
export const databaseUserSurfacesRead: UserSurfacesRead = async ({ source, hiddenUserId, limit }) => {
  const every = supabase.from("user_surfaces").select(USER_SURFACE_COLUMNS, { count: "exact" })
  const ofKind = source ? every.eq("source", source) : every
  const shown = hiddenUserId ? ofKind.neq("user_id", hiddenUserId) : ofKind
  const [newest, oldest] = await Promise.all([
    shown.order("last_seen_at", { ascending: false }).limit(limit),
    supabase.from("user_surfaces").select("first_seen_at").order("first_seen_at", { ascending: true }).limit(1),
  ])
  // PostgREST's error is a plain object; the route reports an Error's message.
  if (newest.error) throw new Error(newest.error.message)
  if (oldest.error) throw new Error(oldest.error.message)
  const rows = (newest.data ?? []) as unknown as UserSurfaceRecord[]
  const first = (oldest.data ?? []) as unknown as Array<{ first_seen_at: string }>
  return { rows, total: newest.count ?? rows.length, recordedSince: first[0]?.first_seen_at ?? null }
}
