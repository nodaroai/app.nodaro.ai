import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `PUT /v1/admin/nodaro-motion/masking` with the face mesh newly on: the mesh
 * adds its line to the engine's direct runs' prompt, so the saved prompt
 * overrides of those runs (Precise, and Motion where it falls back to this
 * masking) are checked again on a large run, and the save is refused (422
 * `prompt_parts_invalid`, nothing written) when they no longer fit.
 */
const h = vi.hoisted(() => ({
  rows: {} as Record<string, { value: unknown; updated_at: string } | null>,
  upserts: [] as Array<{ key: string; value: unknown }>,
  calls: [] as Array<Record<string, unknown>>,
  problemsFor: null as null | ((body: Record<string, unknown>) => Array<Record<string, unknown>>),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "admin_actions") return { insert: async () => ({ error: null }) }
      if (table !== "app_settings") throw new Error(`unexpected table ${table}`)
      let key = ""
      const chain = {
        select: () => chain,
        eq: (_c: string, k: string) => ((key = k), chain),
        maybeSingle: async () => ({ data: h.rows[key] ?? null, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }) => {
          h.upserts.push(row)
          h.rows[row.key] = { value: row.value, updated_at: row.updated_at }
          return { error: null }
        },
      }
      return chain
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ invalidateSettingsCache: () => undefined }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => true }))
const MESH_SUPPORTS = { castSwap: { faceMaskTargets: ["face", "head"], faceMesh: true } }
vi.mock("../../lib/engine-environments.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/engine-environments.js")>()),
  listEngineEnvironments: async () => ["production", "staging"].map((env) => ({ env, pluginBuildId: null, supports: MESH_SUPPORTS, updatedAt: "2026-10-31T00:00:00.000Z" })),
}))

const { adminNodaroMotionRoutes } = await import("../admin-nodaro-motion.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const SECRET = "0".repeat(64) // src/test/setup.ts
const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const HASH = "0123456789abcdef"
const answer = (problems: Array<Record<string, unknown>>) => ({
  set: "precise",
  parts: [{ id: "opener", default: "{video}", defaultHash: HASH, placeholders: ["{video}"], required: [], applies: true }],
  assembled: "x",
  length: 1,
  max: 2500,
  problems,
})

let app: FastifyInstance
beforeEach(async () => {
  h.rows = {}
  h.upserts = []
  h.calls = []
  h.problemsFor = null
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: ["720p"], trendRun: true, promptParts: true, faceMesh: true } as never })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-internal-orchestrator-secret"] === SECRET) {
      req.authKind = "internal"
      req.userId = req.headers["x-internal-user-id"] as string
      return
    }
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  app.post("/v1/cast-swap/prompt-parts", async (req, reply) => {
    const body = req.body as Record<string, unknown>
    h.calls.push(body)
    return reply.send(answer(h.problemsFor?.(body) ?? []))
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const put = (masking: unknown) => app.inject({ method: "PUT", url: "/v1/admin/nodaro-motion/masking", headers: { "x-user": ADMIN }, payload: { masking } })
const MESH_ON = { "motion-prism": { mode: "always", faceMesh: true } }
const savedOverrides = () => {
  h.rows.nodaro_motion_prompt_parts = {
    value: { "motion-prism": { precise: { face: "Keep the face." }, motion: { opener: "Use {video}." } }, "motion-pulse": { precise: { face: "Other." } } },
    updated_at: "2026-10-31T00:00:00.000Z",
  }
}

describe("PUT /v1/admin/nodaro-motion/masking — the face mesh and the saved prompt overrides", () => {
  it("re-checks the saved overrides of the engine whose mesh turns on (both styles; Motion falls back to this masking), with the mesh", async () => {
    savedOverrides()
    const res = await put(MESH_ON)
    expect(res.statusCode).toBe(200)
    expect(h.calls).toHaveLength(2)
    for (const c of h.calls) expect(c).toMatchObject({ engine: "seedance-2-5", faceMesh: true })
    expect(h.calls.map((c) => c.style).sort()).toEqual(["motion", "precise"])
    expect(h.upserts.map((u) => u.key)).toEqual(["nodaro_motion_masking"])
  })

  it("refuses the save when they no longer fit, naming why, and writes nothing", async () => {
    savedOverrides()
    h.problemsFor = (b) => (b.faceMesh === true ? [{ code: "prompt_too_long", message: "The prompt is 2,600 characters; the most is 2,500." }] : [])
    const res = await put(MESH_ON)
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({ code: "prompt_parts_invalid", message: expect.stringMatching(/With the face mesh on, the saved Nodaro Motion prompt no longer fits/) })
    expect(h.upserts).toEqual([])
  })

  it("asks nothing when the mesh was already on, is off, or there are no saved overrides", async () => {
    savedOverrides()
    h.rows.nodaro_motion_masking = { value: MESH_ON, updated_at: "2026-10-31T00:00:00.000Z" }
    expect((await put(MESH_ON)).statusCode).toBe(200)
    expect((await put({ "motion-prism": { mode: "always" } })).statusCode).toBe(200)
    h.rows = {}
    expect((await put(MESH_ON)).statusCode).toBe(200)
    expect(h.calls).toEqual([])
  })

  it("re-checks whenever the prompt may grow: the fill changed (None back to a blur or depth fill, the mesh still on), the masking turned on", async () => {
    setPluginSupports({ castSwap: { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: ["720p"], trendRun: true, promptParts: true, faceMesh: true, maskFillNone: true } as never })
    savedOverrides()
    h.rows.nodaro_motion_masking = { value: { "motion-prism": { mode: "always", fill: "none", faceMesh: true } }, updated_at: "2026-11-02T00:00:00.000Z" }
    h.problemsFor = (b) => (b.maskFill === undefined ? [{ code: "prompt_too_long", message: "The prompt is 2,600 characters; the most is 2,500." }] : [])
    const res = await put({ "motion-prism": { mode: "always", fill: "depth", faceMesh: true } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({ code: "prompt_parts_invalid", message: expect.stringMatching(/^With this masking, the saved Nodaro Motion prompt no longer fits/) })
    expect(h.calls.map((c) => c.style).sort()).toEqual(["motion", "precise"])
    expect(h.upserts).toEqual([])
    // Off → on (no mesh) is checked too; the fill none asks with maskFill "none".
    h.problemsFor = null
    h.calls = []
    h.rows.nodaro_motion_masking = { value: { "motion-prism": { mode: "off" } }, updated_at: "2026-11-02T00:00:00.000Z" }
    expect((await put({ "motion-prism": { mode: "always" } })).statusCode).toBe(200)
    expect(h.calls).toHaveLength(2)
    h.calls = []
    // Every environment's engine draws the fill none (the save's own gate).
    const cs = MESH_SUPPORTS.castSwap as Record<string, unknown>
    cs.maskFillNone = true
    try {
      expect((await put({ "motion-prism": { mode: "always", fill: "none", faceMesh: true } })).statusCode).toBe(200)
    } finally {
      delete cs.maskFillNone
    }
    for (const c of h.calls) expect(c).toMatchObject({ faceMesh: true, maskFill: "none" })
    expect(h.calls).toHaveLength(2)
  })
})
