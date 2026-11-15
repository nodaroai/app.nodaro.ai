import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import type { FastifyInstance } from "fastify"

/**
 * Two deployment switches on the surface profile (decided 2026-11-11), booted
 * for real:
 *
 *  - `developerApps.manage: "admin"` — only an admin of the deployment may
 *    create, change, rotate the secret of or delete a developer app; a
 *    person's call is refused (403 developer_apps_admin_only), on a session or
 *    a personal API token alike. Reading one's own apps and an existing app's
 *    tokens keep working. An admin check that fails refuses.
 *  - hiding the `apps` navigation entry — the public app listing follows it:
 *    the marketplace browse and MCP `list_apps` in its public scope list no
 *    published apps, and read none to find that out; a components-only browse
 *    and a person's own apps are unchanged. Shown (or no profile): unchanged.
 */

vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
  process.env.PUBLIC_URL = "https://app.example.com"
  process.env.MCP_PUBLIC_URL = "https://mcp.example.com"
  delete process.env.MCP_ALLOWED_CLIENT_IDS
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ developerApps: { manage: "admin" }, nav: { hide: ["apps"] } })
})

const fake = vi.hoisted(() => ({ db: null as unknown }))

vi.mock("../../lib/supabase.js", async () => {
  const { newOAuthMemoryDb, oauthMemorySupabase } = await import("./helpers/oauth-memory-db.js")
  const db = newOAuthMemoryDb()
  fake.db = db
  return { supabase: oauthMemorySupabase(db) }
})

import { buildApp } from "../../app.js"
import { invalidateAdminCache } from "../../lib/admin-check.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { appRow, seedApiToken, seedAppToken, type OAuthMemoryDb } from "./helpers/oauth-memory-db.js"
import { ADMIN, ADMIN_JWT, INIT, MCP_HEADERS, USER, USER_JWT, appListings, developerAppWrites, seedLane } from "./helpers/mcp-lane-transcript.js"

const ADMIN_ONLY = { error: { code: "developer_apps_admin_only", message: "On this deployment, only an administrator can create or change developer apps." } }
const PROFILE_BOTH = JSON.stringify({ developerApps: { manage: "admin" }, nav: { hide: ["apps"] } })

