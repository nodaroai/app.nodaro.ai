import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The check of Nodaro Motion's direct-run prompt part overrides
 * (ee/lib/nodaro-motion-prompt-check.ts), as both saves run it:
 *
 *  - PUT /v1/admin/nodaro-motion/prompt-parts asks the engine with a large
 *    direct run (`largeDirectRun`: every role, picture and reference, the
 *    longest names and lines, 1,000-character pre and post prompts — room for
 *    the user), never the preview's sample;
 *  - every problem there blocks, `prompt_too_long` plainly, on both engines;
 *  - PUT /v1/admin/nodaro-motion/motion re-checks the saved Motion overrides
 *    against the NEW setting (422 with every problem, nothing saved); an
 *    engine without the route or without prompt styles is not asked;
 *  - GET /v1/admin/nodaro-motion/motion answers the engine's supports.
 *
 * The engine route is a stub answering the contract's shape, its length and
 * problems computed by the test from the request.
 */
const h = vi.hoisted(() => ({
  partsRow: null as { value: unknown; updated_at: string } | null,
  motionRow: null as { value: unknown; updated_at: string } | null,
  upserts: [] as Array<{ key: string; value: unknown }>,
  calls: [] as Array<Record<string, unknown>>,
  /** The engine's answer for a request: its length, cap and problems. */
  answerFor: null as null | ((body: Record<string, unknown>) => { length: number; max: number; problems: Array<Record<string, unknown>> }),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "admin_actions") return { insert: async () => ({ error: null }) }
      let key = ""
      const chain = {
        select: () => chain,
        eq: (_c: string, k: string) => ((key = k), chain),
        maybeSingle: async () => ({ data: key === "nodaro_motion_motion" ? h.motionRow : h.partsRow, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }) => {
          h.upserts.push(row)
          if (row.key === "nodaro_motion_motion") h.motionRow = { value: row.value, updated_at: row.updated_at }
          else h.partsRow = { value: row.value, updated_at: row.updated_at }
          return { error: null }
        },
      }
      return chain
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ invalidateSettingsCache: () => undefined }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => true }))

