import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/nodaro-motion/style-only` — what a direct style-only run does,
 * per engine (a Prism Flex run with an art style and nothing to swap).
 *
 * What must hold:
 *  - both routes are admin-only;
 *  - GET answers the saved row (null until saved), both engines named, and
 *    whether this environment's engine runs style-only runs
 *    (`castSwap.styleOnly`);
 *  - PUT is strict (an unknown engine, path or key is 400); the save-time
 *    step rules are applied (`issues`, rooted at `styleOnly.`); a changed
 *    Pulse entry is 400 `style_only_engine`; the defaults are left out of
 *    what is stored;
 *  - a change is 409 `engine_unsupported` only while NO environment's engine
 *    declares `castSwap.styleOnly` (one reader is enough); the defaults are
 *    saved whatever the engines;
 *  - a save clears the settings cache and leaves an `admin_actions` row under
 *    an id of its own.
 * Also the gate module's every-environment rule, used by the prompt parts.
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
        eq: (_c: string, key: string) => (expect(key).toBe("nodaro_motion_style_only"), chain),
        maybeSingle: async () => ({ data: h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }, opts: unknown) => {
          expect(row.key).toBe("nodaro_motion_style_only")
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

const { adminNodaroMotionRoutes, NODARO_MOTION_MASKING_AUDIT_TARGET } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_STYLE_AUDIT_TARGET } = await import("../admin-nodaro-motion-style.js")
const { NODARO_MOTION_PROMPT_WORDING_AUDIT_TARGET } = await import("../admin-nodaro-motion-prompt-wording.js")
const { NODARO_MOTION_STYLE_ONLY_AUDIT_TARGET } = await import("../admin-nodaro-motion-style-only.js")
const { NODARO_MOTION_STEPS_AUDIT_TARGET } = await import("../admin-nodaro-motion-steps.js")
const { NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET } = await import("../admin-nodaro-motion-prompt-parts.js")
const { NODARO_MOTION_MOTION_AUDIT_TARGET } = await import("../admin-nodaro-motion-motion.js")
const { NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET } = await import("../admin-nodaro-motion-pulse-audio.js")
const { NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET } = await import("../admin-nodaro-motion-prism-reference-audio.js")
const { NODARO_MOTION_ADVANCED_AUDIT_TARGET } = await import("../admin-nodaro-motion-advanced.js")
const { NO_ENGINE_RUNS_STYLE_ONLY_MESSAGE, cannotRunStyleOnlyMessage, environmentsThatCannotRunStyleOnly, noEnvironmentRunsStyleOnly } = await import(
  "../../lib/nodaro-motion-style-only-gate.js"
)
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/nodaro-motion/style-only"
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const envRow = (env: string, castSwap: Record<string, unknown>) => ({ env, pluginBuildId: null, supports: { castSwap: { ...CS, ...castSwap } }, updatedAt: "2026-11-01T00:00:00.000Z" })
const RUNS = { styleOnly: true }
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
]
const llm = (model: string) => ({ mode: "llm", llm: { model, instructions: "test instructions", inputs: ["extraPrompt"], maxChars: 1000 } })

let app: FastifyInstance

beforeEach(async () => {
  h.row = null
  h.upserts = []
  h.audits = []
  h.admin = true
  h.invalidated = 0
  h.envs = [envRow("production", RUNS), envRow("staging", RUNS)]
  h.envReads = 0
  _resetPluginSupportsForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const put = (styleOnly: unknown, headers: Record<string, string> = as) => app.inject({ method: "PUT", url: URL, headers, payload: { styleOnly } })

describe("GET /v1/admin/nodaro-motion/style-only", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: URL, headers: as })).statusCode).toBe(403)
  })

  it("answers null until it is saved, both engines, and whether this engine runs style-only runs", async () => {
    const res = await app.inject({ method: "GET", url: URL, headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ styleOnly: null, updatedAt: null, engines: ENGINES, supported: false })
    setPluginSupports({ castSwap: { ...CS } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.supported).toBe(false)
    setPluginSupports({ castSwap: { ...CS, styleOnly: true } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.supported).toBe(true)
  })

  it("answers the stored row, an earlier engine key read as the current one and the defaults left out", async () => {
    h.row = { value: { "motion-pro": { path: "flex" }, "motion-lite": { path: "original" } }, updated_at: "2026-11-01T10:00:00.000Z" }
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data).toMatchObject({
      styleOnly: { "motion-prism": { path: "flex" } },
      updatedAt: "2026-11-01T10:00:00.000Z",
    })
  })
})

describe("PUT /v1/admin/nodaro-motion/style-only", () => {
  it("is admin-only, and writes nothing for a non-admin", async () => {
    h.admin = false
    expect((await put({ "motion-prism": { path: "flex" } })).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
  })

  it("saves the change, the defaults left out, clears the cache and audits before and after", async () => {
    const res = await put({ "motion-prism": { path: "flex", enginePrompt: { mode: "template" } } })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([{ key: "nodaro_motion_style_only", value: { "motion-prism": { path: "flex" } }, updated_at: expect.any(String), updated_by: ADMIN }])
    expect(h.invalidated).toBe(1)
    expect(res.json().data).toMatchObject({ styleOnly: { "motion-prism": { path: "flex" } }, engines: ENGINES })
    expect(h.audits).toEqual([
      {
        admin_user_id: ADMIN,
        action: "update_nodaro_motion_style_only",
        target_type: "app_setting",
        target_id: NODARO_MOTION_STYLE_ONLY_AUDIT_TARGET,
        payload: { key: "nodaro_motion_style_only", before: null, after: { "motion-prism": { path: "flex" } } },
      },
    ])
    const prompt = llm("gemini-3.8-flash")
    const second = await put({ "motion-prism": { enginePrompt: prompt } })
    expect(second.statusCode).toBe(200)
    expect(second.json().data.styleOnly).toEqual({ "motion-prism": { enginePrompt: prompt } })
    expect(h.audits[1]!.payload).toEqual({
      key: "nodaro_motion_style_only",
      before: { "motion-prism": { path: "flex" } },
      after: { "motion-prism": { enginePrompt: prompt } },
    })
  })

  it("never stores an unset key, not even as null", async () => {
    await put({ "motion-prism": { path: "flex" } })
    const stored = (h.upserts[0] as { value: Record<string, Record<string, unknown>> }).value
    expect(Object.keys(stored)).toEqual(["motion-prism"])
    expect(Object.keys(stored["motion-prism"]!)).toEqual(["path"])
  })

  it("refuses an unknown engine, path or key", async () => {
    for (const s of [
      { "motion-pro": { path: "flex" } },
      { "motion-prism": { path: "depth" } },
      { "motion-prism": { path: "flex", extra: 1 } },
      { "motion-prism": null },
      "flex",
      null,
    ]) {
      const res = await put(s)
      expect(res.statusCode, JSON.stringify(s)).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { styleOnly: {}, engine: "motion-prism" } })).statusCode).toBe(400)
    expect(h.upserts).toEqual([])
  })

  it("refuses an engine prompt on a model it does not know, with its path, and saves nothing", async () => {
    const res = await put({ "motion-prism": { path: "flex", enginePrompt: llm("no-such-model") } })
    expect(res.statusCode).toBe(400)
    const error = res.json().error
    expect(error.code).toBe("validation_error")
    expect(error.issues[0]).toEqual({ path: "styleOnly.motion-prism.enginePrompt.llm.model", code: "unknown_model", message: expect.any(String) })
    expect(error.message).toMatch(/^styleOnly\.motion-prism\.enginePrompt\.llm\.model: /)
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("refuses a changed Pulse entry (art styles are Prism's), and saves a Pulse entry on the defaults", async () => {
    for (const s of [{ "motion-pulse": { path: "flex" } }, { "motion-pulse": { enginePrompt: llm("gemini-3.8-flash") } }]) {
      const res = await put(s)
      expect(res.statusCode, JSON.stringify(s)).toBe(400)
      expect(res.json().error).toEqual({ code: "style_only_engine", message: "Nodaro Motion Pulse takes no art style, so it runs no style-only runs." })
    }
    expect(h.upserts).toEqual([])
    const res = await put({ "motion-pulse": { path: "original", enginePrompt: { mode: "template" } } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.styleOnly).toEqual({})
  })

  it("saves a change once one environment's engine runs style-only runs", async () => {
    h.envs = [envRow("production", {}), envRow("staging", RUNS)]
    const res = await put({ "motion-prism": { path: "flex" } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.styleOnly).toEqual({ "motion-prism": { path: "flex" } })
    expect(h.upserts).toHaveLength(1)
  })

  it("refuses a change (409 engine_unsupported) while no environment's engine runs style-only runs", async () => {
    for (const envs of [[], [envRow("production", {})], [envRow("production", { styleOnly: false }), envRow("staging", {})], [envRow("dev", RUNS)]]) {
      h.envs = envs
      const res = await put({ "motion-prism": { path: "flex" } })
      expect(res.statusCode, JSON.stringify(envs)).toBe(409)
      expect(res.json().error).toEqual({ code: "engine_unsupported", message: NO_ENGINE_RUNS_STYLE_ONLY_MESSAGE, envs: [] })
    }
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("always saves the defaults, whatever the engines, so a change can be taken back", async () => {
    h.row = { value: { "motion-prism": { path: "flex" } }, updated_at: "2026-11-01T10:00:00.000Z" }
    h.envs = []
    for (const s of [{}, { "motion-prism": { path: "original" } }, { "motion-prism": { enginePrompt: { mode: "template" } } }]) {
      const res = await put(s)
      expect(res.statusCode, JSON.stringify(s)).toBe(200)
      expect(res.json().data.styleOnly).toEqual({})
    }
    expect(h.envReads).toBe(0)
    expect(h.upserts.map((u) => (u as { value: unknown }).value)).toEqual([{}, {}, {}])
    expect(h.audits[0]!.payload).toEqual({ key: "nodaro_motion_style_only", before: { "motion-prism": { path: "flex" } }, after: {} })
  })

  it("files its audit rows under an id of its own", () => {
    const ids = [
      NODARO_MOTION_STYLE_ONLY_AUDIT_TARGET,
      NODARO_MOTION_PROMPT_WORDING_AUDIT_TARGET,
      NODARO_MOTION_STYLE_AUDIT_TARGET,
      NODARO_MOTION_STEPS_AUDIT_TARGET,
      NODARO_MOTION_MASKING_AUDIT_TARGET,
      NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET,
      NODARO_MOTION_MOTION_AUDIT_TARGET,
      NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET,
      NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET,
      NODARO_MOTION_ADVANCED_AUDIT_TARGET,
    ]
    expect(new Set(ids).size).toBe(ids.length)
    expect(NODARO_MOTION_STYLE_ONLY_AUDIT_TARGET).toBe("00000000-0000-4000-8000-00000000a0fa")
  })
})

describe("the style-only gate", () => {
  it("no environment runs it until one publish environment's recorded engine declares castSwap.styleOnly", () => {
    expect(noEnvironmentRunsStyleOnly([])).toBe(true)
    expect(noEnvironmentRunsStyleOnly([envRow("production", {}), envRow("staging", { styleOnly: false })])).toBe(true)
    expect(noEnvironmentRunsStyleOnly([envRow("dev", RUNS)])).toBe(true)
    expect(noEnvironmentRunsStyleOnly([envRow("staging", RUNS)])).toBe(false)
    expect(noEnvironmentRunsStyleOnly([envRow("production", RUNS), envRow("staging", {})])).toBe(false)
  })

  it("lists, in publish order, each environment whose engine cannot run it (the every-environment rule)", () => {
    expect(environmentsThatCannotRunStyleOnly([])).toEqual(["staging", "production"])
    expect(environmentsThatCannotRunStyleOnly([envRow("production", RUNS)])).toEqual(["staging"])
    expect(environmentsThatCannotRunStyleOnly([envRow("production", {}), envRow("staging", RUNS)])).toEqual(["production"])
    expect(environmentsThatCannotRunStyleOnly([envRow("production", RUNS), envRow("staging", RUNS), envRow("dev", {})])).toEqual([])
  })

  it("names those environments in its refusal", () => {
    expect(cannotRunStyleOnlyMessage(["staging", "production"])).toBe(
      "The Cast Swap engine in staging and production cannot run style-only runs yet, and this setting is shared by every environment: keep the defaults (Original clip, Template), or wait for the engine.",
    )
    expect(NO_ENGINE_RUNS_STYLE_ONLY_MESSAGE).toBe("No Cast Swap engine runs style-only runs yet: keep the defaults (Original clip, Template), or wait for the engine.")
  })
})
