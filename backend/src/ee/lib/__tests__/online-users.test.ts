/**
 * "Signed in now": one row per person, newest first, each surface with its
 * own label, address and country; the payer hidden from everyone else; a store
 * that cannot be read says so instead of answering "nobody".
 */
import { describe, expect, it, vi } from "vitest"
import { listOnlineUsers, surfaceLabel, type OnlineUsersLookup } from "../online-users.js"
import type { PresenceEntry, PresenceStore } from "../presence.js"

const NOW = Date.UTC(2026, 9, 8, 19, 0, 0)
const MIN = 60_000

const seen = (userId: string, minutesAgo: number, over: Partial<PresenceEntry> = {}): PresenceEntry => ({
  userId,
  source: "web",
  detail: "app.nodaro.ai",
  address: "203.0.113.7",
  country: "IL",
  userAgent: "Chrome",
  lastSeenAt: NOW - minutesAgo * MIN,
  ...over,
})

const storeOf = (entries: PresenceEntry[]): PresenceStore => ({
  put: async () => undefined,
  since: async (since) => entries.filter((e) => e.lastSeenAt >= since).sort((a, b) => b.lastSeenAt - a.lastSeenAt),
})

const lookup: OnlineUsersLookup = {
  profiles: async (ids) => new Map(ids.map((id) => [id, { email: `${id}@example.com`, name: id.toUpperCase() }])),
  apps: async (ids) => new Map(ids.map((id) => [id, id === "claude" ? { name: "Claude", mcp: true } : { name: "Zapier", mcp: false }])),
}

describe("listOnlineUsers", () => {
  it("one row per person, newest first, each surface labelled, within the window only", async () => {
    const report = await listOnlineUsers({
      store: storeOf([
        seen("dana", 1),
        seen("dana", 3, { detail: "studio.nodaro.ai" }),
        seen("omer", 0, { source: "extension", detail: "abcdefgh" }),
        seen("omer", 2, { source: "app", detail: "claude" }),
        seen("gone", 6),
      ]),
      lookup,
      now: () => NOW,
    })
    expect(report).toMatchObject({ windowMinutes: 5, available: true, checkedAt: new Date(NOW).toISOString() })
    expect(report.users.map((u) => [u.userId, u.name, u.email, u.surfaces.map((s) => s.label)])).toEqual([
      ["omer", "OMER", "omer@example.com", ["EXT", "MCP · Claude"]],
      ["dana", "DANA", "dana@example.com", ["APP", "STUDIO"]],
    ])
    expect(report.users[0]!.lastSeenAt).toBe(new Date(NOW).toISOString())
    expect(report.users[1]!.surfaces[0]).toMatchObject({ address: "203.0.113.7", country: "IL", userAgent: "Chrome" })
  })

  it("the deployment's payer is not listed to anyone else", async () => {
    const report = await listOnlineUsers({ store: storeOf([seen("payer", 1), seen("dana", 1)]), lookup, hiddenUserId: "payer", now: () => NOW })
    expect(report.users.map((u) => u.userId)).toEqual(["dana"])
  })

  it("a store that cannot be read is unknown, not empty", async () => {
    expect(await listOnlineUsers({ store: null, lookup, now: () => NOW })).toMatchObject({ available: false, users: [] })
    const broken: PresenceStore = { put: async () => undefined, since: async () => Promise.reject(new Error("down")) }
    expect(await listOnlineUsers({ store: broken, lookup, now: () => NOW })).toMatchObject({ available: false, users: [] })
  })

  it("names that cannot be read leave the people listed, unnamed", async () => {
    const failing: OnlineUsersLookup = { profiles: async () => Promise.reject(new Error("db")), apps: async () => Promise.reject(new Error("db")) }
    const report = await listOnlineUsers({ store: storeOf([seen("dana", 1, { source: "app", detail: "claude" })]), lookup: failing, now: () => NOW })
    expect(report.users).toEqual([expect.objectContaining({ userId: "dana", name: null, email: null })])
    // An app the lookup could not name is not mistaken for the main app.
    expect(report.users[0]!.surfaces[0]!.label).toBe("OAuth app")
  })
})

describe("databaseLookup", () => {
  it("an app is an MCP client only when it registered as one; a name falls back to the display name", async () => {
    const tables: Record<string, unknown[]> = {
      developer_apps: [
        { id: "a1", name: "Claude", kind: "dynamic_mcp" },
        { id: "a2", name: "Nodaro MCP", kind: "first_party_mcp" },
        { id: "a3", name: "Zapier", kind: "user" },
        { id: "a4", name: "Office", kind: "community_instance" },
      ],
      profiles: [
        { id: "u1", email: "dana@x.test", full_name: "Dana Levi", display_name: "dana" },
        { id: "u2", email: "omer@x.test", full_name: null, display_name: "Omer" },
      ],
    }
    vi.doMock("../../../lib/supabase.js", () => ({
      supabase: { from: (table: string) => ({ select: () => ({ in: async () => ({ data: tables[table], error: null }) }) }) },
    }))
    vi.resetModules()
    const { databaseLookup } = await import("../online-users.js")
    const apps = await databaseLookup.apps(["a1", "a2", "a3", "a4"])
    expect([...apps.entries()].map(([id, app]) => [id, app.mcp])).toEqual([
      ["a1", true],
      ["a2", true],
      ["a3", false],
      ["a4", false],
    ])
    const profiles = await databaseLookup.profiles(["u1", "u2"])
    expect(profiles.get("u1")).toEqual({ email: "dana@x.test", name: "Dana Levi" })
    expect(profiles.get("u2")).toEqual({ email: "omer@x.test", name: "Omer" })
    vi.doUnmock("../../../lib/supabase.js")
  })
})

describe("surfaceLabel", () => {
  it("derives the label from the surface — never from a list of known hosts", () => {
    expect(surfaceLabel("web", "app.nodaro.ai")).toBe("APP")
    expect(surfaceLabel("web", "voice.nodaro.ai")).toBe("VOICE")
    expect(surfaceLabel("web", "next.studio.nodaro.ai")).toBe("NEXT.STUDIO")
    expect(surfaceLabel("web", "brand-new.nodaro.ai:443")).toBe("BRAND-NEW")
    expect(surfaceLabel("web", "localhost:3000")).toBe("localhost")
    expect(surfaceLabel("extension", "abc")).toBe("EXT")
    expect(surfaceLabel("mcp", "cursor")).toBe("MCP · cursor")
    expect(surfaceLabel("app", "x", { name: "Zapier", mcp: false })).toBe("Zapier")
    expect(surfaceLabel("cli", "cli/1.4.0")).toBe("CLI")
    expect(surfaceLabel("api", null)).toBe("API")
  })
})
