import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/video-remake/shot-list-fps` — how many frames a second the model
 * that writes a Video Remake run's shot list is shown of the clip.
 *
 * What must hold:
 *  - both routes are admin-only; a refused caller writes nothing;
 *  - GET answers the stored setting, the rate in effect, the recommended
 *    default and the rates offered, whether this environment's engine reads
 *    a rate, and whether this deployment can serve a call carrying one;
 *  - PUT is strict, saves what an admin set (the rate only when sent)
 *    whatever the engines, and the engine's accessor follows it over the
 *    real settings cache;
 *  - each save leaves an `admin_actions` row under an id of its own.
 */
const h = vi.hoisted(() => ({
  rows: new Map<string, { value: unknown; updated_at: string }>(),
  upserts: [] as unknown[],
  audits: [] as Record<string, unknown>[],
  admin: true,
  geminiKey: true,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "admin_actions") {
        return { insert: async (row: Record<string, unknown>) => (h.audits.push(row), { error: null }) }
      }
      if (table !== "app_settings") throw new Error(`unexpected table ${table}`)
      let key: string | null = null
      const chain = {
        select: () => chain,
        eq: (_column: string, k: string) => ((key = k), chain),
        // The admin's fresh read of one row.
        maybeSingle: async () => ({ data: key === null ? null : (h.rows.get(key) ?? null), error: null }),
        // The settings cache's read of every row (awaited without a terminal call).
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve({ data: [...h.rows].map(([k, r]) => ({ key: k, value: r.value })), error: null }).then(resolve, reject),
        upsert: async (row: { key: string; value: unknown; updated_at: string }, opts: unknown) => {
          expect(row.key).toBe("nodaro_motion_shot_list_fps")
          expect(opts).toEqual({ onConflict: "key" })
          h.upserts.push(row)
          h.rows.set(row.key, { value: row.value, updated_at: row.updated_at })
          return { error: null }
        },
      }
      return chain
    },
  },
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => h.admin }))
vi.mock("../../../lib/llm/anthropic-availability.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  geminiKeySet: () => h.geminiKey,
}))

const { adminNodaroMotionRoutes, NODARO_MOTION_SETTINGS_SECTIONS } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_SHOT_LIST_FPS_AUDIT_TARGET } = await import("../admin-nodaro-motion-shot-list-fps.js")
const { NODARO_MOTION_PREVIZ_AUDIT_TARGET } = await import("../admin-nodaro-motion-previz.js")
const { NODARO_MOTION_SHOT_LOCK_AUDIT_TARGET } = await import("../admin-nodaro-motion-shot-lock.js")
const { NODARO_MOTION_FLASH_MODEL_AUDIT_TARGET } = await import("../admin-nodaro-motion-flash-model.js")
const { getAppSettings, invalidateSettingsCache } = await import("../../../lib/app-settings.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/video-remake/shot-list-fps"
const KEY = "nodaro_motion_shot_list_fps"
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const OPTIONS = [1, 2, 3, 4, 6, 8, 12]

let app: FastifyInstance

beforeEach(async () => {
  h.rows = new Map()
  h.upserts = []
  h.audits = []
  h.admin = true
  h.geminiKey = true
  invalidateSettingsCache()
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { ...CS, shotListFps: true } } as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const get = async () => (await app.inject({ method: "GET", url: URL, headers: as })).json().data
const put = (shotListFps: unknown, headers: Record<string, string> = as) => app.inject({ method: "PUT", url: URL, headers, payload: { shotListFps } })
/** What the settings cache holds after a save: what the engine's accessor reads. */
const cached = async () => (await getAppSettings()).nodaro_motion_shot_list_fps

describe("GET /v1/admin/video-remake/shot-list-fps", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: URL, headers: as })).statusCode).toBe(403)
  })

  it("never saved: null, the recommended default in effect, the rates offered, and what this environment can do", async () => {
    expect(await get()).toEqual({ shotListFps: null, fps: 6, defaultFps: 6, options: OPTIONS, updatedAt: null, supported: true, rateCarried: true })
    setPluginSupports({ castSwap: CS })
    expect((await get()).supported).toBe(false)
    _resetPluginSupportsForTests()
    expect((await get()).supported).toBe(false)
    h.geminiKey = false
    expect((await get()).rateCarried).toBe(false)
  })

  it("answers the stored rate over the default, a rate it does not offer read as never chosen", async () => {
    h.rows.set(KEY, { value: { fps: 2 }, updated_at: "2026-11-20T10:00:00.000Z" })
    expect(await get()).toMatchObject({ shotListFps: { fps: 2 }, fps: 2, defaultFps: 6, updatedAt: "2026-11-20T10:00:00.000Z" })
    h.rows.set(KEY, { value: { fps: 5 }, updated_at: "2026-11-20T10:00:00.000Z" })
    expect(await get()).toMatchObject({ shotListFps: {}, fps: 6 })
  })
})

describe("PUT /v1/admin/video-remake/shot-list-fps", () => {
  it("is admin-only, and writes nothing for a non-admin", async () => {
    h.admin = false
    expect((await put({ fps: 4 })).statusCode).toBe(403)
    expect((await app.inject({ method: "PUT", url: URL, payload: { shotListFps: { fps: 4 } } })).statusCode).toBe(401)
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("saves the admin's rate, audits before and after, and the settings the engine reads follow it", async () => {
    expect(await cached()).toBeNull()
    const saved = await put({ fps: 4 })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().data).toMatchObject({ shotListFps: { fps: 4 }, fps: 4, defaultFps: 6 })
    expect(h.upserts).toEqual([{ key: KEY, value: { fps: 4 }, updated_at: expect.any(String), updated_by: ADMIN }])
    expect(await cached()).toEqual({ fps: 4 })
    expect(h.audits).toEqual([
      {
        admin_user_id: ADMIN,
        action: "update_nodaro_motion_shot_list_fps",
        target_type: "app_setting",
        target_id: NODARO_MOTION_SHOT_LIST_FPS_AUDIT_TARGET,
        payload: { key: KEY, before: null, after: { fps: 4 } },
      },
    ])
    // Back to the engine's default: no rate stored.
    expect((await put({})).json().data).toMatchObject({ shotListFps: {}, fps: 6 })
    expect(await cached()).toEqual({})
    expect(h.audits[1]!.payload).toEqual({ key: KEY, before: { fps: 4 }, after: {} })
    // 1 is the clip as it was read before the setting.
    expect((await put({ fps: 1 })).json().data).toMatchObject({ shotListFps: { fps: 1 }, fps: 1 })
  })

  it("is strict: a rate that is not offered, an unknown key or a body without the setting is 400 and writes nothing", async () => {
    for (const shotListFps of [{ fps: 5 }, { fps: 0 }, { fps: 24 }, { fps: "6" }, { fps: null }, { fps: 6, model: "x" }, { "nodaro-prism": 6 }, 6, null]) {
      expect((await put(shotListFps)).statusCode, JSON.stringify(shotListFps)).toBe(400)
    }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { shotListFps: {}, engine: "nodaro-prism" } })).statusCode).toBe(400)
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: {} })).statusCode).toBe(400)
    expect(h.upserts).toEqual([])
  })

  it("saves whatever the engine and the deployment: one that reads no rate never reads the row", async () => {
    for (const castSwap of [CS, { ...CS, shotListFps: false }, { ...CS, shotLock: true }]) {
      setPluginSupports({ castSwap } as never)
      const res = await put({ fps: 8 })
      expect(res.statusCode, JSON.stringify(castSwap)).toBe(200)
      expect(res.json().data).toMatchObject({ shotListFps: { fps: 8 }, fps: 8, supported: false })
    }
    h.geminiKey = false
    expect((await put({ fps: 8 })).json().data).toMatchObject({ fps: 8, rateCarried: false })
  })

  it("is a section of the stored settings sets, and files its audit rows under an id of its own", () => {
    const section = NODARO_MOTION_SETTINGS_SECTIONS.find((s) => s.key === "shot-list-fps")
    expect(section).toMatchObject({ path: URL, label: "Shot list frame rate" })
    expect(section!.prepare({ shotListFps: { fps: 4 } })).toEqual({ value: { shotListFps: { fps: 4 } } })
    expect(
      new Set([NODARO_MOTION_SHOT_LIST_FPS_AUDIT_TARGET, NODARO_MOTION_PREVIZ_AUDIT_TARGET, NODARO_MOTION_SHOT_LOCK_AUDIT_TARGET, NODARO_MOTION_FLASH_MODEL_AUDIT_TARGET]).size,
    ).toBe(4)
  })
})
