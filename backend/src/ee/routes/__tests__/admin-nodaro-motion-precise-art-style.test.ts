import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/nodaro-motion/precise-art-style` — how a direct Precise run with
 * an art style opens its prompt, per engine ("restyle", the default, or
 * "edit").
 *
 * What must hold:
 *  - both routes are admin-only;
 *  - GET answers the saved row (null until saved), both engines named, and
 *    whether this environment's engine takes an art style on a Precise run
 *    (`castSwap.preciseArtStyle`);
 *  - PUT is strict (an unknown engine, opener or key is 400); a changed Pulse
 *    entry is 400 `precise_art_style_engine`; the default is left out of
 *    what is stored;
 *  - a change is 409 `engine_unsupported` only while NO environment's engine
 *    declares `castSwap.preciseArtStyle` (one reader is enough); the default
 *    is saved whatever the engines;
 *  - a save clears the settings cache and leaves an `admin_actions` row under
 *    an id of its own.
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
        eq: (_c: string, key: string) => (expect(key).toBe("nodaro_motion_precise_art_style"), chain),
        maybeSingle: async () => ({ data: h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }, opts: unknown) => {
          expect(row.key).toBe("nodaro_motion_precise_art_style")
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
const { NODARO_MOTION_PRECISE_ART_STYLE_AUDIT_TARGET } = await import("../admin-nodaro-motion-precise-art-style.js")
const { NO_ENGINE_RUNS_PRECISE_ART_STYLE_MESSAGE, noEnvironmentRunsPreciseArtStyle } = await import("../../lib/nodaro-motion-precise-art-style-gate.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/nodaro-motion/precise-art-style"
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const envRow = (env: string, castSwap: Record<string, unknown>) => ({ env, pluginBuildId: null, supports: { castSwap: { ...CS, ...castSwap } }, updatedAt: "2026-11-01T00:00:00.000Z" })
const RUNS = { preciseArtStyle: true }
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
]

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

const put = (preciseArtStyle: unknown, headers: Record<string, string> = as) => app.inject({ method: "PUT", url: URL, headers, payload: { preciseArtStyle } })

describe("GET /v1/admin/nodaro-motion/precise-art-style", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: URL, headers: as })).statusCode).toBe(403)
  })

  it("answers null until it is saved, both engines, and whether this engine takes an art style on a Precise run", async () => {
    const res = await app.inject({ method: "GET", url: URL, headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ preciseArtStyle: null, updatedAt: null, engines: ENGINES, supported: false })
    setPluginSupports({ castSwap: { ...CS } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.supported).toBe(false)
    setPluginSupports({ castSwap: { ...CS, preciseArtStyle: true } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.supported).toBe(true)
  })

  it("answers the stored row, an earlier engine key read as the current one and the default left out", async () => {
    h.row = { value: { "motion-pro": { opener: "edit" }, "motion-lite": { opener: "restyle" } }, updated_at: "2026-11-04T10:00:00.000Z" }
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data).toMatchObject({
      preciseArtStyle: { "motion-prism": { opener: "edit" } },
      updatedAt: "2026-11-04T10:00:00.000Z",
    })
  })
})

describe("PUT /v1/admin/nodaro-motion/precise-art-style", () => {
  it("is admin-only, and writes nothing for a non-admin", async () => {
    h.admin = false
    expect((await put({ "motion-prism": { opener: "edit" } })).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
  })

  it("saves the change, clears the cache and audits before and after", async () => {
    const res = await put({ "motion-prism": { opener: "edit" } })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([{ key: "nodaro_motion_precise_art_style", value: { "motion-prism": { opener: "edit" } }, updated_at: expect.any(String), updated_by: ADMIN }])
    expect(h.invalidated).toBe(1)
    expect(res.json().data).toMatchObject({ preciseArtStyle: { "motion-prism": { opener: "edit" } }, engines: ENGINES })
    expect(h.audits).toEqual([
      {
        admin_user_id: ADMIN,
        action: "update_nodaro_motion_precise_art_style",
        target_type: "app_setting",
        target_id: NODARO_MOTION_PRECISE_ART_STYLE_AUDIT_TARGET,
        payload: { key: "nodaro_motion_precise_art_style", before: null, after: { "motion-prism": { opener: "edit" } } },
      },
    ])
  })

  it("refuses an unknown engine, opener or key", async () => {
    for (const s of [
      { "motion-pro": { opener: "edit" } },
      { "motion-prism": { opener: "Edit" } },
      { "motion-prism": { opener: "edit", extra: 1 } },
      { "motion-prism": "edit" },
      { "motion-prism": null },
      "edit",
      null,
    ]) {
      const res = await put(s)
      expect(res.statusCode, JSON.stringify(s)).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { preciseArtStyle: {}, engine: "motion-prism" } })).statusCode).toBe(400)
    expect(h.upserts).toEqual([])
  })

  it("refuses a changed Pulse entry (art styles are Prism's), and saves a Pulse entry on the default", async () => {
    const res = await put({ "motion-pulse": { opener: "edit" } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "precise_art_style_engine", message: "Nodaro Motion Pulse takes no art style, so it has no Precise art-style setting." })
    expect(h.upserts).toEqual([])
    const ok = await put({ "motion-pulse": { opener: "restyle" } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data.preciseArtStyle).toEqual({})
  })

  it("saves a change once one environment's engine takes it", async () => {
    h.envs = [envRow("production", {}), envRow("staging", RUNS)]
    const res = await put({ "motion-prism": { opener: "edit" } })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toHaveLength(1)
  })

  it("refuses a change (409 engine_unsupported) while no environment's engine takes it", async () => {
    for (const envs of [[], [envRow("production", {})], [envRow("production", { preciseArtStyle: false }), envRow("staging", {})], [envRow("dev", RUNS)]]) {
      h.envs = envs
      const res = await put({ "motion-prism": { opener: "edit" } })
      expect(res.statusCode, JSON.stringify(envs)).toBe(409)
      expect(res.json().error).toEqual({ code: "engine_unsupported", message: NO_ENGINE_RUNS_PRECISE_ART_STYLE_MESSAGE, envs: [] })
    }
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("always saves the default, whatever the engines, so a change can be taken back", async () => {
    h.row = { value: { "motion-prism": { opener: "edit" } }, updated_at: "2026-11-04T10:00:00.000Z" }
    h.envs = []
    for (const s of [{}, { "motion-prism": {} }, { "motion-prism": { opener: "restyle" } }]) {
      const res = await put(s)
      expect(res.statusCode, JSON.stringify(s)).toBe(200)
      expect(res.json().data.preciseArtStyle).toEqual({})
    }
    expect(h.envReads).toBe(0)
    expect(h.upserts.map((u) => (u as { value: unknown }).value)).toEqual([{}, {}, {}])
    expect(h.audits[0]!.payload).toEqual({ key: "nodaro_motion_precise_art_style", before: { "motion-prism": { opener: "edit" } }, after: {} })
  })

  it("saves the Precise runs' own style-refs step as picked, Off included (no engine needed for Off)", async () => {
    h.envs = []
    const off = { mode: "off", send: "styled", prompt: "Draw the person as {style}." }
    const res = await put({ "motion-prism": { styleRefs: off } })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([{ key: "nodaro_motion_precise_art_style", value: { "motion-prism": { styleRefs: off } }, updated_at: expect.any(String), updated_by: ADMIN }])
    expect(h.envReads).toBe(0)
    expect(res.json().data.preciseArtStyle).toEqual({ "motion-prism": { styleRefs: off } })
  })

  it("the step On is a change: saved once one environment's engine takes it, 409 engine_unsupported while none does", async () => {
    h.envs = [envRow("production", {}), envRow("staging", RUNS)]
    const res = await put({ "motion-prism": { opener: "edit", styleRefs: { mode: "on" } } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.preciseArtStyle).toEqual({ "motion-prism": { opener: "edit", styleRefs: { mode: "on" } } })
    h.envs = []
    const refused = await put({ "motion-prism": { styleRefs: { mode: "on" } } })
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.code).toBe("engine_unsupported")
    expect(h.upserts).toHaveLength(1)
  })

  it("refuses a style-refs step with an unknown key, mode or send, or a blank or over-long instruction", async () => {
    for (const styleRefs of [{ mode: "maybe" }, { mode: "on", send: "nope" }, { mode: "on", extra: 1 }, "on", { mode: "on", prompt: " " }, { mode: "on", prompt: "x".repeat(4001) }]) {
      const res = await put({ "motion-prism": { styleRefs } })
      expect(res.statusCode, JSON.stringify(styleRefs).slice(0, 60)).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(h.upserts).toEqual([])
  })

  it("refuses any Pulse style-refs step (Pulse takes no art style)", async () => {
    for (const styleRefs of [{ mode: "on" }, { mode: "off" }]) {
      const res = await put({ "motion-pulse": { styleRefs } })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("precise_art_style_engine")
    }
    expect(h.upserts).toEqual([])
  })

  it("files its audit rows under an id of its own", () => {
    const ids = [
      NODARO_MOTION_PRECISE_ART_STYLE_AUDIT_TARGET,
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
    expect(NODARO_MOTION_PRECISE_ART_STYLE_AUDIT_TARGET).toBe("00000000-0000-4000-8000-00000000a0fb")
  })
})

describe("the Precise art-style gate", () => {
  it("no environment takes it until one publish environment's recorded engine declares castSwap.preciseArtStyle", () => {
    expect(noEnvironmentRunsPreciseArtStyle([])).toBe(true)
    expect(noEnvironmentRunsPreciseArtStyle([envRow("production", {}), envRow("staging", { preciseArtStyle: false })])).toBe(true)
    expect(noEnvironmentRunsPreciseArtStyle([envRow("dev", RUNS)])).toBe(true)
    expect(noEnvironmentRunsPreciseArtStyle([envRow("staging", RUNS)])).toBe(false)
    expect(noEnvironmentRunsPreciseArtStyle([envRow("production", RUNS), envRow("staging", {})])).toBe(false)
  })
})
