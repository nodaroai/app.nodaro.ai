import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/nodaro-motion/steps` — the admin's preparation steps per Nodaro
 * Motion engine (for direct runs), and the engine's defaults and check behind
 * the step editors.
 *
 * What must hold:
 *  - every route is admin-only;
 *  - GET answers the saved row (null until saved) with both engines named;
 *  - PUT checks each entry as a save (a known model), each problem named by
 *    its path under `steps`; empty entries are dropped; anything set is 409
 *    `engine_unsupported` while an environment's engine cannot take steps
 *    (nothing set never is); a save clears the settings cache and leaves an
 *    `admin_actions` row;
 *  - defaults asks this environment's engine (`POST /v1/cast-swap/steps`,
 *    internal only) with the engine's current public id, and answers its JSON;
 *    an engine without `castSwap.steps` is never asked (null), its 404 is
 *    null, any other refusal is a fixed 502 (never the engine's words);
 *  - check answers the platform's problems and, for an engine that takes
 *    steps, the engine's, under the same paths; nothing is saved.
 *
 * The engine route is a stub on the same app; the texts it answers are dummies.
 */
const h = vi.hoisted(() => ({
  row: null as { value: unknown; updated_at: string } | null,
  upserts: [] as unknown[],
  audits: [] as Record<string, unknown>[],
  admin: true,
  invalidated: 0,
  envs: [] as { env: string; pluginBuildId: string | null; supports: Record<string, unknown>; updatedAt: string }[],
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
        eq: (_c: string, key: string) => (expect(key).toBe("nodaro_motion_steps"), chain),
        maybeSingle: async () => ({ data: h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }, opts: unknown) => {
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
  listEngineEnvironments: async () => h.envs,
}))

const { adminNodaroMotionRoutes } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_STEPS_AUDIT_TARGET } = await import("../admin-nodaro-motion-steps.js")
const { NODARO_MOTION_MASKING_AUDIT_TARGET } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET } = await import("../admin-nodaro-motion-prompt-parts.js")
const { NODARO_MOTION_MOTION_AUDIT_TARGET } = await import("../admin-nodaro-motion-motion.js")
const { NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET } = await import("../admin-nodaro-motion-pulse-audio.js")
const { NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET } = await import("../admin-nodaro-motion-prism-reference-audio.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const SECRET = "0".repeat(64) // src/test/setup.ts
const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/nodaro-motion/steps"
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const STEPS = { castSwap: { steps: true } }
const envRow = (env: string, supports: Record<string, unknown>) => ({ env, pluginBuildId: null, supports, updatedAt: "2026-10-31T00:00:00.000Z" })
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
]

const TEMPLATE = { enginePrompt: { mode: "template" } }
const llm = (model: string) => ({ mode: "llm", llm: { model, instructions: "test instructions", inputs: ["extraPrompt"], maxChars: 1000 } })

/** The engine's steps route: internal only, answering what a test sets. */
const engine = {
  calls: [] as Array<Record<string, unknown>>,
  status: 200,
  reply: {} as unknown,
}

let app: FastifyInstance

function build(withEngineRoute = true) {
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-internal-orchestrator-secret"] === SECRET) {
      req.userId = String(req.headers["x-internal-user-id"])
      return
    }
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  if (withEngineRoute) {
    app.post("/v1/cast-swap/steps", async (req, reply) => {
      if (req.headers["x-internal-orchestrator-secret"] !== SECRET) return reply.status(403).send({ error: { code: "forbidden", message: "Internal only" } })
      engine.calls.push(req.body as Record<string, unknown>)
      return reply.status(engine.status).send(engine.reply)
    })
  }
  return app
}

beforeEach(async () => {
  h.row = null
  h.upserts = []
  h.audits = []
  h.admin = true
  h.invalidated = 0
  h.envs = [envRow("production", STEPS), envRow("staging", STEPS)]
  engine.calls = []
  engine.status = 200
  engine.reply = { conditions: ["head-body"], defaults: { labeller: { instructions: "test instructions" } }, problems: [] }
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { ...CS, steps: true } })
  build()
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  _resetPluginSupportsForTests()
})

const put = (steps: unknown, headers: Record<string, string> = as) => app.inject({ method: "PUT", url: URL, headers, payload: { steps } })
const check = (body: unknown, headers: Record<string, string> = as) => app.inject({ method: "POST", url: `${URL}/check`, headers, payload: body as object })
const defaults = (engineId: string, headers: Record<string, string> = as) =>
  app.inject({ method: "GET", url: `${URL}/defaults?engine=${encodeURIComponent(engineId)}`, headers })

describe("admin only", () => {
  it("refuses a guest (401) and a non-admin (403) on every route, and asks the engine nothing", async () => {
    const calls = [
      () => app.inject({ method: "GET", url: URL, headers: {} }),
      () => put(TEMPLATE, {}),
      () => defaults("motion-prism", {}),
      () => check({ engine: "motion-prism", steps: TEMPLATE }, {}),
    ]
    for (const c of calls) expect((await c()).statusCode).toBe(401)
    h.admin = false
    const asUser = [
      () => app.inject({ method: "GET", url: URL, headers: as }),
      () => put({ "motion-prism": TEMPLATE }),
      () => defaults("motion-prism"),
      () => check({ engine: "motion-prism", steps: TEMPLATE }),
    ]
    for (const c of asUser) expect((await c()).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
    expect(engine.calls).toEqual([])
  })
})

describe("GET /v1/admin/nodaro-motion/steps", () => {
  it("answers null until saved, with both engines named", async () => {
    const res = await app.inject({ method: "GET", url: URL, headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { steps: null, updatedAt: null, engines: ENGINES } })
  })

  it("answers the saved row (an earlier key read as the current one)", async () => {
    h.row = { value: { "motion-lite": TEMPLATE }, updated_at: "2026-10-31T10:00:00.000Z" }
    const res = await app.inject({ method: "GET", url: URL, headers: as })
    expect(res.json().data).toEqual({ steps: { "motion-pulse": TEMPLATE }, updatedAt: "2026-10-31T10:00:00.000Z", engines: ENGINES })
  })
})

describe("PUT /v1/admin/nodaro-motion/steps", () => {
  it("saves and audits", async () => {
    const res = await put({ "motion-prism": TEMPLATE, "motion-pulse": {} })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([
      { key: "nodaro_motion_steps", value: { "motion-prism": TEMPLATE, "motion-pro": TEMPLATE }, updated_at: expect.any(String), updated_by: ADMIN },
    ])
    expect(h.invalidated).toBe(1)
    expect(res.json().data).toEqual({ steps: { "motion-prism": TEMPLATE }, updatedAt: expect.any(String), engines: ENGINES })
    expect(h.audits).toEqual([
      {
        admin_user_id: ADMIN,
        action: "update_nodaro_motion_steps",
        target_type: "app_setting",
        target_id: NODARO_MOTION_STEPS_AUDIT_TARGET,
        payload: { key: "nodaro_motion_steps", before: null, after: { "motion-prism": TEMPLATE } },
      },
    ])
  })

  it("409s naming the environment without the capability, and saves nothing", async () => {
    for (const [envs, blocked] of [
      [[envRow("production", STEPS), envRow("staging", {})], ["staging"]],
      [[envRow("staging", STEPS)], ["production"]],
      [[], ["staging", "production"]],
    ] as const) {
      h.envs = [...envs]
      const res = await put({ "motion-pulse": TEMPLATE })
      expect(res.statusCode, JSON.stringify(envs)).toBe(409)
      expect(res.json().error).toEqual({ code: "engine_unsupported", envs: blocked, message: expect.stringMatching(/cannot take preparation steps/) })
    }
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("refuses an unknown model with its path, and saves nothing", async () => {
    const res = await put({ "motion-prism": { enginePrompt: llm("no-such-model") } })
    expect(res.statusCode).toBe(400)
    const error = res.json().error
    expect(error.code).toBe("validation_error")
    expect(error.issues).toEqual([{ path: "steps.motion-prism.enginePrompt.llm.model", code: "unknown_model", message: expect.any(String) }])
    expect(error.message).toMatch(/^steps\.motion-prism\.enginePrompt\.llm\.model: /)
    expect(h.upserts).toEqual([])
  })

  it("refuses an engine it does not know and an extra key", async () => {
    expect((await put({ "motion-max": TEMPLATE })).statusCode).toBe(400)
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { steps: {}, engine: "motion-prism" } })).statusCode).toBe(400)
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: {} })).statusCode).toBe(400)
    expect(h.upserts).toEqual([])
  })

  it("with only empty entries saves without the 409", async () => {
    h.envs = []
    const res = await put({ "motion-prism": {}, "motion-pulse": {} })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([{ key: "nodaro_motion_steps", value: {}, updated_at: expect.any(String), updated_by: ADMIN }])
    expect(h.audits[0]).toMatchObject({ action: "update_nodaro_motion_steps", payload: { key: "nodaro_motion_steps", before: null, after: {} } })
  })

  it("files its audit rows under an id of its own", () => {
    expect(
      new Set([
        NODARO_MOTION_STEPS_AUDIT_TARGET,
        NODARO_MOTION_MASKING_AUDIT_TARGET,
        NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET,
        NODARO_MOTION_MOTION_AUDIT_TARGET,
        NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET,
        NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET,
      ]).size,
    ).toBe(6)
  })
})

describe("GET /v1/admin/nodaro-motion/steps/defaults", () => {
  it("answers null when the engine lacks castSwap.steps (no call)", async () => {
    setPluginSupports({ castSwap: { ...CS } })
    const res = await defaults("motion-prism")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: null })
    expect(engine.calls).toEqual([])
  })

  it("forwards the normalised engine id and answers the engine's JSON", async () => {
    for (const [asked, sent] of [
      ["motion-prism", "motion-prism"],
      ["motion-pro", "motion-prism"],
      ["seedance-2-5", "motion-prism"],
      ["motion-pulse", "motion-pulse"],
      ["motion-lite", "motion-pulse"],
      ["kling-4", "motion-pulse"],
    ] as const) {
      engine.calls = []
      const res = await defaults(asked)
      expect(res.statusCode, asked).toBe(200)
      expect(res.json(), asked).toEqual({ data: engine.reply })
      expect(engine.calls, asked).toEqual([{ engine: sent }])
    }
  })

  it("reads an answer wrapped in data the same", async () => {
    engine.reply = { data: { conditions: ["unclear"], problems: [] } }
    expect((await defaults("motion-pulse")).json()).toEqual({ data: { conditions: ["unclear"], problems: [] } })
  })

  it("answers null when the engine has no such route (404)", async () => {
    await app.close()
    build(false)
    await app.register(adminNodaroMotionRoutes)
    await app.ready()
    const res = await defaults("motion-prism")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: null })
  })

  it("answers a fixed error for any other refusal, never the engine's words", async () => {
    engine.status = 500
    engine.reply = { error: { code: "boom", message: "provider secret detail" } }
    const res = await defaults("motion-prism")
    expect(res.statusCode).toBe(502)
    expect(res.json()).toEqual({ error: { code: "engine_error", message: "Nodaro Motion answered unexpectedly." } })
    expect(res.body).not.toContain("provider secret detail")
  })

  it("refuses an engine id it does not know", async () => {
    expect((await defaults("motion-max")).statusCode).toBe(400)
    expect((await app.inject({ method: "GET", url: `${URL}/defaults`, headers: as })).statusCode).toBe(400)
    expect(engine.calls).toEqual([])
  })
})

describe("POST /v1/admin/nodaro-motion/steps/check", () => {
  it("merges the platform's and the engine's problems", async () => {
    engine.reply = {
      problems: [
        { path: "enginePrompt.llm.model", code: "unknown_model", message: "engine says unknown" },
        { path: "sheets.rules", code: "invalid_value", message: "engine rule" },
      ],
    }
    const steps = { enginePrompt: llm("no-such-model") }
    const res = await check({ engine: "kling-4", steps })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: {
        problems: [
          { path: "steps.enginePrompt.llm.model", code: "unknown_model", message: expect.any(String) },
          { path: "steps.sheets.rules", code: "invalid_value", message: "engine rule" },
        ],
      },
    })
    expect(res.json().data.problems[0].message).not.toBe("engine says unknown")
    expect(engine.calls).toEqual([{ engine: "motion-pulse", steps }])
    expect(h.upserts).toEqual([])
  })

  it("answers no problems for a clean setting", async () => {
    engine.reply = { problems: [] }
    const res = await check({ engine: "motion-prism", steps: TEMPLATE })
    expect(res.json()).toEqual({ data: { problems: [] } })
  })

  it("answers the platform's problems alone for an engine without castSwap.steps (no call)", async () => {
    setPluginSupports({ castSwap: { ...CS } })
    const res = await check({ engine: "motion-prism", steps: { enginePrompt: llm("no-such-model") } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.problems).toEqual([{ path: "steps.enginePrompt.llm.model", code: "unknown_model", message: expect.any(String) }])
    expect(engine.calls).toEqual([])
  })

  it("answers a fixed error when the engine refuses, never the engine's words", async () => {
    engine.status = 400
    engine.reply = { error: { code: "validation_error", message: "provider secret detail" } }
    const res = await check({ engine: "motion-prism", steps: TEMPLATE })
    expect(res.statusCode).toBe(502)
    expect(res.body).not.toContain("provider secret detail")
  })

  it("refuses a body without a known engine", async () => {
    expect((await check({ engine: "motion-max", steps: TEMPLATE })).statusCode).toBe(400)
    expect((await check({ steps: TEMPLATE })).statusCode).toBe(400)
    expect(engine.calls).toEqual([])
  })
})
