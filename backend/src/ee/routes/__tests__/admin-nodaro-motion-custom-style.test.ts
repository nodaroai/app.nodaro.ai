import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/video-remake/custom-style` — whether this deployment offers
 * Video Remake's custom style (the style in the person's own words), and the
 * admin's own instructions and model for the engine's two LLM steps.
 *
 * What must hold:
 *  - every route is admin-only; a refused caller writes nothing and asks the
 *    engine nothing;
 *  - GET answers the stored setting, the resolved switch and the deployment's
 *    default (on for Nodaro's own, off under a white-label profile), and
 *    whether this environment's engine takes a custom style;
 *  - PUT saves what an admin set (the switch only when sent), and the public
 *    `GET /v1/cast-swap/style-choice` follows it over the real settings cache;
 *  - the steps are checked by this environment's engine (its internal route,
 *    asked as the admin with the platform's secret): its problems refuse the
 *    save, each named under `customStyle`; an engine without the route (one
 *    from before it) is asked nothing and the save goes through;
 *  - the defaults are the engine's own answer, never text kept here;
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
          expect(row.key).toBe("nodaro_motion_custom_style")
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
vi.mock("../../../lib/nodaro-motion-custom-style-default.js", () => ({ customStyleOfferedByDefault: () => h.offeredByDefault }))

const { adminNodaroMotionRoutes, NODARO_MOTION_SETTINGS_SECTIONS } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_CUSTOM_STYLE_AUDIT_TARGET } = await import("../admin-nodaro-motion-custom-style.js")
const { castSwapStyleChoiceRoutes } = await import("../cast-swap-style-choice.js")
const { invalidateSettingsCache } = await import("../../../lib/app-settings.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const SECRET = "0".repeat(64) // src/test/setup.ts
const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/video-remake/custom-style"
const PUBLIC_URL = "/v1/cast-swap/style-choice"
const KEY = "nodaro_motion_custom_style"
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }

/** Stand-in defaults: the engine's real instructions and model are its own and are never written in this repo. */
const ENGINE_ANSWER = {
  maxChars: 600,
  noteMaxChars: 300,
  mediums: ["2d", "3d", "photo"],
  tones: ["colour", "black-and-white", "one-colour"],
  fallback: { medium: "2d", tones: "colour" },
  describeRateLimit: { max: 10, timeWindow: "1m" },
  defaults: {
    medium: { model: "stand-in-model", instructions: "Stand-in instructions for the medium step." },
    describe: { model: "stand-in-model", instructions: "Stand-in instructions for the describe step." },
  },
}

/** The engine's custom-style route: internal only, answering what a test sets. */
const engine = {
  calls: [] as Array<{ body: unknown; user: unknown }>,
  status: 200,
  reply: {} as unknown,
}

let app: FastifyInstance

async function build(withEngineRoute = true) {
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-internal-orchestrator-secret"] === SECRET) {
      req.userId = String(req.headers["x-internal-user-id"])
      return
    }
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  if (withEngineRoute) {
    app.post("/v1/cast-swap/custom-style", async (req, reply) => {
      if (req.headers["x-internal-orchestrator-secret"] !== SECRET) return reply.status(403).send({ error: { code: "custom_style_internal_only", message: "Internal only" } })
      engine.calls.push({ body: req.body, user: req.userId })
      return reply.status(engine.status).send(engine.reply)
    })
  }
  await app.register(adminNodaroMotionRoutes)
  await app.register(castSwapStyleChoiceRoutes)
  await app.ready()
}

beforeEach(async () => {
  h.rows = new Map()
  h.upserts = []
  h.audits = []
  h.admin = true
  h.offeredByDefault = true
  engine.calls = []
  engine.status = 200
  engine.reply = { ...ENGINE_ANSWER, problems: [] }
  invalidateSettingsCache()
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { ...CS, customStyle: true } })
  await build()
})

afterEach(async () => {
  await app.close()
  _resetPluginSupportsForTests()
})

const put = (customStyle: unknown, headers: Record<string, string> = as) => app.inject({ method: "PUT", url: URL, headers, payload: { customStyle } as object })
const adminGet = (headers: Record<string, string> = as) => app.inject({ method: "GET", url: URL, headers })
const defaults = (headers: Record<string, string> = as) => app.inject({ method: "GET", url: `${URL}/defaults`, headers })
const check = (customStyle: unknown, headers: Record<string, string> = as) => app.inject({ method: "POST", url: `${URL}/check`, headers, payload: { customStyle } as object })
const offered = async () => (await app.inject({ method: "GET", url: PUBLIC_URL })).json().customStyle["nodaro-prism"]

describe("admin only", () => {
  it("refuses a guest (401) and a non-admin (403) on every route, writing nothing and asking the engine nothing", async () => {
    for (const call of [() => adminGet({}), () => put({ enabled: true }, {}), () => defaults({}), () => check({ medium: { model: "m" } }, {})]) {
      expect((await call()).statusCode).toBe(401)
    }
    h.admin = false
    for (const call of [() => adminGet(), () => put({ enabled: true }), () => defaults(), () => check({ medium: { model: "m" } })]) {
      expect((await call()).statusCode).toBe(403)
    }
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
    expect(engine.calls).toEqual([])
  })
})

describe("GET /v1/admin/video-remake/custom-style", () => {
  it("never saved: the deployment's default — on for Nodaro's own, off under a white-label profile", async () => {
    expect((await adminGet()).json().data).toEqual({ customStyle: null, enabled: true, enabledByDefault: true, updatedAt: null, supported: true })
    h.offeredByDefault = false
    expect((await adminGet()).json().data).toEqual({ customStyle: null, enabled: false, enabledByDefault: false, updatedAt: null, supported: true })
  })

  it("answers the stored row, the saved choice over the default, and whether this environment's engine takes it", async () => {
    h.rows.set(KEY, { value: { enabled: false, medium: { model: "some-model" }, later: 1 }, updated_at: "2026-11-19T10:00:00.000Z" })
    expect((await adminGet()).json().data).toEqual({
      customStyle: { enabled: false, medium: { model: "some-model" } },
      enabled: false,
      enabledByDefault: true,
      updatedAt: "2026-11-19T10:00:00.000Z",
      supported: true,
    })
    setPluginSupports({ castSwap: CS })
    expect((await adminGet()).json().data.supported).toBe(false)
  })
})

describe("PUT /v1/admin/video-remake/custom-style", () => {
  it("saves the admin's choice, and the public style-choice follows it over the settings cache, both ways", async () => {
    // Read (and cached) before the save: the save must clear the cache.
    expect(await offered()).toBe(true)
    let res = await put({ enabled: false })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ customStyle: { enabled: false }, enabled: false, enabledByDefault: true, updatedAt: expect.any(String), supported: true })
    expect(h.upserts).toEqual([{ key: KEY, value: { enabled: false }, updated_at: expect.any(String), updated_by: ADMIN }])
    expect(await offered()).toBe(false)

    // A white-label deployment's admin turns it on: the saved choice wins over the default.
    h.offeredByDefault = false
    res = await put({ enabled: true })
    expect(res.json().data).toMatchObject({ customStyle: { enabled: true }, enabled: true, enabledByDefault: false })
    expect(await offered()).toBe(true)
    // The switch alone asks the engine nothing.
    expect(engine.calls).toEqual([])
  })

  it("stores no choice when none is sent: the deployment's default goes on deciding", async () => {
    const res = await put({ describe: { model: " another-model " } })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([{ key: KEY, value: { describe: { model: "another-model" } }, updated_at: expect.any(String), updated_by: ADMIN }])
    expect(res.json().data).toMatchObject({ enabled: true, enabledByDefault: true })
    h.offeredByDefault = false
    invalidateSettingsCache()
    expect((await adminGet()).json().data.enabled).toBe(false)
    expect(await offered()).toBe(false)
  })

  it("asks this environment's engine about the steps, as the admin with the platform's secret, and saves what it accepts", async () => {
    const res = await put({ enabled: true, medium: { instructions: "Read the words.", model: "some-model" }, describe: { instructions: "   " } })
    expect(res.statusCode).toBe(200)
    // The steps alone, a blank one left out; never the switch.
    expect(engine.calls).toEqual([{ body: { setting: { medium: { instructions: "Read the words.", model: "some-model" } } }, user: ADMIN }])
    expect(h.upserts).toEqual([
      { key: KEY, value: { enabled: true, medium: { instructions: "Read the words.", model: "some-model" } }, updated_at: expect.any(String), updated_by: ADMIN },
    ])
  })

  it("refuses a save the engine finds a problem in, each named under customStyle, writing nothing", async () => {
    engine.reply = {
      ...ENGINE_ANSWER,
      problems: [
        { path: "medium.model", code: "unknown_model", message: "This platform does not serve that LLM." },
        { path: "describe.instructions", code: "instructions_too_long", message: "The instructions are at most 8000 characters." },
      ],
    }
    const res = await put({ medium: { model: "no-such-model" }, describe: { instructions: "x".repeat(9000) } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({
      code: "validation_error",
      message: "customStyle.medium.model: This platform does not serve that LLM. (+1 more)",
      issues: [
        { path: "customStyle.medium.model", code: "unknown_model", message: "This platform does not serve that LLM." },
        { path: "customStyle.describe.instructions", code: "instructions_too_long", message: "The instructions are at most 8000 characters." },
      ],
    })
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("answers 502 when the engine answers unexpectedly, writing nothing", async () => {
    for (const broken of [{ status: 500, reply: { error: { code: "boom" } } }, { status: 200, reply: "nonsense" }, { status: 200, reply: { problems: "none" } }]) {
      engine.status = broken.status
      engine.reply = broken.reply
      const res = await put({ medium: { model: "some-model" } })
      expect(res.statusCode, JSON.stringify(broken)).toBe(502)
      expect(res.json().error.code).toBe("engine_error")
    }
    expect(h.upserts).toEqual([])
  })

  it("an engine from before the custom style: nothing is asked and the save goes through", async () => {
    // It does not declare castSwap.customStyle.
    setPluginSupports({ castSwap: CS })
    expect((await put({ enabled: true, medium: { model: "some-model" } })).statusCode).toBe(200)
    expect(engine.calls).toEqual([])
    // It declares it, yet has no such route (404).
    await app.close()
    setPluginSupports({ castSwap: { ...CS, customStyle: true } })
    await build(false)
    expect((await put({ describe: { model: "another-model" } })).statusCode).toBe(200)
    expect(h.upserts).toHaveLength(2)
  })

  it("is strict: an unknown key or a value of another type is 400 and writes nothing", async () => {
    for (const customStyle of [{ enabled: "yes" }, { engine: "nodaro-prism" }, { medium: "text" }, { medium: { prompt: "x" } }, { describe: { model: 5 } }, null, true, []]) {
      const res = await put(customStyle)
      expect(res.statusCode, JSON.stringify(customStyle)).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { enabled: true } })).statusCode).toBe(400)
    expect(h.upserts).toEqual([])
    expect(engine.calls).toEqual([])
  })

  it("audits each save with the setting before and after, under an id of its own", async () => {
    await put({ enabled: false })
    await put({ enabled: true, medium: { model: "some-model" } })
    expect(h.audits).toEqual([
      {
        admin_user_id: ADMIN,
        action: "update_nodaro_motion_custom_style",
        target_type: "app_setting",
        target_id: NODARO_MOTION_CUSTOM_STYLE_AUDIT_TARGET,
        payload: { key: KEY, before: null, after: { enabled: false } },
      },
      {
        admin_user_id: ADMIN,
        action: "update_nodaro_motion_custom_style",
        target_type: "app_setting",
        target_id: NODARO_MOTION_CUSTOM_STYLE_AUDIT_TARGET,
        payload: { key: KEY, before: { enabled: false }, after: { enabled: true, medium: { model: "some-model" } } },
      },
    ])
    expect(NODARO_MOTION_CUSTOM_STYLE_AUDIT_TARGET).toBe("00000000-0000-4000-8000-00000000a0fe")
  })

  it("is a settings section: a stored set holds it", () => {
    expect(NODARO_MOTION_SETTINGS_SECTIONS.map((s) => s.key)).toContain("custom-style")
  })
})

describe("GET /v1/admin/video-remake/custom-style/defaults", () => {
  it("answers the engine's own defaults and limits, without the problems of a setting nobody sent", async () => {
    const res = await defaults()
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(ENGINE_ANSWER)
    expect(engine.calls).toEqual([{ body: {}, user: ADMIN }])
  })

  it("answers null where this environment's engine has none, and 502 when it answers unexpectedly", async () => {
    engine.status = 500
    expect((await defaults()).statusCode).toBe(502)
    setPluginSupports({ castSwap: CS })
    const res = await defaults()
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toBeNull()
  })
})

describe("POST /v1/admin/video-remake/custom-style/check", () => {
  it("answers the engine's problems under customStyle and saves nothing", async () => {
    engine.reply = { ...ENGINE_ANSWER, problems: [{ path: "describe.model", code: "unknown_model", message: "This platform does not serve that LLM." }] }
    const res = await check({ describe: { model: "no-such-model" } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ problems: [{ path: "customStyle.describe.model", code: "unknown_model", message: "This platform does not serve that LLM." }] })
    expect(h.upserts).toEqual([])
  })

  it("answers no problems where there is no engine to ask, 400 on a body that is not the setting, 502 on an unexpected answer", async () => {
    expect((await check({ medium: "text" })).statusCode).toBe(400)
    engine.status = 500
    expect((await check({ medium: { model: "m" } })).statusCode).toBe(502)
    setPluginSupports({ castSwap: CS })
    expect((await check({ medium: { model: "m" } })).json().data).toEqual({ problems: [] })
  })
})
