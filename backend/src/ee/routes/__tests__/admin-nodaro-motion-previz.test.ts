import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/video-remake/previz` — whether this deployment accepts a Video
 * Remake run whose clip is a 3D previz (`clipKind: "previz"`).
 *
 * What must hold:
 *  - both routes are admin-only; a refused caller writes nothing;
 *  - GET answers the stored setting, the resolved switch and the deployment's
 *    default (on for Nodaro's own, off under a white-label profile), and
 *    whether this environment's engine takes such a clip;
 *  - PUT is strict, saves what an admin set (the switch only when sent)
 *    whatever the engines, and the public `GET /v1/cast-swap/style-choice`
 *    follows it over the real settings cache;
 *  - with an engine that does not declare `castSwap.previz` (every engine
 *    before it) the switch still saves and the public answer stays false;
 *  - each save leaves an `admin_actions` row under an id of its own.
 */
const h = vi.hoisted(() => ({
  rows: new Map<string, { value: unknown; updated_at: string }>(),
  upserts: [] as unknown[],
  audits: [] as Record<string, unknown>[],
  admin: true,
  offeredByDefault: true,
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
          expect(row.key).toBe("nodaro_motion_previz")
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
vi.mock("../../../lib/nodaro-motion-previz-default.js", () => ({ previzOfferedByDefault: () => h.offeredByDefault }))

const { adminNodaroMotionRoutes, NODARO_MOTION_SETTINGS_SECTIONS } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_PREVIZ_AUDIT_TARGET } = await import("../admin-nodaro-motion-previz.js")
const { NODARO_MOTION_SHOT_LOCK_AUDIT_TARGET } = await import("../admin-nodaro-motion-shot-lock.js")
const { NODARO_MOTION_PLAN_ROLES_AUDIT_TARGET } = await import("../admin-nodaro-motion-plan-roles.js")
const { NODARO_MOTION_CUSTOM_STYLE_AUDIT_TARGET } = await import("../admin-nodaro-motion-custom-style.js")
const { castSwapStyleChoiceRoutes } = await import("../cast-swap-style-choice.js")
const { invalidateSettingsCache } = await import("../../../lib/app-settings.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/video-remake/previz"
const PUBLIC_URL = "/v1/cast-swap/style-choice"
const KEY = "nodaro_motion_previz"
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }

let app: FastifyInstance

beforeEach(async () => {
  h.rows = new Map()
  h.upserts = []
  h.audits = []
  h.admin = true
  h.offeredByDefault = true
  invalidateSettingsCache()
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { ...CS, previz: true } })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.register(castSwapStyleChoiceRoutes)
  await app.ready()
})

const get = async () => (await app.inject({ method: "GET", url: URL, headers: as })).json().data
const put = (previz: unknown, headers: Record<string, string> = as) => app.inject({ method: "PUT", url: URL, headers, payload: { previz } })
const offered = async () => (await app.inject({ method: "GET", url: PUBLIC_URL })).json().previz

describe("GET /v1/admin/video-remake/previz", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: URL, headers: as })).statusCode).toBe(403)
  })

  it("never saved: null, the deployment's default as the switch, and whether this engine takes such a clip", async () => {
    expect(await get()).toEqual({ previz: null, enabled: true, enabledByDefault: true, updatedAt: null, supported: true })
    h.offeredByDefault = false
    expect(await get()).toEqual({ previz: null, enabled: false, enabledByDefault: false, updatedAt: null, supported: true })
    setPluginSupports({ castSwap: CS })
    expect((await get()).supported).toBe(false)
    _resetPluginSupportsForTests()
    expect((await get()).supported).toBe(false)
  })

  it("answers the stored choice over the default, a value that is no boolean read as never chosen", async () => {
    h.offeredByDefault = false
    h.rows.set(KEY, { value: { enabled: true }, updated_at: "2026-11-19T10:00:00.000Z" })
    expect(await get()).toMatchObject({ previz: { enabled: true }, enabled: true, enabledByDefault: false, updatedAt: "2026-11-19T10:00:00.000Z" })
    h.rows.set(KEY, { value: { enabled: "yes" }, updated_at: "2026-11-19T10:00:00.000Z" })
    expect(await get()).toMatchObject({ previz: {}, enabled: false })
  })
})

describe("PUT /v1/admin/video-remake/previz", () => {
  it("is admin-only, and writes nothing for a non-admin", async () => {
    h.admin = false
    expect((await put({ enabled: true })).statusCode).toBe(403)
    expect((await app.inject({ method: "PUT", url: URL, payload: { previz: { enabled: true } } })).statusCode).toBe(401)
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("saves the admin's choice, audits before and after, and the public answer follows it", async () => {
    expect(await offered()).toBe(true)
    const off = await put({ enabled: false })
    expect(off.statusCode).toBe(200)
    expect(off.json().data).toMatchObject({ previz: { enabled: false }, enabled: false, enabledByDefault: true })
    expect(h.upserts).toEqual([{ key: KEY, value: { enabled: false }, updated_at: expect.any(String), updated_by: ADMIN }])
    expect(await offered()).toBe(false)
    expect(h.audits).toEqual([
      {
        admin_user_id: ADMIN,
        action: "update_nodaro_motion_previz",
        target_type: "app_setting",
        target_id: NODARO_MOTION_PREVIZ_AUDIT_TARGET,
        payload: { key: KEY, before: null, after: { enabled: false } },
      },
    ])
    // Under a white-label profile the default is off, and a saved "on" turns it on.
    h.offeredByDefault = false
    expect((await put({})).json().data).toMatchObject({ previz: {}, enabled: false })
    expect(await offered()).toBe(false)
    expect((await put({ enabled: true })).json().data).toMatchObject({ previz: { enabled: true }, enabled: true })
    expect(await offered()).toBe(true)
    expect(h.audits[2]!.payload).toEqual({ key: KEY, before: {}, after: { enabled: true } })
  })

  it("is strict: a switch that is no boolean, an unknown key or a body without the setting is 400 and writes nothing", async () => {
    for (const previz of [{ enabled: "true" }, { enabled: null }, { enabled: true, lighting: true }, { "nodaro-prism": true }, "on", null]) {
      expect((await put(previz)).statusCode, JSON.stringify(previz)).toBe(400)
    }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { previz: {}, engine: "nodaro-prism" } })).statusCode).toBe(400)
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: {} })).statusCode).toBe(400)
    expect(h.upserts).toEqual([])
  })

  it("saves whatever the engine: one that takes no 3D previz clip never reads it, and the public answer stays false", async () => {
    for (const castSwap of [CS, { ...CS, previz: false }, { ...CS, planRoles: true, customStyle: true }]) {
      setPluginSupports({ castSwap })
      const res = await put({ enabled: true })
      expect(res.statusCode, JSON.stringify(castSwap)).toBe(200)
      expect(res.json().data).toMatchObject({ previz: { enabled: true }, enabled: true, supported: false })
      expect(await offered(), JSON.stringify(castSwap)).toBe(false)
    }
    _resetPluginSupportsForTests()
    expect((await put({ enabled: true })).statusCode).toBe(200)
    expect(await offered()).toBe(false)
  })

  it("is a section of the stored settings sets, and files its audit rows under an id of its own", () => {
    const section = NODARO_MOTION_SETTINGS_SECTIONS.find((s) => s.key === "previz")
    expect(section).toMatchObject({ path: URL, label: "3D previz clips" })
    expect(section!.prepare({ previz: { enabled: true } })).toEqual({ value: { previz: { enabled: true } } })
    expect(
      new Set([NODARO_MOTION_PREVIZ_AUDIT_TARGET, NODARO_MOTION_SHOT_LOCK_AUDIT_TARGET, NODARO_MOTION_PLAN_ROLES_AUDIT_TARGET, NODARO_MOTION_CUSTOM_STYLE_AUDIT_TARGET]).size,
    ).toBe(4)
  })
})