const { adminNodaroMotionRoutes } = await import("../admin-nodaro-motion.js")
const { CAST_SWAP_RUN_LIMITS, DIRECT_RUN_USER_PROMPT_ROOM, largeDirectRun } = await import("../../../lib/cast-swap-prompt-parts-contract.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const SECRET = "0".repeat(64) // src/test/setup.ts
const BASE = { roleKinds: ["person" as const], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true, promptParts: true }
const STYLED = { ...BASE, styles: ["precise", "motion"] as Array<"precise" | "motion">, sourceModes: ["faces", "full-depth"] as Array<"faces" | "full-depth">, promptStyles: ["precise", "flexible"] as Array<"precise" | "flexible">, fullDepthScenes: ["description", "original", "none"] as Array<"description" | "original" | "none"> }

let app: FastifyInstance

beforeEach(async () => {
  h.partsRow = null
  h.motionRow = null
  h.upserts = []
  h.calls = []
  h.answerFor = null
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { ...STYLED } })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-internal-orchestrator-secret"] === SECRET) {
      req.authKind = "internal"
      req.userId = req.headers["x-internal-user-id"] as string
      return
    }
    req.userId = "00000000-0000-4000-8000-0000000000ad"
  })
  app.post("/v1/cast-swap/prompt-parts", async (req, reply) => {
    if (req.authKind !== "internal") return reply.status(403).send({ error: { code: "forbidden", message: "Internal only" } })
    const body = req.body as Record<string, unknown>
    h.calls.push(body)
    const { length, max, problems } = h.answerFor?.(body) ?? { length: 100, max: 30_000, problems: [] }
    return reply.send({ set: "flexible", parts: [], assembled: "", length, max, problems })
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const putParts = (promptParts: unknown) => app.inject({ method: "PUT", url: "/v1/admin/nodaro-motion/prompt-parts", payload: { promptParts } })
const putMotion = (motion: unknown) => app.inject({ method: "PUT", url: "/v1/admin/nodaro-motion/motion", payload: { motion } })
const TOO_LONG = { code: "prompt_too_long", message: "The prompt is too long." }

describe("largeDirectRun", () => {
  it("fills every role, then every fixed reference, then more pictures, to the engine's image cap", () => {
    const prism = largeDirectRun("seedance-2-5")
    expect(prism.roles.map((r) => (r as { kind: string }).kind)).toEqual([
      ...Array(6).fill("person"), ...Array(3).fill("pet"), ...Array(3).fill("product"), "location",
    ])
    const images = (run: ReturnType<typeof largeDirectRun>) =>
      run.roles.reduce((n: number, r) => n + (r as { images: string[] }).images.length, 0) + run.references.reduce((n: number, r) => n + r.images.length, 0)
    expect(images(prism)).toBe(CAST_SWAP_RUN_LIMITS.maxImages)
    expect(prism.references).toHaveLength(CAST_SWAP_RUN_LIMITS.references)
    expect(prism.references.every((r) => r.line.length === CAST_SWAP_RUN_LIMITS.referenceLineMax)).toBe(true)
    expect(prism.roles.every((r) => (r as { name: string }).name.length === CAST_SWAP_RUN_LIMITS.roleNameMax)).toBe(true)
    expect(prism.roles.every((r) => (r as { images: string[] }).images.length >= 1 && (r as { images: string[] }).images.length <= 3)).toBe(true)
    // Room for the user, not the run body's 4,000 each: a longer prompt is refused at run, the user's to fix.
    expect(DIRECT_RUN_USER_PROMPT_ROOM).toBe(1000)
    expect([prism.prePrompt.length, prism.postPrompt.length, prism.hasAudio]).toEqual([1000, 1000, true])
    // Every picture its own address, so the engine numbers each once.
    const urls = [...prism.roles.flatMap((r) => (r as { images: string[] }).images), ...prism.references.flatMap((r) => r.images)]
    expect(new Set(urls).size).toBe(urls.length)

    // Kling 4 takes 10 pictures a run: the first 10 roles get one each, no reference is left room.
    const pulse = largeDirectRun("kling-4")
    expect(images(pulse)).toBe(10)
    expect(pulse.references).toEqual([])
    expect(pulse.roles.filter((r) => (r as { images: string[] }).images.length > 0)).toHaveLength(10)
  })
})

describe("PUT /v1/admin/nodaro-motion/prompt-parts on a large direct run", () => {
  it("asks the engine with a large direct run, in the shape a run of the style uses", async () => {
    h.motionRow = { value: { "motion-prism": { masking: { mode: "always", source: "full-depth", scene: "none" }, promptStyle: "precise" } }, updated_at: "2026-10-27T00:00:00Z" }
    expect((await putParts({ "motion-prism": { motion: { avoid: "-" } } })).statusCode).toBe(200)
    expect(h.calls).toEqual([{ engine: "seedance-2-5", style: "motion", promptStyle: "precise", source: "full-depth", scene: "none", ...largeDirectRun("seedance-2-5"), overrides: { avoid: "-" } }])
  })

  it("refuses a prompt too long on that run, plainly, on either engine", async () => {
    h.answerFor = (b) => (b.engine === "kling-4" ? { length: 8100, max: 8000, problems: [TOO_LONG] } : { length: 31_000, max: 30_000, problems: [TOO_LONG] })
    const res = await putParts({ "motion-prism": { precise: { avoid: "x".repeat(2000) } }, "motion-pulse": { motion: { avoid: "Avoid it." } } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({
      code: "prompt_parts_invalid",
      problems: [
        { ...TOO_LONG, engine: "motion-prism", style: "precise" },
        { ...TOO_LONG, engine: "motion-pulse", style: "motion" },
      ],
    })
    // One ask per engine and style: the defaults are never asked for comparison.
    expect(h.calls.map((c) => [c.engine, c.prePrompt])).toEqual([
      ["seedance-2-5", largeDirectRun("seedance-2-5").prePrompt],
      ["kling-4", largeDirectRun("kling-4").prePrompt],
    ])
    expect(h.upserts).toEqual([])
  })

  it("keeps every other problem as the engine found it", async () => {
    h.answerFor = () => ({ length: 100, max: 30_000, problems: [{ part: "keep", code: "part_not_used", message: "The keep part is not used in this mode." }] })
    const res = await putParts({ "motion-prism": { motion: { keep: "{video} stays." } } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.problems).toEqual([{ part: "keep", code: "part_not_used", message: "The keep part is not used in this mode.", engine: "motion-prism", style: "motion" }])
    expect(h.calls).toHaveLength(1)
  })
})

describe("PUT /v1/admin/nodaro-motion/motion re-checks the saved Motion overrides", () => {
  it("against the NEW setting: a part it no longer uses refuses the save, and nothing is saved", async () => {
    h.partsRow = { value: { "motion-prism": { motion: { keep: "{video} stays." }, precise: { face: "Faces stay." } } }, updated_at: "2026-10-27T00:00:00Z" }
    h.answerFor = (b) =>
      b.source === "full-depth" ? { length: 100, max: 30_000, problems: [{ part: "keep", code: "part_not_used", message: "The keep part is not used in this mode." }] } : { length: 100, max: 30_000, problems: [] }
    const res = await putMotion({ "motion-prism": { masking: { mode: "always", source: "full-depth" } } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({
      code: "prompt_parts_invalid",
      problems: [{ part: "keep", code: "part_not_used", engine: "motion-prism", style: "motion" }],
    })
    expect(res.json().error.message).toContain("Change or reset the Motion engine prompt first.")
    // Only the Motion style's overrides, in the new shape, on a large run.
    expect(h.calls).toEqual([expect.objectContaining({ engine: "seedance-2-5", style: "motion", source: "full-depth", scene: "description", promptStyle: "flexible", overrides: { keep: "{video} stays." }, prePrompt: largeDirectRun("seedance-2-5").prePrompt })])
    expect(h.upserts).toEqual([])

    // A setting they still fit saves.
    expect((await putMotion({ "motion-prism": { promptStyle: "precise" } })).statusCode).toBe(200)
    expect(h.upserts).toEqual([expect.objectContaining({ key: "nodaro_motion_motion", value: { "motion-prism": { promptStyle: "precise" } } })])
  })

  it("asks nothing without saved Motion overrides, or of an engine without the route or without prompt styles", async () => {
    h.partsRow = { value: { "motion-prism": { precise: { face: "Faces stay." } } }, updated_at: "2026-10-27T00:00:00Z" }
    expect((await putMotion({ "motion-prism": { promptStyle: "precise" } })).statusCode).toBe(200)
    h.partsRow = { value: { "motion-prism": { motion: { keep: "{video} stays." } } }, updated_at: "2026-10-27T00:00:00Z" }
    setPluginSupports({ castSwap: { ...STYLED, promptParts: undefined } })
    expect((await putMotion({ "motion-prism": { promptStyle: "precise" } })).statusCode).toBe(200)
    setPluginSupports({ castSwap: { ...BASE } })
    expect((await putMotion({ "motion-prism": { promptStyle: "precise" } })).statusCode).toBe(200)
    expect(h.calls).toHaveLength(0)
  })
})

describe("GET /v1/admin/nodaro-motion/motion", () => {
  it("answers what this environment's engine declares of the setting (absent keys left out)", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/nodaro-motion/motion" })).json().data.supports).toEqual({
      styles: ["precise", "motion"],
      sourceModes: ["faces", "full-depth"],
      promptStyles: ["precise", "flexible"],
      fullDepthScenes: ["description", "original", "none"],
    })
    setPluginSupports({ castSwap: { ...BASE } })
    expect((await app.inject({ method: "GET", url: "/v1/admin/nodaro-motion/motion" })).json().data.supports).toEqual({})
  })
})
