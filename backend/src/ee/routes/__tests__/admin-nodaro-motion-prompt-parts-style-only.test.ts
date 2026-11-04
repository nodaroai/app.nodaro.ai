import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The style-only prompt parts: `/v1/admin/nodaro-motion/prompt-parts` under
 * its own `styleOnly` key, beside `precise` and `motion` (a style-only run is
 * a direct Prism Flex run with an art style and nothing to swap).
 *
 * What must hold:
 *  - the `motion` and `styleOnly` overrides never cross: each is stored, read,
 *    previewed and answered to the engine on its own;
 *  - the style-only preview and check ask the engine for the style-only set
 *    (`styleOnly: true`, no role, no reference) and never with a wording, a
 *    masking, a face mesh or a shot list, whatever the settings say;
 *  - a save that sets or changes a `styleOnly` entry is 409 until EVERY
 *    environment's engine declares `castSwap.styleOnly` (nothing asked,
 *    nothing saved); one that leaves it as it is, or removes it, is never held;
 *  - the GET lists `styleOnly` only for an engine that runs style-only runs,
 *    and its preview on any other is 503 (that engine would answer the plain
 *    Flex set).
 */
const h = vi.hoisted(() => ({
  row: null as { value: unknown; updated_at: string } | null,
  motionRow: null as { value: unknown; updated_at: string } | null,
  maskingRow: null as { value: unknown; updated_at: string } | null,
  wordingRow: null as { value: unknown; updated_at: string } | null,
  stepsRow: null as { value: unknown; updated_at: string } | null,
  upserts: [] as unknown[],
  audits: [] as Record<string, unknown>[],
  admin: true,
  calls: [] as Array<Record<string, unknown>>,
  problemsFor: null as null | ((body: Record<string, unknown>) => Array<Record<string, unknown>>),
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
      let key = ""
      const rows: Record<string, () => { value: unknown; updated_at: string } | null> = {
        nodaro_motion_prompt_parts: () => h.row,
        nodaro_motion_motion: () => h.motionRow,
        nodaro_motion_masking: () => h.maskingRow,
        nodaro_motion_prompt_wording: () => h.wordingRow,
        nodaro_motion_steps: () => h.stepsRow,
      }
      const chain = {
        select: () => chain,
        eq: (_c: string, k: string) => (expect(Object.keys(rows)).toContain(k), (key = k), chain),
        maybeSingle: async () => ({ data: rows[key]!(), error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }) => {
          expect(row.key).toBe("nodaro_motion_prompt_parts")
          h.upserts.push(row)
          h.row = { value: row.value, updated_at: row.updated_at }
          return { error: null }
        },
      }
      return chain
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ invalidateSettingsCache: () => undefined }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => h.admin }))
vi.mock("../../lib/engine-environments.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/engine-environments.js")>()),
  listEngineEnvironments: async () => (h.envReads++, h.envs),
}))

