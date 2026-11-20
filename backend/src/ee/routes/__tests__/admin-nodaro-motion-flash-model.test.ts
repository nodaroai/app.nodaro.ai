import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/video-remake/flash-model`: per engine, a test switch that makes
 * every new run of that engine on the faster model of the same family: "off"
 * (the default) or "on".
 *
 * What must hold:
 *  - both routes are admin-only;
 *  - GET answers the saved row (null until saved), both engines named,
 *    whether this environment's engine runs the test (`castSwap.flashModel`),
 *    and every environment whose engine does (the row is shared);
 *  - PUT is strict (an unknown engine or value is 400); "off" entries are
 *    dropped (the same as never set); "on" for any engine is 409
 *    `engine_unsupported` while NO environment's engine declares
 *    `castSwap.flashModel` (one that does is enough: only such an engine
 *    reads the row), while off everywhere is saved whatever the engines; a
 *    save clears the settings cache and leaves an `admin_actions` row under
 *    an id of its own;
 *  - it is NOT a section of the stored settings sets: loading a set never
 *    turns a test on.
 */
const h = vi.hoisted(() => ({
  row: null as { value: unknown; updated_at: string } | null,
  upserts: [] as unknown[],
  audits: [] as Record<string, unknown>[],
  admin: true,
  invalidated: 0,
  envs: [] as { env: string; pluginBuildId: string | null; supports: Record<string, unknown>; updatedAt: string }[],
  envReads: 0,
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
        eq: (_c: string, key: string) => (expect(key).toBe("nodaro_motion_flash_model"), chain),
        maybeSingle: async () => ({ data: h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }, opts: unknown) => {
          expect(row.key).toBe("nodaro_motion_flash_model")
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
vi.mock("../../lib/engine-environments.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/engine-environments.js")>()),
  listEngineEnvironments: async () => (h.envReads++, h.envs),
}))

const { adminNodaroMotionRoutes, NODARO_MOTION_SETTINGS_SECTIONS } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_FLASH_MODEL_AUDIT_TARGET } = await import("../admin-nodaro-motion-flash-model.js")
const { NODARO_MOTION_SHOT_LOCK_AUDIT_TARGET } = await import("../admin-nodaro-motion-shot-lock.js")
const { NODARO_MOTION_PROMPT_WORDING_AUDIT_TARGET } = await import("../admin-nodaro-motion-prompt-wording.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/video-remake/flash-model"
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const envRow = (env: string, castSwap: Record<string, unknown>) => ({ env, pluginBuildId: null, supports: { castSwap: { ...CS, ...castSwap } }, updatedAt: "2026-11-01T00:00:00.000Z" })
const FLASH = { flashModel: true }
const ENGINES = [
  { id: "nodaro-prism", name: "Nodaro Prism", internal: "seedance-2-5" },
  { id: "nodaro-pulse", name: "Nodaro Pulse", internal: "kling-4" },
]

let app: FastifyInstance

beforeEach(async () => {
  h.row = null
  h.upserts = []
  h.audits = []
  h.admin = true
  h.invalidated = 0
  h.envs = [envRow("production", {}), envRow("staging", FLASH)]
  h.envReads = 0
  _resetPluginSupportsForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const put = (flashModel: unknown, headers: Record<string, string> = as) => app.inject({ method: "PUT", url: URL, headers, payload: { flashModel } })

describe("GET /v1/admin/video-remake/flash-model", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: URL, headers: as })).statusCode).toBe(403)
  })

  it("answers null until it is saved (off everywhere), both engines, whether this engine runs the test, and the environments whose engine does", async () => {
    const res = await app.inject({ method: "GET", url: URL, headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ flashModel: null, updatedAt: null, engines: ENGINES, supported: false, environments: ["staging"] })
    setPluginSupports({ castSwap: { ...CS, previz: true } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.supported).toBe(false)
    setPluginSupports({ castSwap: { ...CS, ...FLASH } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.supported).toBe(true)
  })

  it("answers the stored row, an earlier engine key read as the current one and a value it does not know dropped", async () => {
    h.row = { value: { "motion-lite": "on", "nodaro-prism": "always" }, updated_at: "2026-11-19T10:00:00.000Z" }
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data).toMatchObject({
      flashModel: { "nodaro-pulse": "on" },
      updatedAt: "2026-11-19T10:00:00.000Z",
    })
  })
})

describe("PUT /v1/admin/video-remake/flash-model", () => {
  it("is admin-only, and writes nothing for a non-admin", async () => {
    h.admin = false
    expect((await put({ "nodaro-prism": "on" })).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
  })

  it("saves the engines that are on, clears the cache and audits before and after", async () => {
    const res = await put({ "nodaro-prism": "on", "nodaro-pulse": "off" })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([{ key: "nodaro_motion_flash_model", value: { "nodaro-prism": "on" }, updated_at: expect.any(String), updated_by: ADMIN }])
    expect(h.invalidated).toBe(1)
    expect(res.json().data).toMatchObject({ flashModel: { "nodaro-prism": "on" }, engines: ENGINES })
    expect(h.audits).toEqual([
      {
        admin_user_id: ADMIN,
        action: "update_nodaro_motion_flash_model",
        target_type: "app_setting",
        target_id: NODARO_MOTION_FLASH_MODEL_AUDIT_TARGET,
        payload: { key: "nodaro_motion_flash_model", before: null, after: { "nodaro-prism": "on" } },
      },
    ])
    expect((await put({ "nodaro-prism": "on", "nodaro-pulse": "on" })).json().data.flashModel).toEqual({ "nodaro-prism": "on", "nodaro-pulse": "on" })
    expect(h.audits[1]!.payload).toEqual({
      key: "nodaro_motion_flash_model",
      before: { "nodaro-prism": "on" },
      after: { "nodaro-prism": "on", "nodaro-pulse": "on" },
    })
  })

  it("refuses an unknown engine, an unknown value or an extra key", async () => {
    for (const s of [{ "motion-pro": "on" }, { "nodaro-prism": "On" }, { "nodaro-prism": true }, { "nodaro-prism": null }, "on", null]) {
      expect((await put(s)).statusCode, JSON.stringify(s)).toBe(400)
    }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { flashModel: {}, engine: "nodaro-pulse" } })).statusCode).toBe(400)
    expect(h.upserts).toEqual([])
  })

  it("saves 'on' once ONE environment's engine runs the test, either one", async () => {
    for (const envs of [
      [envRow("production", {}), envRow("staging", FLASH)],
      [envRow("production", FLASH)],
      [envRow("production", FLASH), envRow("staging", FLASH)],
    ]) {
      h.envs = envs
      expect((await put({ "nodaro-pulse": "on" })).statusCode, JSON.stringify(envs)).toBe(200)
    }
  })

  it("refuses 'on' (409 engine_unsupported) while no environment's engine runs the test: nothing would read it", async () => {
    for (const envs of [[], [envRow("production", {}), envRow("staging", { flashModel: false })], [envRow("staging", { previz: true })], [envRow("preview", FLASH)]]) {
      h.envs = envs
      const res = await put({ "nodaro-prism": "on" })
      expect(res.statusCode, JSON.stringify(envs)).toBe(409)
      expect(res.json().error).toMatchObject({ code: "engine_unsupported" })
    }
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("always saves off, whatever the engines, so it can be taken back", async () => {
    h.row = { value: { "nodaro-prism": "on" }, updated_at: "2026-11-19T10:00:00.000Z" }
    h.envs = []
    for (const s of [{}, { "nodaro-prism": "off" }, { "nodaro-prism": "off", "nodaro-pulse": "off" }]) {
      const res = await put(s)
      expect(res.statusCode, JSON.stringify(s)).toBe(200)
      expect(res.json().data.flashModel).toEqual({})
    }
    // (The answer still names the environments that read the row: none here.)
    expect(h.upserts.map((u) => (u as { value: unknown }).value)).toEqual([{}, {}, {}])
    expect(h.audits[0]!.payload).toEqual({ key: "nodaro_motion_flash_model", before: { "nodaro-prism": "on" }, after: {} })
  })

  it("names every environment whose engine reads the shared row, in the publish order", async () => {
    h.envs = [envRow("production", FLASH), envRow("staging", FLASH), envRow("preview", FLASH)]
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.environments).toEqual(["staging", "production"])
    h.envs = [envRow("production", {}), envRow("staging", { flashModel: false })]
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.environments).toEqual([])
  })

  it("is no section of the stored settings sets (a set never turns a test on), and files its audit rows under an id of its own", () => {
    expect(NODARO_MOTION_SETTINGS_SECTIONS.find((s) => s.key === "flash-model" || s.path === URL)).toBeUndefined()
    const targets = [NODARO_MOTION_FLASH_MODEL_AUDIT_TARGET, NODARO_MOTION_SHOT_LOCK_AUDIT_TARGET, NODARO_MOTION_PROMPT_WORDING_AUDIT_TARGET]
    expect(new Set(targets).size).toBe(targets.length)
  })
})