describe("developer apps admin-only, and the app listing behind a hidden Apps entry", () => {
  let app: FastifyInstance
  let db: OAuthMemoryDb
  let existingAppToken: string
  let reader: string

  beforeAll(async () => {
    __resetSurfaceProfileCacheForTests()
    db = fake.db as OAuthMemoryDb
    const seeded = seedLane(db)
    // An app this person made before the switch was set.
    const existing = appRow({ client_id: `app_${"5".repeat(32)}`, kind: "user", name: "Made before", owner_user_id: USER })
    db.apps.push(existing)
    existingAppToken = seedAppToken(db, existing, USER)
    reader = seedAppToken(db, seeded.ownApp, ADMIN, ["apps:read"])
    app = await buildApp()
    const probe = await app.inject({ method: "GET", url: "/health" })
    const socketProto = Object.getPrototypeOf((probe.raw.req as unknown as { socket: object }).socket) as { destroySoon?: () => void }
    if (typeof socketProto.destroySoon !== "function") socketProto.destroySoon = () => {}
  })

  afterAll(async () => {
    await app.close()
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  beforeEach(() => {
    process.env.NODARO_SURFACE_PROFILE = PROFILE_BOTH
    __resetSurfaceProfileCacheForTests()
    db.failReads.clear()
  })

  describe('developerApps.manage: "admin"', () => {
    it("a person's create, change, rotate and delete are refused; their own list still reads", async () => {
      const writes = await developerAppWrites(app, USER_JWT)
      for (const step of [writes.created, writes.changed, writes.rotated, writes.deleted]) {
        expect(step.status).toBe(403)
        expect(step.body).toEqual(ADMIN_ONLY)
      }
      expect(writes.listed).toEqual({ status: 200, count: 2 })
      // Nothing was written: the existing app is still there, named as it was.
      expect(db.apps.find((a) => a.client_id === `app_${"5".repeat(32)}`)?.name).toBe("Made before")
    })

    it("a person's personal API token is refused the same way", async () => {
      const writes = await developerAppWrites(app, seedApiToken(db, USER))
      expect(writes.created).toMatchObject({ status: 403, body: ADMIN_ONLY })
    })

    it("an admin creates, changes, rotates and deletes", async () => {
      const writes = await developerAppWrites(app, ADMIN_JWT)
      expect(writes.created.status).toBe(201)
      expect([writes.changed.status, writes.rotated.status, writes.deleted.status]).toEqual([200, 200, 200])
    })

    it("an admin check that fails refuses, never lets the write through", async () => {
      invalidateAdminCache(USER)
      db.failReads.add("profiles")
      const before = db.apps.length
      const res = await app.inject({
        method: "POST",
        url: "/v1/developer-apps",
        headers: { authorization: `Bearer ${USER_JWT}`, "content-type": "application/json" },
        payload: { name: "Sneaky", redirectUris: ["https://client.example/cb"], scopesRequested: ["jobs:read"] },
      })
      expect(res.statusCode).toBe(500)
      expect(res.json().error.code).toBe("internal_error")
      expect(db.apps.length).toBe(before)
    })

    it("an app made before the switch keeps working: its token is served", async () => {
      const res = await app.inject({ method: "POST", url: "/mcp", headers: { ...MCP_HEADERS, authorization: `Bearer ${existingAppToken}` }, payload: INIT })
      expect(res.statusCode, res.body).toBe(200)
    })

    it('"owner" (and no key at all) leaves a person managing their own apps', async () => {
      for (const profile of [{ developerApps: { manage: "owner" } }, { nav: { hide: ["explore"] } }]) {
        process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
        __resetSurfaceProfileCacheForTests()
        const writes = await developerAppWrites(app, USER_JWT)
        expect(writes.created.status, JSON.stringify(profile)).toBe(201)
        expect(writes.deleted.status).toBe(200)
      }
    })
  })

  describe("the public app listing follows the Apps navigation entry", () => {
    const listingReads = () => db.calls.filter((c) => c.table === "published_apps").length

    it("hidden: the browse lists no apps (favorites, untyped and app browses alike) and list_apps' public scope lists none, without reading one", async () => {
      const readsBefore = listingReads()
      const { browse, browseApps, listApps } = await appListings(app, "/mcp", reader)
      expect(browse).toMatchObject({ status: 200, body: { data: [], nextCursor: null } })
      expect(browseApps).toMatchObject({ status: 200, body: { data: [], nextCursor: null } })
      expect(JSON.parse(String(listApps.text))).toEqual({ data: [], scope: "public", next_cursor: null })
      const favorites = await app.inject({ method: "GET", url: "/v1/apps/browse?favoritesOnly=true", headers: { authorization: `Bearer ${USER_JWT}` } })
      expect(favorites.json()).toEqual({ data: [], nextCursor: null })
      // Only the two components-only browses read (appListings' and this one); nothing else did.
      const componentsOnly = await app.inject({ method: "GET", url: "/v1/apps/browse?publishType=component" })
      expect((componentsOnly.json() as { data: Array<{ slug: string }> }).data.map((a) => a.slug)).toEqual(["listed-component"])
      expect(listingReads() - readsBefore).toBe(2)
    })

    it("hidden: a person's own apps are still listed (list_apps scope mine)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: { ...MCP_HEADERS, authorization: `Bearer ${reader}` },
        payload: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_apps", arguments: { scope: "mine" } } },
      })
      const listed = JSON.parse((res.json() as { result: { content: Array<{ text: string }> } }).result.content[0]!.text) as { data: Array<{ slug: string }> }
      expect(listed.data.map((a) => a.slug)).toEqual(["listed-app"])
    })

    it("shown (a profile that hides something else): the listing is as before", async () => {
      process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nav: { hide: ["explore"] } })
      __resetSurfaceProfileCacheForTests()
      const { browse, browseApps, listApps } = await appListings(app, "/mcp", reader)
      expect((browse.body as { data: Array<{ slug: string }> }).data.map((a) => a.slug)).toEqual(["listed-app", "listed-component"])
      expect((browseApps.body as { data: Array<{ slug: string }> }).data.map((a) => a.slug)).toEqual(["listed-app"])
      expect((JSON.parse(String(listApps.text)) as { data: Array<{ slug: string }> }).data.map((a) => a.slug)).toEqual(["listed-app"])
    })
  })
})
