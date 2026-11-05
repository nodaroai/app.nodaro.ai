import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION } from "@nodaro/shared/models"

/**
 * `/v1/admin/nodaro-motion/no-person` — whether a direct Precise run with no
 * pictured person sends its source clip, per engine.
 *
 * What must hold:
 *  - both routes are admin-only;
 *  - GET answers the saved row (null until saved), both engines named, and
 *    whether this environment's engine reads it
 *    (`castSwap.noPersonSourceClip`);
 *  - PUT is strict (an unknown engine, a value other than off, or an unknown
 *    key is 400); a Pulse entry is accepted; empty entries are left out of
 *    what is stored;
 *  - a change is 409 `engine_unsupported` only while NO environment's engine
 *    declares the flag (one reader is enough); the default is saved whatever
 *    the engines;
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
        eq: (_c: string, key: string) => (expect(key).toBe("nodaro_motion_no_person"), chain),
        maybeSingle: async () => ({ data: h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }, opts: unknown) => {
          expect(row.key).toBe("nodaro_motion_no_person")
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
const { NODARO_MOTION_NO_PERSON_AUDIT_TARGET } = await import("../admin-nodaro-motion-no-person.js")
const { NODARO_MOTION_STYLE_ONLY_AUDIT_TARGET } = await import("../admin-nodaro-motion-style-only.js")
const { NODARO_MOTION_PRECISE_ART_STYLE_AUDIT_TARGET } = await import("../admin-nodaro-motion-precise-art-style.js")
const { NODARO_MOTION_ADVANCED_AUDIT_TARGET } = await import("../admin-nodaro-motion-advanced.js")
const { NODARO_MOTION_PROMPT_WORDING_AUDIT_TARGET } = await import("../admin-nodaro-motion-prompt-wording.js")
const { NODARO_MOTION_STYLE_AUDIT_TARGET } = await import("../admin-nodaro-motion-style.js")
const { NODARO_MOTION_STEPS_AUDIT_TARGET } = await import("../admin-nodaro-motion-steps.js")
const { NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET } = await import("../admin-nodaro-motion-prism-reference-audio.js")
const { NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET } = await import("../admin-nodaro-motion-pulse-audio.js")
const { NODARO_MOTION_MOTION_AUDIT_TARGET } = await import("../admin-nodaro-motion-motion.js")
const { NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET } = await import("../admin-nodaro-motion-prompt-parts.js")
const { NO_ENGINE_READS_NO_PERSON_MESSAGE, noEnvironmentRunsNoPerson } = await import("../../lib/nodaro-motion-no-person-gate.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/nodaro-motion/no-person"
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const envRow = (env: string, castSwap: Record<string, unknown>) => ({ env, pluginBuildId: null, supports: { castSwap: { ...CS, ...castSwap } }, updatedAt: "2026-11-05T00:00:00.000Z" })
const READS = { noPersonSourceClip: true }
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION["motion-prism"] },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION["motion-pulse"] },
]
const REFUSAL = "No Cast Swap engine reads this setting yet: keep the default (on), or wait for the engine."

let app: FastifyInstance

beforeEach(async () => {
  h.row = null
  h.upserts = []
  h.audits = []
  h.admin = true
  h.invalidated = 0
  h.envs = [envRow("production", READS), envRow("staging", READS)]
  h.envReads = 0
  _resetPluginSupportsForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const put = (noPerson: unknown, headers: Record<string, string> = as) => app.inject({ method: "PUT", url: URL, headers, payload: { noPerson } })

describe("GET /v1/admin/nodaro-motion/no-person", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: URL, headers: as })).statusCode).toBe(403)
  })

  it("answers null until it is saved, both engines, and whether this engine reads it", async () => {
    const res = await app.inject({ method: "GET", url: URL, headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ noPerson: null, updatedAt: null, engines: ENGINES, supported: false })
    setPluginSupports({ castSwap: { ...CS } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.supported).toBe(false)
    setPluginSupports({ castSwap: { ...CS, noPersonSourceClip: true } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.supported).toBe(true)
  })

  it("answers the stored row, an earlier engine key read as the current one and an empty entry left out", async () => {
    h.row = { value: { "motion-pro": { sourceClip: false }, "motion-lite": {} }, updated_at: "2026-11-05T10:00:00.000Z" }
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data).toMatchObject({
      noPerson: { "motion-prism": { sourceClip: false } },
      updatedAt: "2026-11-05T10:00:00.000Z",
    })
  })
})

describe("PUT /v1/admin/nodaro-motion/no-person", () => {
  it("is admin-only, and writes nothing for a non-admin", async () => {
    h.admin = false
    expect((await put({ "motion-prism": { sourceClip: false } })).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("saves the change, clears the cache and audits before and after", async () => {
    const res = await put({ "motion-prism": { sourceClip: false } })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([{ key: "nodaro_motion_no_person", value: { "motion-prism": { sourceClip: false } }, updated_at: expect.any(String), updated_by: ADMIN }])
    expect(h.invalidated).toBe(1)
    expect(res.json().data).toMatchObject({ noPerson: { "motion-prism": { sourceClip: false } }, engines: ENGINES })
    expect(h.audits).toEqual([
      {
        admin_user_id: ADMIN,
        action: "update_nodaro_motion_no_person",
        target_type: "app_setting",
        target_id: "00000000-0000-4000-8000-00000000a0fc",
        payload: { key: "nodaro_motion_no_person", before: null, after: { "motion-prism": { sourceClip: false } } },
      },
    ])
    const second = await put({ "motion-pulse": { sourceClip: false } })
    expect(second.statusCode).toBe(200)
    expect(h.audits[1]!.payload).toEqual({
      key: "nodaro_motion_no_person",
      before: { "motion-prism": { sourceClip: false } },
      after: { "motion-pulse": { sourceClip: false } },
    })
  })

  it("accepts a Pulse entry that is switched off", async () => {
    const res = await put({ "motion-pulse": { sourceClip: false } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.noPerson).toEqual({ "motion-pulse": { sourceClip: false } })
    expect((h.upserts[0] as { value: unknown }).value).toEqual({ "motion-pulse": { sourceClip: false } })
  })

  it("leaves an empty entry out of what is stored", async () => {
    await put({ "motion-prism": {}, "motion-pulse": { sourceClip: false } })
    const stored = (h.upserts[0] as { value: Record<string, unknown> }).value
    expect(Object.keys(stored)).toEqual(["motion-pulse"])
  })

  it("is strict: a value other than off, an unknown key or engine, or a stray body key is 400", async () => {
    for (const bad of [
      { "motion-prism": { sourceClip: true } },
      { "motion-prism": { sourceClip: null } },
      { "motion-prism": { sourceClip: false, extra: true } },
      { "motion-pro": { sourceClip: false } },
      { [CAST_SWAP_ENGINE_OF_NODARO_MOTION["motion-prism"]]: { sourceClip: false } },
      "off",
      null,
    ]) {
      const res = await put(bad)
      expect(res.statusCode, JSON.stringify(bad)).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { noPerson: {}, extra: 1 } })).statusCode).toBe(400)
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: {} })).statusCode).toBe(400)
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("saves a change once one environment's engine reads it", async () => {
    h.envs = [envRow("production", {}), envRow("staging", READS)]
    const res = await put({ "motion-prism": { sourceClip: false } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.noPerson).toEqual({ "motion-prism": { sourceClip: false } })
    expect(h.upserts).toHaveLength(1)
  })

  it("refuses a change (409 engine_unsupported) while no environment's engine reads it", async () => {
    for (const envs of [[], [envRow("production", {})], [envRow("production", { noPersonSourceClip: false }), envRow("staging", {})], [envRow("dev", READS)]]) {
      h.envs = envs
      const res = await put({ "motion-prism": { sourceClip: false } })
      expect(res.statusCode, JSON.stringify(envs)).toBe(409)
      expect(res.json().error).toEqual({ code: "engine_unsupported", message: REFUSAL, envs: [] })
    }
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("always saves the default, whatever the engines, so a change can be taken back", async () => {
    h.row = { value: { "motion-prism": { sourceClip: false } }, updated_at: "2026-11-05T10:00:00.000Z" }
    h.envs = []
    for (const s of [{}, { "motion-prism": {} }, { "motion-pulse": {} }]) {
      const res = await put(s)
      expect(res.statusCode, JSON.stringify(s)).toBe(200)
      expect(res.json().data.noPerson).toEqual({})
    }
    expect(h.envReads).toBe(0)
    expect(h.upserts.map((u) => (u as { value: unknown }).value)).toEqual([{}, {}, {}])
    expect(h.audits[0]!.payload).toEqual({ key: "nodaro_motion_no_person", before: { "motion-prism": { sourceClip: false } }, after: {} })
  })

  it("files its audit rows under an id of its own", () => {
    const ids = [
      NODARO_MOTION_NO_PERSON_AUDIT_TARGET,
      NODARO_MOTION_STYLE_ONLY_AUDIT_TARGET,
      NODARO_MOTION_PRECISE_ART_STYLE_AUDIT_TARGET,
      NODARO_MOTION_ADVANCED_AUDIT_TARGET,
      NODARO_MOTION_PROMPT_WORDING_AUDIT_TARGET,
      NODARO_MOTION_STYLE_AUDIT_TARGET,
      NODARO_MOTION_STEPS_AUDIT_TARGET,
      NODARO_MOTION_MASKING_AUDIT_TARGET,
      NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET,
      NODARO_MOTION_MOTION_AUDIT_TARGET,
      NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET,
      NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET,
    ]
    expect(new Set(ids).size).toBe(ids.length)
    expect(NODARO_MOTION_NO_PERSON_AUDIT_TARGET).toBe("00000000-0000-4000-8000-00000000a0fc")
  })
})

describe("the no-person gate", () => {
  it("no environment reads it until one publish environment's recorded engine declares castSwap.noPersonSourceClip", () => {
    expect(noEnvironmentRunsNoPerson([])).toBe(true)
    expect(noEnvironmentRunsNoPerson([envRow("production", {}), envRow("staging", { noPersonSourceClip: false })])).toBe(true)
    expect(noEnvironmentRunsNoPerson([envRow("dev", READS)])).toBe(true)
    expect(noEnvironmentRunsNoPerson([envRow("staging", READS)])).toBe(false)
    expect(noEnvironmentRunsNoPerson([envRow("production", READS), envRow("staging", {})])).toBe(false)
  })

  it("words its refusal", () => {
    expect(NO_ENGINE_READS_NO_PERSON_MESSAGE).toBe(REFUSAL)
  })
})
