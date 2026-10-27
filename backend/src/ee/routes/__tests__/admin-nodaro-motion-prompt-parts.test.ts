import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/nodaro-motion/prompt-parts` — the admin's prompt part overrides
 * per Nodaro Motion engine and style (for direct runs). Admin-only. A save is
 * checked by this environment's engine (`POST /v1/cast-swap/prompt-parts`,
 * internal only) for every engine and style it changes: any problem is 422
 * and nothing is saved; a clean save is written whole, clears the settings
 * cache and leaves an `admin_actions` row. The preview relays the engine's
 * answer for a sample run. The engine route is a stub answering the
 * contract's exact shapes.
 */
const h = vi.hoisted(() => ({
  row: null as { value: unknown; updated_at: string } | null,
  /** The Motion setting's row (`nodaro_motion_motion`), which the preview and the save read for the Motion style's shape. */
  motionRow: null as { value: unknown; updated_at: string } | null,
  upserts: [] as unknown[],
  audits: [] as Record<string, unknown>[],
  admin: true,
  invalidated: 0,
  calls: [] as Array<Record<string, unknown>>,
  problemsFor: null as null | ((body: Record<string, unknown>) => Array<Record<string, unknown>>),
  promptParts: true as boolean,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "admin_actions") {
        return { insert: async (row: Record<string, unknown>) => (h.audits.push(row), { error: null }) }
      }
      if (table !== "app_settings") throw new Error(`unexpected table ${table}`)
      let key = ""
      const chain = {
        select: () => chain,
        eq: (_c: string, k: string) => (expect(["nodaro_motion_prompt_parts", "nodaro_motion_motion"]).toContain(k), (key = k), chain),
        maybeSingle: async () => ({ data: key === "nodaro_motion_motion" ? h.motionRow : h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }, opts: unknown) => {
          expect(row.key).toBe("nodaro_motion_prompt_parts")
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

const { adminNodaroMotionRoutes } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET } = await import("../admin-nodaro-motion-prompt-parts.js")
const { placeholderImageUrl } = await import("../../../lib/cast-swap-prompt-parts-contract.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const SECRET = "0".repeat(64) // src/test/setup.ts
const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const HASH = "0123456789abcdef"

function answer(problems: Array<Record<string, unknown>> = []) {
  return {
    set: "depth-reference",
    parts: [
      { id: "opener", default: "{video} is a depth-map motion reference.", defaultHash: HASH, placeholders: ["{video}"], required: [], applies: true },
      { id: "keep", default: "", defaultHash: HASH, placeholders: ["{video}"], required: [], applies: false },
    ],
    assembled: "{video:1} is a depth-map motion reference.",
    length: 41,
    max: 2500,
    problems,
  }
}

let app: FastifyInstance

beforeEach(async () => {
  h.row = null
  h.motionRow = null
  h.upserts = []
  h.audits = []
  h.admin = true
  h.invalidated = 0
  h.calls = []
  h.problemsFor = null
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: ["720p"], trendRun: true, promptParts: true } })
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
    if (req.authKind !== "internal") return reply.status(403).send({ error: { code: "forbidden", message: "Internal only" } })
    const body = req.body as Record<string, unknown>
    h.calls.push(body)
    return reply.send(answer(h.problemsFor?.(body) ?? []))
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const as = { "x-user": ADMIN }
const put = (promptParts: unknown) => app.inject({ method: "PUT", url: "/v1/admin/nodaro-motion/prompt-parts", headers: as, payload: { promptParts } })
const previewOf = (payload: unknown) => app.inject({ method: "POST", url: "/v1/admin/nodaro-motion/prompt-parts/preview", headers: as, payload: payload as object })

describe("GET /v1/admin/nodaro-motion/prompt-parts", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/nodaro-motion/prompt-parts" })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: "/v1/admin/nodaro-motion/prompt-parts", headers: as })).statusCode).toBe(403)
  })

  it("answers null until it is saved, with the engines and the styles", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/nodaro-motion/prompt-parts", headers: as })
    expect(res.json().data).toEqual({
      promptParts: null,
      updatedAt: null,
      engines: [
        { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
        { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
      ],
      styles: ["precise", "motion"],
    })
  })

  it("reads a row keyed by an earlier engine id as the current one", async () => {
    h.row = { value: { "motion-lite": { motion: { avoid: "-" } } }, updated_at: "2026-10-27T00:00:00Z" }
    const res = await app.inject({ method: "GET", url: "/v1/admin/nodaro-motion/prompt-parts", headers: as })
    expect(res.json().data.promptParts).toEqual({ "motion-pulse": { motion: { avoid: "-" } } })
  })
})

describe("POST /v1/admin/nodaro-motion/prompt-parts/preview", () => {
  it("asks the engine with a sample one-person run, the internal engine id and the style, and relays its answer", async () => {
    const res = await previewOf({ engine: "motion-pulse", style: "motion", overrides: { avoid: "-", face: "" } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(answer())
    expect(h.calls).toEqual([
      {
        engine: "kling-4",
        style: "motion",
        // An engine that does not declare prompt styles is asked exactly as before: no source, no prompt style.
        hasAudio: true,
        roles: [{ kind: "person", name: "the person", images: [1, 2, 3].map((j) => placeholderImageUrl(1, j)), body: "new", outfit: "new", hair: "new" }],
        overrides: { avoid: "-" },
      },
    ])
  })

  it("asks with the prompt style a direct run of the style uses, once the engine declares prompt styles and scenes", async () => {
    setPluginSupports({
      castSwap: { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: ["720p"], trendRun: true, promptParts: true, promptStyles: ["precise", "flexible"], fullDepthScenes: ["description", "original", "none"] },
    })
    await previewOf({ engine: "motion-pulse", style: "precise" })
    await previewOf({ engine: "motion-pulse", style: "motion" })
    expect(h.calls[0]).toMatchObject({ style: "precise", promptStyle: "precise", source: "faces" })
    expect(h.calls[0]).not.toHaveProperty("scene")
    // Never saved: Motion is the Flexible prompt on the Precise masking.
    expect(h.calls[1]).toMatchObject({ style: "motion", promptStyle: "flexible", source: "faces" })
    expect(h.calls[1]).not.toHaveProperty("scene")

    // The saved Motion setting: full depth (its scene resolved), and the prompt style it names.
    h.motionRow = { value: { "motion-pulse": { masking: { mode: "always", source: "full-depth" }, promptStyle: "precise" } }, updated_at: "2026-10-27T00:00:00Z" }
    await previewOf({ engine: "motion-pulse", style: "motion" })
    expect(h.calls[2]).toMatchObject({ style: "motion", promptStyle: "precise", source: "full-depth", scene: "description" })
    h.motionRow = { value: { "motion-pulse": { masking: { mode: "always", source: "full-depth", scene: "original" } } }, updated_at: "2026-10-27T00:00:00Z" }
    await previewOf({ engine: "motion-pulse", style: "motion" })
    expect(h.calls[3]).toMatchObject({ promptStyle: "flexible", source: "full-depth", scene: "original" })
    // The Precise style never reads the Motion setting.
    await previewOf({ engine: "motion-pulse", style: "precise" })
    expect(h.calls[4]).toMatchObject({ promptStyle: "precise", source: "faces" })
  })

  it("asks an engine without prompt styles exactly as before, whatever the Motion setting", async () => {
    h.motionRow = { value: { "motion-pulse": { masking: { mode: "always", source: "full-depth" }, promptStyle: "precise" } }, updated_at: "2026-10-27T00:00:00Z" }
    await previewOf({ engine: "motion-pulse", style: "motion" })
    expect(h.calls[0]).not.toHaveProperty("source")
    expect(h.calls[0]).not.toHaveProperty("promptStyle")
    expect(h.calls[0]).not.toHaveProperty("scene")
  })

  it("checks a Motion save with the saved Motion setting's prompt style", async () => {
    setPluginSupports({
      castSwap: { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: ["720p"], trendRun: true, promptParts: true, promptStyles: ["precise", "flexible"] },
    })
    h.motionRow = { value: { "motion-prism": { promptStyle: "precise" } }, updated_at: "2026-10-27T00:00:00Z" }
    expect((await put({ "motion-prism": { motion: { avoid: "-" } } })).statusCode).toBe(200)
    expect(h.calls).toEqual([expect.objectContaining({ engine: "seedance-2-5", style: "motion", promptStyle: "precise", source: "faces", overrides: { avoid: "-" } })])
  })

  it("uses the saved overrides for that engine and style when none are sent", async () => {
    h.row = { value: { "motion-prism": { precise: { face: "Keep faces." } } }, updated_at: "2026-10-27T00:00:00Z" }
    await previewOf({ engine: "motion-prism", style: "precise" })
    await previewOf({ engine: "motion-prism", style: "motion" })
    expect(h.calls[0]).toMatchObject({ engine: "seedance-2-5", style: "precise", overrides: { face: "Keep faces." } })
    expect(h.calls[1]).not.toHaveProperty("overrides")
  })

  it("is 503 engine_unsupported for an engine without the route, and refuses an unknown engine or style", async () => {
    setPluginSupports({ castSwap: { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: ["720p"], trendRun: true } })
    const res = await previewOf({ engine: "motion-prism", style: "motion" })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("engine_unsupported")
    expect((await previewOf({ engine: "motion-pro", style: "motion" })).statusCode).toBe(400)
    expect((await previewOf({ engine: "motion-prism", style: "fast" })).statusCode).toBe(400)
    expect(h.calls).toHaveLength(0)
  })
})

describe("PUT /v1/admin/nodaro-motion/prompt-parts", () => {
  it("checks every engine and style it saves, then saves the whole setting, clears the cache and audits it", async () => {
    h.row = { value: { "motion-prism": { precise: { face: "old" } } }, updated_at: "2026-10-26T00:00:00Z" }
    const res = await put({
      "motion-prism": { precise: { face: "Keep faces.", avoid: "" }, motion: { avoid: "-" } },
      "motion-pulse": { motion: { face: "" } },
    })
    expect(res.statusCode).toBe(200)
    const saved = { "motion-prism": { precise: { face: "Keep faces." }, motion: { avoid: "-" } } }
    expect(h.calls.map((c) => [c.engine, c.style, c.overrides])).toEqual([
      ["seedance-2-5", "precise", { face: "Keep faces." }],
      ["seedance-2-5", "motion", { avoid: "-" }],
    ])
    expect(h.upserts).toEqual([expect.objectContaining({ key: "nodaro_motion_prompt_parts", value: saved, updated_by: ADMIN })])
    expect(h.invalidated).toBe(1)
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: "update_nodaro_motion_prompt_parts",
        target_type: "app_setting",
        target_id: NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET,
        payload: { key: "nodaro_motion_prompt_parts", before: { "motion-prism": { precise: { face: "old" } } }, after: saved },
      }),
    ])
    expect(res.json().data.promptParts).toEqual(saved)
  })

  it("is 422 with every problem, each naming its engine and style, and saves nothing", async () => {
    h.problemsFor = (body) =>
      body.style === "motion" ? [{ part: "keep", code: "part_not_used", message: "Motion does not use the keep line." }] : []
    const res = await put({ "motion-prism": { precise: { face: "Keep faces." } }, "motion-pulse": { motion: { keep: "{video} stays." } } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({
      code: "prompt_parts_invalid",
      problems: [{ part: "keep", code: "part_not_used", message: "Motion does not use the keep line.", engine: "motion-pulse", style: "motion" }],
    })
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("clears the setting without asking the engine, and refuses an unknown engine, style or part", async () => {
    expect((await put({})).statusCode).toBe(200)
    expect(h.calls).toHaveLength(0)
    expect(h.upserts).toEqual([expect.objectContaining({ value: {} })])
    for (const bad of [{ "motion-turbo": {} }, { "motion-prism": { fast: {} } }, { "motion-prism": { precise: { faces: "x" } } }]) {
      expect((await put(bad)).statusCode, JSON.stringify(bad)).toBe(400)
    }
  })

  it("is admin-only", async () => {
    h.admin = false
    expect((await put({ "motion-prism": { precise: { face: "x" } } })).statusCode).toBe(403)
    expect(h.calls).toHaveLength(0)
  })
})
