import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/video-remake/precise-upscale`: per output resolution, the Topaz target of a direct Prism Precise run's take.
 *
 * What must hold:
 *  - both routes are admin-only;
 *  - GET answers the effective value (the defaults until saved), what was stored (null until saved), the defaults, and
 *    whether this environment's engine runs the step;
 *  - PUT is strict per resolution (1080p takes no 720p target);
 *  - any value saves whatever the engines (an engine without the flag never reads the row): no 409;
 *  - a save clears the settings cache and leaves an `admin_actions` row under an id of its own.
 */
const h = vi.hoisted(() => ({
  row: null as { value: unknown; updated_at: string } | null,
  upserts: [] as Array<{ key: string; value: unknown; updated_by: string }>,
  audits: [] as Record<string, unknown>[],
  admin: true,
  invalidated: 0,
  topazDisabled: false,
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
        eq: (_c: string, key: string) => (expect(key).toBe("nodaro_motion_precise_upscale"), chain),
        maybeSingle: async () => ({ data: h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string; updated_by: string }, opts: unknown) => {
          expect(row.key).toBe("nodaro_motion_precise_upscale")
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
vi.mock("@/lib/topaz-video-availability.js", () => ({ topazVideoDisabledHere: () => h.topazDisabled }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => h.admin }))

const { adminNodaroMotionRoutes, NODARO_MOTION_MASKING_AUDIT_TARGET } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_PRECISE_STYLE_ROUTE_AUDIT_TARGET } = await import("../admin-nodaro-motion-precise-style-route.js")
const { NODARO_MOTION_PRECISE_UPSCALE_AUDIT_TARGET } = await import("../admin-nodaro-motion-precise-upscale.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/video-remake/precise-upscale"
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const FLASH_DEFAULTS = { "480p": "1080p", "720p": "1080p" }
const DEFAULTS = { "480p": "1080p", "720p": "1080p", "1080p": "4k", flash: FLASH_DEFAULTS }

let app: FastifyInstance

beforeEach(async () => {
  h.row = null
  h.upserts = []
  h.audits = []
  h.admin = true
  h.invalidated = 0
  h.topazDisabled = false
  _resetPluginSupportsForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const put = (preciseUpscale: unknown, headers: Record<string, string> = as) => app.inject({ method: "PUT", url: URL, headers, payload: { preciseUpscale } })
const get = (headers: Record<string, string> = as) => app.inject({ method: "GET", url: URL, headers })

describe("GET /v1/admin/video-remake/precise-upscale", () => {
  it("is admin-only", async () => {
    h.admin = false
    expect((await get()).statusCode).toBe(403)
    expect((await get({})).statusCode).toBeGreaterThanOrEqual(401)
  })

  it("answers the defaults until it is saved, and whether this environment's engine runs the step", async () => {
    expect((await get()).json().data).toEqual({ value: DEFAULTS, stored: null, defaults: DEFAULTS, updatedAt: null, supported: false, topazDisabled: false, upscaleChoice: false })
    setPluginSupports({ castSwap: { ...CS, preciseUpscale: true } } as never)
    expect((await get()).json().data.supported).toBe(true)
  })

  it("says whether this environment's engine takes the upscale choice (the rows then turn it on or off per size)", async () => {
    expect((await get()).json().data.upscaleChoice).toBe(false)
    setPluginSupports({ castSwap: { ...CS, preciseUpscale: true, upscaleChoice: true } } as never)
    expect((await get()).json().data.upscaleChoice).toBe(true)
  })

  it("answers the saved row, each resolution left out at its default", async () => {
    h.row = { value: { "720p": "off" }, updated_at: "2026-11-22T12:00:00.000Z" }
    expect((await get()).json().data).toEqual({
      value: { "480p": "1080p", "720p": "off", "1080p": "4k", flash: FLASH_DEFAULTS },
      stored: { "720p": "off" },
      defaults: DEFAULTS,
      updatedAt: "2026-11-22T12:00:00.000Z",
      supported: false,
      topazDisabled: false,
      upscaleChoice: false,
    })
  })

  it("says when this deployment withholds Topaz", async () => {
    h.topazDisabled = true
    expect((await get()).json().data.topazDisabled).toBe(true)
  })
})

describe("PUT /v1/admin/video-remake/precise-upscale", () => {
  it("is admin-only", async () => {
    h.admin = false
    expect((await put({ "480p": "off" })).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
  })

  it("saves the setting, the row of its own, and audits it under its own id", async () => {
    const value = { "480p": "720p", "720p": "4k", "1080p": "off", flash: { "480p": "off", "720p": "4k" } }
    const res = await put(value)
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ value, stored: value })
    expect(h.upserts).toEqual([{ key: "nodaro_motion_precise_upscale", value, updated_at: expect.any(String), updated_by: ADMIN }])
    expect(h.invalidated).toBe(1)
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: "update_nodaro_motion_precise_upscale",
        target_type: "app_setting",
        target_id: NODARO_MOTION_PRECISE_UPSCALE_AUDIT_TARGET,
        payload: { key: "nodaro_motion_precise_upscale", before: null, after: value },
      }),
    ])
    expect(new Set([NODARO_MOTION_PRECISE_UPSCALE_AUDIT_TARGET, NODARO_MOTION_PRECISE_STYLE_ROUTE_AUDIT_TARGET, NODARO_MOTION_MASKING_AUDIT_TARGET]).size).toBe(3)
  })

  it("saves each resolution a PUT leaves out at its default, so what is stored is what runs", async () => {
    const res = await put({ "720p": "off" })
    expect(res.statusCode).toBe(200)
    const after = { "480p": "1080p", "720p": "off", "1080p": "4k", flash: FLASH_DEFAULTS }
    expect(h.upserts[0]!.value).toEqual(after)
    expect(res.json().data).toMatchObject({ value: after, stored: after })
  })

  it("saves whatever the engines: an engine without the flag never reads the row", async () => {
    expect((await put({ "1080p": "1080p" })).statusCode).toBe(200)
    setPluginSupports({ castSwap: { ...CS, preciseUpscale: false } } as never)
    expect((await put({ "1080p": "4k" })).statusCode).toBe(200)
  })

  it.each([
    ["an unknown key", { "4k": "4k" }],
    ["a choice that is not a Topaz target", { "480p": "2k" }],
    ["a 1080p target below the output", { "1080p": "720p" }],
    ["not a string", { "720p": true }],
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