const { adminNodaroMotionRoutes } = await import("../admin-nodaro-motion.js")
const { PULSE_RUNS_NO_STYLE_ONLY_MESSAGE, cannotRunStyleOnlyMessage } = await import("../../lib/nodaro-motion-style-only-gate.js")
const { parseNodaroMotionPromptParts, withEarlierPromptPartKeys } = await import("../../../lib/nodaro-motion-prompt-parts.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const SECRET = "0".repeat(64) // src/test/setup.ts
const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const HASH = "0123456789abcdef"
const AT = "2026-11-03T00:00:00Z"

/** An engine of before style-only runs, and one that runs them; both answer prompt parts with prompt styles. */
const CS = { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: ["720p"], trendRun: true, promptParts: true, promptStyles: ["precise", "flexible"] }
const STYLE_ONLY_ENGINE = { ...CS, styleOnly: true }
/** Every lever that shapes a Flex request, so the style-only request's lack of them means something. */
const EVERY_LEVER_ENGINE = {
  ...STYLE_ONLY_ENGINE,
  promptWordings: ["current", "new"],
  fullDepthScenes: ["description", "original", "none"],
  faceMesh: true,
  steps: true,
  shotList: true,
}

const env = (name: string, castSwap: Record<string, unknown>) => ({ env: name, pluginBuildId: "b", supports: { castSwap }, updatedAt: AT })
const BOTH_RUN_IT = [env("production", STYLE_ONLY_ENGINE), env("staging", STYLE_ONLY_ENGINE)]
const PRODUCTION_BEHIND = [env("production", CS), env("staging", STYLE_ONLY_ENGINE)]

function answer(problems: Array<Record<string, unknown>> = []) {
  return {
    set: "flexible",
    parts: [{ id: "opener", default: "Restyle {video}.", defaultHash: HASH, placeholders: ["{video}"], required: [], applies: true }],
    assembled: "Restyle {video:1}.",
    length: 18,
    max: 2500,
    problems,
  }
}

let app: FastifyInstance

beforeEach(async () => {
  h.row = null
  h.motionRow = null
  h.maskingRow = null
  h.wordingRow = null
  h.stepsRow = null
  h.upserts = []
  h.audits = []
  h.admin = true
  h.calls = []
  h.problemsFor = null
  h.envs = BOTH_RUN_IT
  h.envReads = 0
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: STYLE_ONLY_ENGINE } as never)
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
const get = () => app.inject({ method: "GET", url: "/v1/admin/nodaro-motion/prompt-parts", headers: as })
const put = (promptParts: unknown) => app.inject({ method: "PUT", url: "/v1/admin/nodaro-motion/prompt-parts", headers: as, payload: { promptParts } })
const previewOf = (payload: unknown) => app.inject({ method: "POST", url: "/v1/admin/nodaro-motion/prompt-parts/preview", headers: as, payload: payload as object })

describe("the motion and styleOnly overrides never cross", () => {
  it("a save holding both round-trips each under its own key, and the engine is answered both", async () => {
    const promptParts = { "motion-prism": { motion: { avoid: "A" }, styleOnly: { avoid: "B" } } }
    const res = await put(promptParts)
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([expect.objectContaining({ value: promptParts })])
    expect((await get()).json().data.promptParts).toEqual(promptParts)

    // What the toolkit answers (`tk.settings.nodaroMotionPromptParts`: the parsed row, under the current and the earlier ids).
    const parsed = parseNodaroMotionPromptParts(h.row!.value, () => {
      throw new Error("the row should parse whole")
    })
    expect(withEarlierPromptPartKeys(parsed!)).toEqual({ "motion-prism": promptParts["motion-prism"], "motion-pro": promptParts["motion-prism"] })
  })

  it("each key is checked on its own: the Flex check gets motion's texts, the style-only check styleOnly's", async () => {
    await put({ "motion-prism": { motion: { avoid: "A" }, styleOnly: { avoid: "B" } } })
    const flex = h.calls.filter((c) => c.styleOnly === undefined)
    const styleOnly = h.calls.filter((c) => c.styleOnly === true)
    expect(flex).toEqual([expect.objectContaining({ style: "motion", overrides: { avoid: "A" } })])
    expect(styleOnly).toEqual([expect.objectContaining({ style: "motion", overrides: { avoid: "B" } })])
  })

  it("a preview of one key reads that key's saved texts, never the other's", async () => {
    h.row = { value: { "motion-prism": { motion: { avoid: "A" }, styleOnly: { avoid: "B" } } }, updated_at: AT }
    await previewOf({ engine: "motion-prism", style: "motion" })
    await previewOf({ engine: "motion-prism", style: "styleOnly" })
    expect(h.calls[0]).toMatchObject({ overrides: { avoid: "A" } })
    expect(h.calls[0]).not.toHaveProperty("styleOnly")
    expect(h.calls[1]).toMatchObject({ styleOnly: true, overrides: { avoid: "B" } })

    // A key with nothing saved previews the defaults, never the other key's texts.
    h.row = { value: { "motion-prism": { motion: { avoid: "A" } } }, updated_at: AT }
    await previewOf({ engine: "motion-prism", style: "styleOnly" })
    expect(h.calls[2]).not.toHaveProperty("overrides")
  })

  it("editing motion keeps the styleOnly texts as they were, and the reverse", async () => {
    h.row = { value: { "motion-prism": { motion: { avoid: "A" }, styleOnly: { avoid: "B" } } }, updated_at: AT }
    expect((await put({ "motion-prism": { motion: { avoid: "A2" }, styleOnly: { avoid: "B" } } })).statusCode).toBe(200)
    expect(h.row!.value).toEqual({ "motion-prism": { motion: { avoid: "A2" }, styleOnly: { avoid: "B" } } })
    expect((await put({ "motion-prism": { motion: { avoid: "A2" }, styleOnly: { avoid: "B2" } } })).statusCode).toBe(200)
    expect(h.row!.value).toEqual({ "motion-prism": { motion: { avoid: "A2" }, styleOnly: { avoid: "B2" } } })
  })
})

describe("the style-only request", () => {
  it("the preview sends the style-only set with no role and no wording, masking, mesh, scene or shot list, whatever the settings", async () => {
    setPluginSupports({ castSwap: EVERY_LEVER_ENGINE } as never)
    h.wordingRow = { value: { "motion-prism": "new" }, updated_at: AT }
    h.maskingRow = { value: { "motion-prism": { mode: "always", faceMesh: true } }, updated_at: AT }
    h.motionRow = { value: { "motion-prism": { masking: { mode: "always", source: "full-depth" } } }, updated_at: AT }
    h.stepsRow = { value: { "motion-prism": { shotList: { precise: { mode: "on" } } } }, updated_at: AT }
    // The same settings shape a Flex preview (so their absence below is the style-only set's own).
    await previewOf({ engine: "motion-prism", style: "motion", promptWording: "new" })
    expect(h.calls[0]).toMatchObject({ promptWording: "new", source: "full-depth", scene: "description" })

    const res = await previewOf({ engine: "motion-prism", style: "styleOnly", promptWording: "new", overrides: { restate: "Again." } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(answer())
    expect(h.calls[1]).toEqual({
      engine: "seedance-2-5",
      style: "motion",
      promptStyle: "flexible",
      styleOnly: true,
      hasAudio: true,
      roles: [],
      overrides: { restate: "Again." },
    })
  })

  it("a save checks styleOnly on the style-only set with room for the user's pre and post prompts, and no role or reference", async () => {
    setPluginSupports({ castSwap: EVERY_LEVER_ENGINE } as never)
    h.wordingRow = { value: { "motion-prism": "new" }, updated_at: AT }
    expect((await put({ "motion-prism": { styleOnly: { opener: "Paint {video}." } } })).statusCode).toBe(200)
    expect(h.calls).toHaveLength(1)
    const call = h.calls[0]!
    expect(call).toMatchObject({ engine: "seedance-2-5", style: "motion", promptStyle: "flexible", styleOnly: true, hasAudio: true, roles: [], overrides: { opener: "Paint {video}." } })
    expect(call.prePrompt).toEqual(expect.stringMatching(/^Before: x+$/))
    expect((call.prePrompt as string).length).toBe(1000)
    expect((call.postPrompt as string).length).toBe(1000)
    for (const key of ["references", "promptWording", "source", "scene", "faceMesh", "shotList", "depthColormap", "maskFill"]) {
      expect(call, key).not.toHaveProperty(key)
    }
  })
})

describe("the engine's refusal of a style-only override", () => {
  /** The engine's own rule (it owns it): the style-only set's opener and art style cannot be removed. */
  const REQUIRED: Record<string, string> = { opener: "The restyle block cannot be removed.", artStyle: "The art style cannot be removed." }
  const openerRequired = (body: Record<string, unknown>) =>
    body.styleOnly === true
      ? Object.entries((body.overrides as Record<string, string> | undefined) ?? {}).flatMap(([part, text]) =>
          text === "-" && REQUIRED[part] ? [{ part, code: "part_required", message: REQUIRED[part] }] : [],
        )
      : []

  it("is 422 naming the styleOnly key, and saves nothing", async () => {
    h.problemsFor = openerRequired
    const res = await put({ "motion-prism": { styleOnly: { opener: "-" } } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toEqual({
      code: "prompt_parts_invalid",
      message: "The restyle block cannot be removed.",
      problems: [{ part: "opener", code: "part_required", message: "The restyle block cannot be removed.", engine: "motion-prism", style: "styleOnly" }],
    })
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("is 422 naming the styleOnly key for a removed art style too, and saves nothing", async () => {
    h.problemsFor = openerRequired
    const res = await put({ "motion-prism": { styleOnly: { artStyle: "-" } } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.problems).toEqual([
      { part: "artStyle", code: "part_required", message: "The art style cannot be removed.", engine: "motion-prism", style: "styleOnly" },
    ])
    expect(h.calls).toEqual([expect.objectContaining({ styleOnly: true, overrides: { artStyle: "-" } })])
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("a clean motion edit beside a refused styleOnly one is not saved alone, and the problem is never put on motion", async () => {
    h.problemsFor = openerRequired
    h.row = { value: { "motion-prism": { motion: { avoid: "A" } } }, updated_at: AT }
    const res = await put({ "motion-prism": { motion: { avoid: "A2", opener: "-" }, styleOnly: { opener: "-" } } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.problems).toEqual([expect.objectContaining({ part: "opener", engine: "motion-prism", style: "styleOnly" })])
    expect(h.upserts).toEqual([])
    expect(h.row!.value).toEqual({ "motion-prism": { motion: { avoid: "A" } } })
  })
})

describe("Pulse takes no art style", () => {
  it("a Pulse styleOnly entry is 400 style_only_engine, before any environment read, engine call or save", async () => {
    const res = await put({ "motion-prism": { motion: { avoid: "A" } }, "motion-pulse": { styleOnly: { avoid: "B" } } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "style_only_engine", message: PULSE_RUNS_NO_STYLE_ONLY_MESSAGE })
    expect(PULSE_RUNS_NO_STYLE_ONLY_MESSAGE).toBe("Nodaro Motion Pulse takes no art style, so it runs no style-only runs.")
    expect(h.envReads).toBe(0)
    expect(h.calls).toEqual([])
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("a Pulse styleOnly entry of empty texts only (the defaults, dropped) saves, and its other keys as before", async () => {
    const res = await put({ "motion-pulse": { motion: { avoid: "A" }, styleOnly: { avoid: "", opener: "  " } } })
    expect(res.statusCode).toBe(200)
    expect(h.envReads).toBe(0)
    expect(h.calls).toEqual([expect.objectContaining({ engine: "kling-4", style: "motion", overrides: { avoid: "A" } })])
    expect(h.row!.value).toEqual({ "motion-pulse": { motion: { avoid: "A" } } })
  })

  it("a Pulse style-only preview is 400 style_only_engine, and the engine is never asked", async () => {
    const res = await previewOf({ engine: "motion-pulse", style: "styleOnly" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "style_only_engine", message: PULSE_RUNS_NO_STYLE_ONLY_MESSAGE })
    expect(h.calls).toEqual([])
    // Pulse's own styles preview as before.
    expect((await previewOf({ engine: "motion-pulse", style: "motion" })).statusCode).toBe(200)
  })
})

describe("the every-environment gate on the styleOnly key", () => {
  it("a new styleOnly entry while production's engine lacks the flag is 409, asks nothing and saves nothing", async () => {
    h.envs = PRODUCTION_BEHIND
    const res = await put({ "motion-prism": { motion: { avoid: "A" }, styleOnly: { avoid: "B" } } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toEqual({ code: "engine_unsupported", message: cannotRunStyleOnlyMessage(["production"]), envs: ["production"] })
    expect(h.calls).toEqual([])
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("a changed styleOnly entry is held the same way; an environment not recorded at all cannot either", async () => {
    h.row = { value: { "motion-prism": { styleOnly: { avoid: "B" } } }, updated_at: AT }
    h.envs = [env("staging", STYLE_ONLY_ENGINE)]
    const res = await put({ "motion-prism": { styleOnly: { avoid: "B2" } } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.envs).toEqual(["production"])
    expect(h.upserts).toEqual([])
  })

  it("a save that leaves styleOnly as it is never reads the environments, whatever they run", async () => {
    h.row = { value: { "motion-prism": { styleOnly: { avoid: "B" } } }, updated_at: AT }
    h.envs = PRODUCTION_BEHIND
    const res = await put({ "motion-prism": { precise: { face: "Keep faces." }, styleOnly: { avoid: "B" } } })
    expect(res.statusCode).toBe(200)
    expect(h.envReads).toBe(0)
    expect(h.row!.value).toEqual({ "motion-prism": { precise: { face: "Keep faces." }, styleOnly: { avoid: "B" } } })
  })

  it("a precise and motion save with no styleOnly at all never reads the environments", async () => {
    h.envs = PRODUCTION_BEHIND
    expect((await put({ "motion-prism": { precise: { face: "a" }, motion: { avoid: "b" } } })).statusCode).toBe(200)
    expect(h.envReads).toBe(0)
  })

  it("removing a styleOnly entry is never held (it gives back the row every app reads)", async () => {
    h.row = { value: { "motion-prism": { motion: { avoid: "A" }, styleOnly: { avoid: "B" } } }, updated_at: AT }
    h.envs = PRODUCTION_BEHIND
    const res = await put({ "motion-prism": { motion: { avoid: "A" }, styleOnly: { avoid: "" } } })
    expect(res.statusCode).toBe(200)
    expect(h.envReads).toBe(0)
    expect(h.row!.value).toEqual({ "motion-prism": { motion: { avoid: "A" } } })
  })

  it("once every environment runs style-only runs, the entry is checked and saved", async () => {
    h.envs = BOTH_RUN_IT
    expect((await put({ "motion-prism": { styleOnly: { avoid: "B" } } })).statusCode).toBe(200)
    expect(h.envReads).toBe(1)
    expect(h.calls).toEqual([expect.objectContaining({ styleOnly: true, overrides: { avoid: "B" } })])
    expect(h.upserts).toEqual([expect.objectContaining({ value: { "motion-prism": { styleOnly: { avoid: "B" } } } })])
  })
})

describe("an engine that does not run style-only runs", () => {
  it("the GET lists styleOnly only for an engine that runs style-only runs", async () => {
    expect((await get()).json().data.styles).toEqual(["precise", "motion", "styleOnly"])
    setPluginSupports({ castSwap: CS } as never)
    expect((await get()).json().data.styles).toEqual(["precise", "motion"])
  })

  it("is 503 engine_unsupported for a style-only preview, and never asked", async () => {
    setPluginSupports({ castSwap: CS } as never)
    const res = await previewOf({ engine: "motion-prism", style: "styleOnly" })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("engine_unsupported")
    expect(h.calls).toEqual([])
  })

  it("is 503 for a new styleOnly entry even when the recorded environments run them, and saves nothing", async () => {
    setPluginSupports({ castSwap: CS } as never)
    const res = await put({ "motion-prism": { styleOnly: { avoid: "B" } } })
    expect(res.statusCode).toBe(503)
    expect(h.calls).toEqual([])
    expect(h.upserts).toEqual([])
  })

  it("keeps an unchanged styleOnly entry without asking for its set, and checks the other keys as before", async () => {
    setPluginSupports({ castSwap: CS } as never)
    h.row = { value: { "motion-prism": { styleOnly: { avoid: "B" } } }, updated_at: AT }
    expect((await put({ "motion-prism": { motion: { avoid: "A" }, styleOnly: { avoid: "B" } } })).statusCode).toBe(200)
    expect(h.calls).toEqual([expect.objectContaining({ style: "motion", overrides: { avoid: "A" } })])
    expect(h.calls[0]).not.toHaveProperty("styleOnly")
    expect(h.row!.value).toEqual({ "motion-prism": { motion: { avoid: "A" }, styleOnly: { avoid: "B" } } })
  })
})
