import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/video-remake/shot-lock` — per engine, whether a direct run's
 * prompt on an ordinary clip carries the shot lock's line: "off" (the
 * default) or "on".
 *
 * What must hold:
 *  - both routes are admin-only;
 *  - GET answers the saved row (null until saved), both engines named, and
 *    whether this environment's engine writes the line (`castSwap.shotLock`);
 *  - PUT is strict (an unknown engine or value is 400); "off" entries are
 *    dropped (the same as never set); "on" for any engine is 409
 *    `engine_unsupported` while NO environment's engine declares
 *    `castSwap.shotLock` (one that does is enough: only such an engine reads
 *    the row), while off everywhere is saved whatever the engines; a save
 *    clears the settings cache and leaves an `admin_actions` row under an id
 *    of its own.
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
        eq: (_c: string, key: string) => (expect(key).toBe("nodaro_motion_shot_lock"), chain),
        maybeSingle: async () => ({ data: h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }, opts: unknown) => {
          expect(row.key).toBe("nodaro_motion_shot_lock")
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
const { NODARO_MOTION_SHOT_LOCK_AUDIT_TARGET } = await import("../admin-nodaro-motion-shot-lock.js")
const { NODARO_MOTION_PROMPT_WORDING_AUDIT_TARGET } = await import("../admin-nodaro-motion-prompt-wording.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/video-remake/shot-lock"
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const envRow = (env: string, castSwap: Record<string, unknown>) => ({ env, pluginBuildId: null, supports: { castSwap: { ...CS, ...castSwap } }, updatedAt: "2026-11-01T00:00:00.000Z" })
const LOCK = { shotLock: true }
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
  h.envs = [envRow("production", {}), envRow("staging", LOCK)]
  h.envReads = 0
  _resetPluginSupportsForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const put = (shotLock: unknown, headers: Record<string, string> = as) => app.inject({ method: "PUT", url: URL, headers, payload: { shotLock } })

describe("GET /v1/admin/video-remake/shot-lock", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: URL, headers: as })).statusCode).toBe(403)
  })

  it("answers null until it is saved (off everywhere), both engines, and whether this engine writes the line", async () => {
    const res = await app.inject({ method: "GET", url: URL, headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({
      shotLock: null,
      updatedAt: null,
      engines: ENGINES,
      supported: false,
      runTypes: { offered: false, missingIn: ["staging", "production"] },
    })
    setPluginSupports({ castSwap: { ...CS, previz: true } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.supported).toBe(false)
    setPluginSupports({ castSwap: { ...CS, ...LOCK } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.supported).toBe(true)
  })

  it("answers the stored row, an earlier engine key read as the current one and a value it does not know dropped", async () => {
    h.row = { value: { "motion-lite": "on", "nodaro-prism": "always" }, updated_at: "2026-11-19T10:00:00.000Z" }
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data).toMatchObject({
      shotLock: { "nodaro-pulse": "on" },
      updatedAt: "2026-11-19T10:00:00.000Z",
    })
  })
})

describe("PUT /v1/admin/video-remake/shot-lock", () => {
  it("is admin-only, and writes nothing for a non-admin", async () => {
    h.admin = false
    expect((await put({ "nodaro-prism": "on" })).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
  })

  it("saves the engines that are on, clears the cache and audits before and after", async () => {
    const res = await put({ "nodaro-prism": "on", "nodaro-pulse": "off" })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([{ key: "nodaro_motion_shot_lock", value: { "nodaro-prism": "on" }, updated_at: expect.any(String), updated_by: ADMIN }])
    expect(h.invalidated).toBe(1)
    expect(res.json().data).toMatchObject({ shotLock: { "nodaro-prism": "on" }, engines: ENGINES })
    expect(h.audits).toEqual([
      {
        admin_user_id: ADMIN,
        action: "update_nodaro_motion_shot_lock",
        target_type: "app_setting",
        target_id: NODARO_MOTION_SHOT_LOCK_AUDIT_TARGET,
        payload: { key: "nodaro_motion_shot_lock", before: null, after: { "nodaro-prism": "on" } },
      },
    ])
    expect((await put({ "nodaro-prism": "on", "nodaro-pulse": "on" })).json().data.shotLock).toEqual({ "nodaro-prism": "on", "nodaro-pulse": "on" })
    expect(h.audits[1]!.payload).toEqual({
      key: "nodaro_motion_shot_lock",
      before: { "nodaro-prism": "on" },
      after: { "nodaro-prism": "on", "nodaro-pulse": "on" },
    })
  })

  it("refuses an unknown engine, an unknown value or an extra key", async () => {
    for (const s of [{ "motion-pro": "on" }, { "nodaro-prism": "On" }, { "nodaro-prism": true }, { "nodaro-prism": null }, "on", null]) {
      expect((await put(s)).statusCode, JSON.stringify(s)).toBe(400)
    }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { shotLock: {}, engine: "nodaro-pulse" } })).statusCode).toBe(400)
    expect(h.upserts).toEqual([])
  })

  it("saves 'on' once ONE environment's engine writes the line, either one", async () => {
    for (const envs of [
      [envRow("production", {}), envRow("staging", LOCK)],
      [envRow("production", LOCK)],
      [envRow("production", LOCK), envRow("staging", LOCK)],
    ]) {
      h.envs = envs
      expect((await put({ "nodaro-pulse": "on" })).statusCode, JSON.stringify(envs)).toBe(200)
    }
  })

  it("refuses 'on' (409 engine_unsupported) while no environment's engine writes the line: nothing would read it", async () => {
    for (const envs of [[], [envRow("production", {}), envRow("staging", { shotLock: false })], [envRow("staging", { previz: true })], [envRow("preview", LOCK)]]) {
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
      expect(res.json().data.shotLock).toEqual({})
    }
    // The engines are read only for the answer's `runTypes` (once per save), never to decide the save: none is recorded here.
    expect(h.envReads).toBe(3)
    expect(h.upserts.map((u) => (u as { value: unknown }).value)).toEqual([{}, {}, {}])
    expect(h.audits[0]!.payload).toEqual({ key: "nodaro_motion_shot_lock", before: { "nodaro-prism": "on" }, after: {} })
  })

  it("is a section of the stored settings sets, and files its audit rows under an id of its own", () => {
    const section = NODARO_MOTION_SETTINGS_SECTIONS.find((s) => s.key === "shot-lock")
    expect(section).toMatchObject({ path: URL, label: "Shot lock" })
    expect(section!.prepare({ shotLock: { "nodaro-prism": "on", "nodaro-pulse": "off" } })).toEqual({ value: { shotLock: { "nodaro-prism": "on" } } })
    expect(NODARO_MOTION_SHOT_LOCK_AUDIT_TARGET).not.toBe(NODARO_MOTION_PROMPT_WORDING_AUDIT_TARGET)
  })
})

/**
 * The shot lock BY RUN TYPE: per engine, a switch per run type (no art style;
 * an art style with roles; an art style alone) and per-style exceptions.
 *
 * What must hold:
 *  - a save in the shape of before ("on" / "off") is stored and answered as
 *    before, and needs only an engine that writes the line;
 *  - what says exactly what "on" says is stored as "on";
 *  - anything "on" cannot say is 409 `engine_unsupported` while NO
 *    environment's engine declares `castSwap.shotLockRunTypes`; one is enough;
 *  - the GET says whether such an entry may be saved and where it is not read;
 *  - an engine that takes no art style takes its ordinary switch alone.
 */
describe("the shot lock by run type", () => {
  const TYPES = { shotLock: true, shotLockRunTypes: true }
  const BY_TYPE = { ordinary: "on", styleWithRoles: "off", styleAlone: "on", styles: { cinematic: "off", custom: "on" } }

  it("the GET says whether an entry by run type may be saved, and where it is not read", async () => {
    const runTypes = async () => (await app.inject({ method: "GET", url: URL, headers: as })).json().data.runTypes
    expect(await runTypes()).toEqual({ offered: false, missingIn: ["staging", "production"] })
    h.envs = [envRow("production", LOCK), envRow("staging", TYPES)]
    expect(await runTypes()).toEqual({ offered: true, missingIn: ["production"] })
    h.envs = [envRow("production", TYPES), envRow("staging", TYPES)]
    expect(await runTypes()).toEqual({ offered: true, missingIn: [] })
    // The flag without the line is no reader.
    h.envs = [envRow("production", { shotLockRunTypes: true })]
    expect((await runTypes()).offered).toBe(false)
  })

  it("saves an entry by run type once ONE environment's engine reads it: the switches that are on, the exceptions as listed", async () => {
    h.envs = [envRow("production", LOCK), envRow("staging", TYPES)]
    const res = await put({ "nodaro-prism": BY_TYPE, "nodaro-pulse": { ordinary: "on" } })
    expect(res.statusCode).toBe(200)
    const stored = { "nodaro-prism": { ordinary: "on", styleAlone: "on", styles: { cinematic: "off", custom: "on" } }, "nodaro-pulse": "on" }
    expect((h.upserts[0] as { value: unknown }).value).toEqual(stored)
    expect(res.json().data.shotLock).toEqual(stored)
    expect(h.audits[0]!.payload).toEqual({ key: "nodaro_motion_shot_lock", before: null, after: stored })
    // Read back from the row, either shape.
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.shotLock).toEqual(stored)
  })

  it("what says exactly what \"on\" says is stored as \"on\", and needs no engine that reads run types", async () => {
    h.envs = [envRow("staging", LOCK)]
    for (const same of ["on", { ordinary: "on", styleWithRoles: "on" }, { ordinary: "on", styleWithRoles: "on", styleAlone: "off", styles: {} }]) {
      const res = await put({ "nodaro-prism": same })
      expect(res.statusCode, JSON.stringify(same)).toBe(200)
      expect(res.json().data.shotLock).toEqual({ "nodaro-prism": "on" })
    }
    expect(h.upserts.map((u) => (u as { value: unknown }).value)).toEqual([{ "nodaro-prism": "on" }, { "nodaro-prism": "on" }, { "nodaro-prism": "on" }])
  })

  it("refuses what \"on\" cannot say (409 engine_unsupported) while no environment's engine reads run types: nothing would read it", async () => {
    h.envs = [envRow("production", LOCK), envRow("staging", LOCK)]
    for (const s of [{ ordinary: "on" }, { styleWithRoles: "on" }, { styleAlone: "on" }, { ordinary: "on", styleWithRoles: "on", styleAlone: "on" }, { styles: { cinematic: "on" } }, { ordinary: "on", styleWithRoles: "on", styles: { cinematic: "off" } }]) {
      const res = await put({ "nodaro-prism": s })
      expect(res.statusCode, JSON.stringify(s)).toBe(409)
      expect(res.json().error).toMatchObject({ code: "engine_unsupported", message: expect.stringMatching(/by run type/) })
    }
    expect(h.upserts).toEqual([])
    // An engine that takes no art style says nothing "on" cannot: its ordinary switch is saved as before.
    expect((await put({ "nodaro-pulse": { ordinary: "on" } })).statusCode).toBe(200)
  })

  it("an entry that turns nothing on is off: saved whatever the engines, nothing stored for it", async () => {
    h.row = { value: { "nodaro-prism": { styleAlone: "on" } }, updated_at: "2026-11-19T10:00:00.000Z" }
    h.envs = []
    for (const s of [{ "nodaro-prism": {} }, { "nodaro-prism": { ordinary: "off", styleAlone: "off" } }, { "nodaro-prism": { styles: { cinematic: "off" } } }]) {
      const res = await put(s)
      expect(res.statusCode, JSON.stringify(s)).toBe(200)
      expect(res.json().data.shotLock).toEqual({})
    }
    expect(h.audits[0]!.payload).toEqual({ key: "nodaro_motion_shot_lock", before: { "nodaro-prism": { styleAlone: "on" } }, after: {} })
  })

  it("refuses an art-style switch or an exception on an engine that takes no art style, an unknown key, value or style id", async () => {
    h.envs = [envRow("staging", TYPES)]
    for (const s of [
      { "nodaro-pulse": { styleAlone: "on" } },
      { "nodaro-pulse": { ordinary: "on", styles: { cinematic: "on" } } },
      { "nodaro-prism": { ordinary: "yes" } },
      { "nodaro-prism": { trend: "on" } },
      { "nodaro-prism": { styles: { cinematic: true } } },
      { "nodaro-prism": { styles: { "Cinematic Style": "on" } } },
    ]) {
      expect((await put(s)).statusCode, JSON.stringify(s)).toBe(400)
    }
    expect(h.upserts).toEqual([])
  })

  it("a stored settings set from before run types loads as it was, and one by run type is held as it is stored", () => {
    const section = NODARO_MOTION_SETTINGS_SECTIONS.find((s) => s.key === "shot-lock")!
    const body = (shotLock: unknown) => section.body.safeParse({ shotLock })
    expect(body({ "nodaro-prism": "on" }).success).toBe(true)
    expect(section.prepare({ shotLock: { "nodaro-prism": "on" } })).toEqual({ value: { shotLock: { "nodaro-prism": "on" } } })
    expect(body({ "nodaro-prism": BY_TYPE }).success).toBe(true)
    expect(section.prepare({ shotLock: { "nodaro-prism": BY_TYPE } })).toEqual({
      value: { shotLock: { "nodaro-prism": { ordinary: "on", styleAlone: "on", styles: { cinematic: "off", custom: "on" } } } },
    })
  })
})
