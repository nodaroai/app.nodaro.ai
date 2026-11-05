import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/nodaro-motion/precise-style-route`: whether a direct Prism Precise run with an art style runs as Flex, and
 * the accounts that skip it.
 *
 * What must hold:
 *  - both routes are admin-only;
 *  - GET answers the saved row (null until saved) and whether this environment's engine routes;
 *  - PUT is strict; the emails are stored trimmed, lowercased and without repeats; the defaults are left out;
 *  - any value saves whatever the engines (an engine without the flag never reads the row, so nothing it could do is
 *    wrong): no 409;
 *  - a save clears the settings cache and leaves an `admin_actions` row under an id of its own, the row of its own.
 */
const h = vi.hoisted(() => ({
  row: null as { value: unknown; updated_at: string } | null,
  upserts: [] as Array<{ key: string; value: unknown; updated_by: string }>,
  audits: [] as Record<string, unknown>[],
  admin: true,
  invalidated: 0,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "admin_actions") {
        return { insert: async (row: Record<string, unknown>) => (h.audits.push(row), { error: null }) }
      }
      if (table !== "app_settings") throw new Error(`unexpected table ${table}`)
      const chain = {
        select: () => chain,
        eq: (_c: string, key: string) => (expect(key).toBe("nodaro_motion_precise_style_route"), chain),
        maybeSingle: async () => ({ data: h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string; updated_by: string }, opts: unknown) => {
          expect(row.key).toBe("nodaro_motion_precise_style_route")
          expect(opts).toEqual({ onConflict: "key" })
          h.upserts.push(row)
          h.row = { value: row.value, updated_at: row.updated_at }
          return { error: null }
        },
      }
      return chain
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ invalidateSettingsCache: () => void h.invalidated++ }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => h.admin }))

const { adminNodaroMotionRoutes, NODARO_MOTION_MASKING_AUDIT_TARGET } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_PRECISE_ART_STYLE_AUDIT_TARGET } = await import("../admin-nodaro-motion-precise-art-style.js")
const { NODARO_MOTION_PRECISE_STYLE_ROUTE_AUDIT_TARGET } = await import("../admin-nodaro-motion-precise-style-route.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/nodaro-motion/precise-style-route"
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }

let app: FastifyInstance

beforeEach(async () => {
  h.row = null
  h.upserts = []
  h.audits = []
  h.admin = true
  h.invalidated = 0
  _resetPluginSupportsForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const put = (preciseStyleRoute: unknown, headers: Record<string, string> = as) => app.inject({ method: "PUT", url: URL, headers, payload: { preciseStyleRoute } })
const get = (headers: Record<string, string> = as) => app.inject({ method: "GET", url: URL, headers })

describe("GET /v1/admin/nodaro-motion/precise-style-route", () => {
  it("is admin-only", async () => {
    h.admin = false
    expect((await get()).statusCode).toBe(403)
    expect((await get({})).statusCode).toBeGreaterThanOrEqual(401)
  })

  it("answers null until it is saved, and whether this environment's engine routes", async () => {
    const first = (await get()).json().data
    expect(first).toEqual({ preciseStyleRoute: null, updatedAt: null, supported: false })
    setPluginSupports({ castSwap: { ...CS, preciseStyleRoute: true } } as never)
    expect((await get()).json().data.supported).toBe(true)
  })

  it("answers the saved row", async () => {
    h.row = { value: { routing: "off", bypassEmails: ["a@example.com"] }, updated_at: "2026-11-05T12:00:00.000Z" }
    expect((await get()).json().data).toEqual({
      preciseStyleRoute: { routing: "off", bypassEmails: ["a@example.com"] },
      updatedAt: "2026-11-05T12:00:00.000Z",
      supported: false,
    })
  })
})

describe("PUT /v1/admin/nodaro-motion/precise-style-route", () => {
  it("is admin-only", async () => {
    h.admin = false
    expect((await put({ routing: "off" })).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
  })

  it("saves the switch and the list, normalized, the row of its own, and audits it under its own id", async () => {
    const res = await put({ routing: "off", bypassEmails: [" Tester@Example.COM", "tester@example.com"] })
    expect(res.statusCode).toBe(200)
    const after = { routing: "off", bypassEmails: ["tester@example.com"] }
    expect(res.json().data.preciseStyleRoute).toEqual(after)
    expect(h.upserts).toEqual([{ key: "nodaro_motion_precise_style_route", value: after, updated_at: expect.any(String), updated_by: ADMIN }])
    expect(h.invalidated).toBe(1)
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: "update_nodaro_motion_precise_style_route",
        target_type: "app_setting",
        target_id: NODARO_MOTION_PRECISE_STYLE_ROUTE_AUDIT_TARGET,
        payload: { key: "nodaro_motion_precise_style_route", before: null, after },
      }),
    ])
    expect(new Set([NODARO_MOTION_PRECISE_STYLE_ROUTE_AUDIT_TARGET, NODARO_MOTION_PRECISE_ART_STYLE_AUDIT_TARGET, NODARO_MOTION_MASKING_AUDIT_TARGET]).size).toBe(3)
  })

  it("leaves the defaults out, so going back stores nothing", async () => {
    await put({ routing: "off" })
    const res = await put({ routing: "on", bypassEmails: [] })
    expect(res.statusCode).toBe(200)
    expect(h.upserts[1]!.value).toEqual({})
    expect(h.audits[1]!.payload).toEqual({ key: "nodaro_motion_precise_style_route", before: { routing: "off" }, after: {} })
  })

  it("saves whatever the engines: an engine without the flag never reads the row", async () => {
    expect((await put({ routing: "off" })).statusCode).toBe(200)
    expect((await put({ bypassEmails: ["a@example.com"] })).statusCode).toBe(200)
  })

  it.each([
    ["an unknown key", { route: "off" }],
    ["a third value", { routing: "sideways" }],
    ["not an email", { bypassEmails: ["nope"] }],
    ["not a list", { bypassEmails: "a@example.com" }],
  ])("refuses %s with a 400, nothing saved", async (_name, value) => {
    const res = await put(value)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("refuses a body with no setting", async () => {
    const res = await app.inject({ method: "PUT", url: URL, headers: as, payload: {} })
    expect(res.statusCode).toBe(400)
  })
})
