/**
 * "Surfaces used": one row per account and surface, in the read's order
 * (newest first), each with its label, name and email; the kind asked for
 * and the hidden account go to the read itself, whose count is the one
 * answered; a list cut at the limit says so; names that cannot be read leave
 * the rows, unnamed; the database read's own shape.
 */
import { describe, expect, it, vi } from "vitest"
import type { OnlineUsersLookup } from "../online-users.js"
import { listUserSurfaces, USER_SURFACES_LIMIT, type UserSurfaceRecord, type UserSurfacesRead } from "../user-surfaces-list.js"

const NOW = Date.UTC(2026, 10, 10, 9, 0, 0)
const SINCE = "2026-11-08T18:00:14.708Z"

const record = (user_id: string, over: Partial<UserSurfaceRecord> = {}): UserSurfaceRecord => ({
  user_id,
  source: "web",
  detail: "app.nodaro.ai",
  first_seen_at: "2026-11-08T18:00:00.000Z",
  last_seen_at: "2026-11-10T08:00:00.000Z",
  touches: 3,
  ...over,
})

const readOf = (rows: UserSurfaceRecord[], total = rows.length, recordedSince: string | null = SINCE) =>
  vi.fn<UserSurfacesRead>(async () => ({ rows, total, recordedSince }))

const lookup: OnlineUsersLookup = {
  profiles: async (ids) => new Map(ids.map((id) => [id, { email: `${id}@example.com`, name: id.toUpperCase() }])),
  apps: async (ids) => new Map(ids.map((id) => [id, id === "claude" ? { name: "Claude", mcp: true } : { name: "Zapier", mcp: false }])),
}

describe("listUserSurfaces", () => {
  it("one row per account and surface, each labelled and named; an empty detail is none", async () => {
    const read = readOf([
      record("dana", { source: "extension", detail: "extension/ext.nodaro.ai@0.2.6", touches: 4 }),
      record("dana"),
      record("omer", { source: "app", detail: "claude" }),
      record("omer", { source: "app", detail: "zap" }),
      record("omer", { source: "api", detail: "", first_seen_at: "2026-11-08T18:32:00.000Z", last_seen_at: "2026-11-09T11:33:00.000Z", touches: 1 }),
    ])
    const report = await listUserSurfaces({ read, lookup, source: null, now: () => NOW })
    expect(read).toHaveBeenCalledWith({ source: null, hiddenUserId: null, limit: USER_SURFACES_LIMIT })
    expect(report).toMatchObject({ checkedAt: new Date(NOW).toISOString(), source: null, recordedSince: SINCE, people: 2, total: 5, truncated: false })
    expect(report.rows.map((row) => [row.userId, row.name, row.email, row.label, row.detail, row.touches])).toEqual([
      ["dana", "DANA", "dana@example.com", "EXT", "extension/ext.nodaro.ai@0.2.6", 4],
      ["dana", "DANA", "dana@example.com", "APP", "app.nodaro.ai", 3],
      ["omer", "OMER", "omer@example.com", "MCP · Claude", "claude", 3],
      ["omer", "OMER", "omer@example.com", "Zapier", "zap", 3],
      ["omer", "OMER", "omer@example.com", "API", null, 1],
    ])
    expect(report.rows[4]).toMatchObject({ source: "api", firstSeenAt: "2026-11-08T18:32:00.000Z", lastSeenAt: "2026-11-09T11:33:00.000Z" })
  })

  it("the kind asked for goes to the read, and the answer says which", async () => {
    const read = readOf([record("dana", { source: "extension", detail: "extension/ext.nodaro.ai@0.2.6" })])
    const report = await listUserSurfaces({ read, lookup, source: "extension", limit: 10, now: () => NOW })
    expect(read).toHaveBeenCalledWith({ source: "extension", hiddenUserId: null, limit: 10 })
    expect(report.source).toBe("extension")
    expect(report.rows.map((row) => row.label)).toEqual(["EXT"])
  })

  it("the account this admin may not see is left out by the read, whose count is the one answered", async () => {
    // The database left the payer's rows out of both the page and the count: seven remain, one fetched.
    const read = readOf([record("dana")], 7)
    const report = await listUserSurfaces({ read, lookup, source: null, hiddenUserId: "payer", limit: 1, now: () => NOW })
    expect(read).toHaveBeenCalledWith({ source: null, hiddenUserId: "payer", limit: 1 })
    expect(report.rows.map((row) => row.userId)).toEqual(["dana"])
    expect(report).toMatchObject({ people: 1, total: 7, truncated: true })
  })

  it("a list cut at the limit says so, and keeps the full count", async () => {
    const report = await listUserSurfaces({ read: readOf([record("dana"), record("omer")], 1_230), lookup, source: null, limit: 2, now: () => NOW })
    expect(report).toMatchObject({ people: 2, total: 1_230, truncated: true })
  })

  it("an app with no id is an OAuth app, and no app name is asked for", async () => {
    const apps = vi.fn<OnlineUsersLookup["apps"]>(async () => new Map())
    const report = await listUserSurfaces({ read: readOf([record("dana", { source: "app", detail: "" })]), lookup: { ...lookup, apps }, source: null, now: () => NOW })
    expect(report.rows[0]).toMatchObject({ label: "OAuth app", detail: null })
    expect(apps).not.toHaveBeenCalled()
  })

  it("names that cannot be read leave the rows listed, unnamed, and the failure is told", async () => {
    const failing: OnlineUsersLookup = { profiles: async () => Promise.reject(new Error("db")), apps: async () => Promise.reject(new Error("db")) }
    const reported: string[] = []
    const report = await listUserSurfaces({
      read: readOf([record("dana", { source: "app", detail: "claude" })]),
      lookup: failing,
      source: null,
      now: () => NOW,
      onLookupError: (what, error) => reported.push(`${what}: ${(error as Error).message}`),
    })
    expect(report.rows).toEqual([expect.objectContaining({ userId: "dana", name: null, email: null, label: "OAuth app" })])
    expect(reported.sort()).toEqual(["apps: db", "profiles: db"])
  })

  it("nothing recorded is an empty list with no beginning, and no names are asked for", async () => {
    const profiles = vi.fn<OnlineUsersLookup["profiles"]>(async () => new Map())
    const report = await listUserSurfaces({ read: readOf([], 0, null), lookup: { ...lookup, profiles }, source: "cli", now: () => NOW })
    expect(report).toMatchObject({ rows: [], people: 0, total: 0, truncated: false, source: "cli", recordedSince: null })
    expect(profiles).not.toHaveBeenCalled()
  })
})

