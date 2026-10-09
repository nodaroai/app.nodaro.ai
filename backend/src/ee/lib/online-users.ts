import { supabase } from "../../lib/supabase.js"
import { PRESENCE_WINDOW_MS, type PresenceEntry, type PresenceSource, type PresenceStore } from "./presence.js"

/**
 * The admin's "Signed in now": the presence notes of the last few minutes,
 * one row per person, each with the surfaces they have open.
 */

export interface OnlineSurface {
  readonly source: PresenceSource
  readonly detail: string | null
  /** What the page shows: APP, STUDIO, EXT, CLI, "MCP · Claude", a developer app's name. */
  readonly label: string
  readonly address: string | null
  readonly country: string | null
  readonly userAgent: string | null
  readonly lastSeenAt: string
}

export interface OnlineUser {
  readonly userId: string
  readonly email: string | null
  readonly name: string | null
  readonly lastSeenAt: string
  readonly surfaces: readonly OnlineSurface[]
}

export interface OnlineUsersReport {
  readonly windowMinutes: number
  readonly checkedAt: string
  /** False when the store could not be read — the list is then unknown, not empty. */
  readonly available: boolean
  readonly users: readonly OnlineUser[]
}

export interface OnlineUsersLookup {
  profiles(ids: readonly string[]): Promise<ReadonlyMap<string, { email: string | null; name: string | null }>>
  apps(ids: readonly string[]): Promise<ReadonlyMap<string, { name: string; mcp: boolean }>>
}

const NODARO = ".nodaro.ai"

/**
 * A surface's label, derived — never a host→name table, which a new
 * subdomain would silently miss (`job-source.ts` makes the same point): a web
 * host loses ".nodaro.ai" and its port (studio.nodaro.ai → STUDIO,
 * next.nodaro.ai → NEXT); any other host is shown as it is.
 */
export function surfaceLabel(source: PresenceSource, detail: string | null, app?: { name: string; mcp: boolean }): string {
  switch (source) {
    case "web": {
      const host = (detail ?? "").replace(/:\d+$/, "")
      if (!host) return "WEB"
      return host.endsWith(NODARO) ? host.slice(0, -NODARO.length).toUpperCase() : host
    }
    case "extension":
      return "EXT"
    case "app":
      // A developer app the lookup could not name is not the main app ("APP").
      return app ? (app.mcp ? `MCP · ${app.name}` : app.name) : "OAuth app"
    case "mcp":
      return detail ? `MCP · ${detail}` : "MCP"
    case "cli":
      return "CLI"
    case "sdk":
      return "SDK"
    case "api":
      return "API"
  }
}

const iso = (ms: number) => new Date(ms).toISOString()

export async function listOnlineUsers(opts: {
  readonly store: PresenceStore | null
  readonly lookup: OnlineUsersLookup
  /** An account this caller may not see (the deployment's payer, to anyone but itself). */
  readonly hiddenUserId?: string | null
  readonly now?: () => number
  readonly windowMs?: number
  /** Told when names cannot be read. The list still answers, with bare ids
   *  in their place, so the failure must reach the log. */
  readonly onLookupError?: (what: "profiles" | "apps", error: unknown) => void
}): Promise<OnlineUsersReport> {
  const now = (opts.now ?? Date.now)()
  const windowMs = opts.windowMs ?? PRESENCE_WINDOW_MS
  const head = { windowMinutes: windowMs / 60_000, checkedAt: iso(now) }
  let entries: PresenceEntry[]
  try {
    if (!opts.store) return { ...head, available: false, users: [] }
    entries = (await opts.store.since(now - windowMs)).filter((entry) => entry.userId !== opts.hiddenUserId)
  } catch {
    return { ...head, available: false, users: [] }
  }

  const byUser = new Map<string, PresenceEntry[]>()
  for (const entry of entries) {
    const seen = byUser.get(entry.userId)
    if (seen) seen.push(entry)
    else byUser.set(entry.userId, [entry])
  }
  const appIds = [...new Set(entries.filter((e) => e.source === "app" && e.detail).map((e) => e.detail!))]
  const [profiles, apps] = await Promise.all([
    opts.lookup.profiles([...byUser.keys()]).catch((error: unknown) => {
      opts.onLookupError?.("profiles", error)
      return new Map<string, { email: string | null; name: string | null }>()
    }),
    appIds.length > 0
      ? opts.lookup.apps(appIds).catch((error: unknown) => {
          opts.onLookupError?.("apps", error)
          return new Map<string, { name: string; mcp: boolean }>()
        })
      : new Map<string, { name: string; mcp: boolean }>(),
  ])

  const users = [...byUser.entries()].map(([userId, seen]): OnlineUser => {
    const surfaces = [...seen]
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map(
        (entry): OnlineSurface => ({
          source: entry.source,
          detail: entry.detail,
          label: surfaceLabel(entry.source, entry.detail, entry.source === "app" && entry.detail ? apps.get(entry.detail) : undefined),
          address: entry.address,
          country: entry.country,
          userAgent: entry.userAgent,
          lastSeenAt: iso(entry.lastSeenAt),
        }),
      )
    const profile = profiles.get(userId)
    return { userId, email: profile?.email ?? null, name: profile?.name ?? null, lastSeenAt: surfaces[0]!.lastSeenAt, surfaces }
  })
  users.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
  return { ...head, available: true, users }
}

/** Names from the database, read with the service role — the route is admin-only.
 *  Every column here must exist (`online-users-columns.test.ts`): one that does
 *  not fails the whole read, and the list falls back to bare ids. */
export const databaseLookup: OnlineUsersLookup = {
  async profiles(ids) {
    if (ids.length === 0) return new Map()
    const { data, error } = await supabase.from("profiles").select("id, email, full_name").in("id", [...ids])
    if (error) throw error
    const rows = (data ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>
    return new Map(rows.map((row) => [row.id, { email: row.email, name: row.full_name }]))
  },
  async apps(ids) {
    const { data, error } = await supabase.from("developer_apps").select("id, name, kind").in("id", [...ids])
    if (error) throw error
    const rows = (data ?? []) as Array<{ id: string; name: string; kind: string }>
    return new Map(rows.map((row) => [row.id, { name: row.name, mcp: row.kind === "dynamic_mcp" || row.kind === "first_party_mcp" }]))
  },
}
