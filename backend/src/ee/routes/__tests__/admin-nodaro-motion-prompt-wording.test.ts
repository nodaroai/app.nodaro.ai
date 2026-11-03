import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/nodaro-motion/prompt-wording` — how every direct Flex run's
 * prompt is worded, per engine: "current" (today's, the default) or "new".
 *
 * What must hold:
 *  - both routes are admin-only;
 *  - GET answers the saved row (null until saved), both engines named, and
 *    whether this environment's engine words it (`castSwap.promptWordings`);
 *  - PUT is strict (an unknown engine or value is 400); "current" entries are
 *    dropped (the same as never set); "new" for any engine is 409
 *    `engine_unsupported` while any environment's engine does not list "new"
 *    in `castSwap.promptWordings`, while "current" everywhere is saved
 *    whatever the engines; a save clears the settings cache and leaves an
 *    `admin_actions` row under an id of its own.
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
        eq: (_c: string, key: string) => (expect(key).toBe("nodaro_motion_prompt_wording"), chain),
        maybeSingle: async () => ({ data: h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }, opts: unknown) => {
          expect(row.key).toBe("nodaro_motion_prompt_wording")
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
const { NODARO_MOTION_STEPS_AUDIT_TARGET } = await import("../admin-nodaro-motion-steps.js")
const { NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET } = await import("../admin-nodaro-motion-prompt-parts.js")
const { NODARO_MOTION_MOTION_AUDIT_TARGET } = await import("../admin-nodaro-motion-motion.js")
const { NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET } = await import("../admin-nodaro-motion-pulse-audio.js")
const { NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET } = await import("../admin-nodaro-motion-prism-reference-audio.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/nodaro-motion/prompt-wording"
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const envRow = (env: string, castSwap: Record<string, unknown>) => ({ env, pluginBuildId: null, supports: { castSwap: { ...CS, ...castSwap } }, updatedAt: "2026-11-01T00:00:00.000Z" })
const NEW = { promptWordings: ["current", "new"] as ("current" | "new")[] }
const BOTH_ENFORCE = [envRow("production", NEW), envRow("staging", NEW)]
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
  h.envs = BOTH_ENFORCE
  h.envReads = 0
  _resetPluginSupportsForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const put = (promptWording: unknown, headers: Record<string, string> = as) => app.inject({ method: "PUT", url: URL, headers, payload: { promptWording } })

describe("GET /v1/admin/nodaro-motion/prompt-wording", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: URL, headers: as })).statusCode).toBe(403)
  })

  it("answers null until it is saved (current everywhere), both engines, and whether this engine words it", async () => {
    const res = await app.inject({ method: "GET", url: URL, headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ promptWording: null, updatedAt: null, engines: ENGINES, supported: false })
    setPluginSupports({ castSwap: { ...CS, promptWordings: ["current"] as ("current" | "new")[] } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.supported).toBe(false)
    setPluginSupports({ castSwap: { ...CS, ...NEW } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.supported).toBe(true)
  })

  it("answers the stored row, an earlier engine key read as the current one and a value it does not know dropped", async () => {
    h.row = { value: { "motion-lite": "new", "motion-prism": "newest" }, updated_at: "2026-11-01T10:00:00.000Z" }
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data).toMatchObject({
      promptWording: { "motion-pulse": "new" },
      updatedAt: "2026-11-01T10:00:00.000Z",
    })
  })
})

describe("PUT /v1/admin/nodaro-motion/prompt-wording", () => {
  it("is admin-only, and writes nothing for a non-admin", async () => {
    h.admin = false
    expect((await put({ "motion-prism": "new" })).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
  })

  it("saves the engines on the new wording, clears the cache and audits before and after", async () => {
    const res = await put({ "motion-prism": "new", "motion-pulse": "current" })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([{ key: "nodaro_motion_prompt_wording", value: { "motion-prism": "new" }, updated_at: expect.any(String), updated_by: ADMIN }])
    expect(h.invalidated).toBe(1)
    expect(res.json().data).toMatchObject({ promptWording: { "motion-prism": "new" }, engines: ENGINES })
    expect(h.audits).toEqual([
      {
        admin_user_id: ADMIN,
        action: "update_nodaro_motion_prompt_wording",
        target_type: "app_setting",
        target_id: NODARO_MOTION_PROMPT_WORDING_AUDIT_TARGET,
        payload: { key: "nodaro_motion_prompt_wording", before: null, after: { "motion-prism": "new" } },
      },
    ])
    expect((await put({ "motion-prism": "new", "motion-pulse": "new" })).json().data.promptWording).toEqual({ "motion-prism": "new", "motion-pulse": "new" })
    expect(h.audits[1]!.payload).toEqual({
      key: "nodaro_motion_prompt_wording",
      before: { "motion-prism": "new" },
      after: { "motion-prism": "new", "motion-pulse": "new" },
    })
  })

  it("refuses an unknown engine, an unknown value or an extra key", async () => {
    for (const w of [{ "motion-pro": "new" }, { "motion-prism": "New" }, { "motion-prism": "" }, { "motion-prism": null }, "new", null]) {
      expect((await put(w)).statusCode, JSON.stringify(w)).toBe(400)
    }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { promptWording: {}, engine: "motion-pulse" } })).statusCode).toBe(400)
    expect(h.upserts).toEqual([])
  })

  it("refuses the new wording (409 engine_unsupported) while any environment's engine cannot use it, naming each", async () => {
    for (const [envs, named] of [
      [[envRow("production", NEW)], ["staging"]],
      [[envRow("production", {}), envRow("staging", NEW)], ["production"]],
      [[envRow("production", { promptWordings: ["current"] }), envRow("staging", {})], ["staging", "production"]],
      [[], ["staging", "production"]],
    ] as const) {
      h.envs = [...envs]
      const res = await put({ "motion-pulse": "new" })
      expect(res.statusCode, JSON.stringify(envs)).toBe(409)
      expect(res.json().error).toMatchObject({ code: "engine_unsupported", envs: named })
      expect(res.json().error.message).toContain(named.join(" and "))
    }
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("always saves 'current', whatever the engines, so the new wording can be taken back", async () => {
    h.row = { value: { "motion-prism": "new" }, updated_at: "2026-11-01T10:00:00.000Z" }
    h.envs = []
    for (const w of [{}, { "motion-prism": "current" }, { "motion-prism": "current", "motion-pulse": "current" }]) {
      const res = await put(w)
      expect(res.statusCode, JSON.stringify(w)).toBe(200)
      expect(res.json().data.promptWording).toEqual({})
    }
    expect(h.envReads).toBe(0)
    expect(h.upserts.map((u) => (u as { value: unknown }).value)).toEqual([{}, {}, {}])
    expect(h.audits[0]!.payload).toEqual({ key: "nodaro_motion_prompt_wording", before: { "motion-prism": "new" }, after: {} })
  })

  it("files its audit rows under an id of its own", () => {
    expect(
      new Set([
        NODARO_MOTION_PROMPT_WORDING_AUDIT_TARGET,
        NODARO_MOTION_STYLE_AUDIT_TARGET,
        NODARO_MOTION_STEPS_AUDIT_TARGET,
        NODARO_MOTION_MASKING_AUDIT_TARGET,
        NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET,
        NODARO_MOTION_MOTION_AUDIT_TARGET,
        NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET,
        NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET,
      ]).size,
    ).toBe(8)
  })
})