type Answer = { data: unknown[] | null; error: { message: string } | null; count?: number | null }

/**
 * A PostgREST client that notes every step of the two queries and answers
 * each as told: the counted one is the rows, the other the oldest sighting.
 */
function clientOf(answers: { newest: Answer; oldest: Answer }) {
  const steps: unknown[] = []
  const chainOf = (answer: Answer) => {
    const chain = {
      eq: (column: string, value: string) => {
        steps.push({ eq: [column, value] })
        return chain
      },
      neq: (column: string, value: string) => {
        steps.push({ neq: [column, value] })
        return chain
      },
      order: (column: string, opts: unknown) => {
        steps.push({ order: [column, opts] })
        return chain
      },
      limit: (n: number) => {
        steps.push({ limit: n })
        return Promise.resolve(answer)
      },
    }
    return chain
  }
  const supabase = {
    from: (table: string) => ({
      select: (columns: string, opts?: { count?: string }) => {
        steps.push({ from: table, select: opts ? [columns, opts] : [columns] })
        return chainOf(opts?.count === "exact" ? answers.newest : answers.oldest)
      },
    }),
  }
  return { steps, supabase }
}

async function readWith(client: ReturnType<typeof clientOf>["supabase"]) {
  vi.doMock("../../../lib/supabase.js", () => ({ supabase: client }))
  vi.resetModules()
  const module = await import("../user-surfaces-list.js")
  vi.doUnmock("../../../lib/supabase.js")
  return module
}

describe("databaseUserSurfacesRead", () => {
  const row = { user_id: "u1", source: "extension", detail: "extension/ext.nodaro.ai@0.2.6", first_seen_at: "2026-11-09T10:00:00+00:00", last_seen_at: "2026-11-10T08:30:00+00:00", touches: 4 }
  const oldest = { data: [{ first_seen_at: "2026-11-08T18:00:14.708+00:00" }], error: null }

  it("reads every kind, the newest first, with the count of every row and when recording began", async () => {
    const client = clientOf({ newest: { data: [row], error: null, count: 42 }, oldest })
    const { databaseUserSurfacesRead, USER_SURFACE_COLUMNS } = await readWith(client.supabase)
    expect(await databaseUserSurfacesRead({ source: null, hiddenUserId: null, limit: 500 })).toEqual({ rows: [row], total: 42, recordedSince: "2026-11-08T18:00:14.708+00:00" })
    expect(client.steps).toEqual([
      { from: "user_surfaces", select: [USER_SURFACE_COLUMNS, { count: "exact" }] },
      { order: ["last_seen_at", { ascending: false }] },
      { limit: 500 },
      { from: "user_surfaces", select: ["first_seen_at"] },
      { order: ["first_seen_at", { ascending: true }] },
      { limit: 1 },
    ])
  })

  it("one kind, less the hidden account, is the database's filter, before the newest rows are cut", async () => {
    const client = clientOf({ newest: { data: [], error: null, count: 0 }, oldest: { data: [], error: null } })
    const { databaseUserSurfacesRead, USER_SURFACE_COLUMNS } = await readWith(client.supabase)
    expect(await databaseUserSurfacesRead({ source: "extension", hiddenUserId: "payer", limit: 10 })).toEqual({ rows: [], total: 0, recordedSince: null })
    expect(client.steps.slice(0, 5)).toEqual([
      { from: "user_surfaces", select: [USER_SURFACE_COLUMNS, { count: "exact" }] },
      { eq: ["source", "extension"] },
      { neq: ["user_id", "payer"] },
      { order: ["last_seen_at", { ascending: false }] },
      { limit: 10 },
    ])
  })

  it("a refused read throws its reason, never an empty table", async () => {
    const refused = { data: null, error: { message: 'relation "user_surfaces" does not exist' }, count: null }
    const rows = clientOf({ newest: refused, oldest })
    const { databaseUserSurfacesRead } = await readWith(rows.supabase)
    await expect(databaseUserSurfacesRead({ source: null, hiddenUserId: null, limit: 500 })).rejects.toThrow(/does not exist/)
    const since = clientOf({ newest: { data: [row], error: null, count: 1 }, oldest: refused })
    const read = await readWith(since.supabase)
    await expect(read.databaseUserSurfacesRead({ source: null, hiddenUserId: null, limit: 500 })).rejects.toThrow(/does not exist/)
  })
})
