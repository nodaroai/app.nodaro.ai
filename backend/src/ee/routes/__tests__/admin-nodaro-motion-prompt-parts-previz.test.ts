import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The prompt parts that came with the shot lock and the 3D previz clips, on
 * `/v1/admin/video-remake/prompt-parts`: the `previz` key (a 3D previz clip's
 * own set, beside `precise`, `motion` and `styleOnly`) and the part ids
 * `shotLock`, `sound` and `referenceOnly`.
 *
 * What must hold:
 *  - the previz preview and check ask the engine for the previz set
 *    (`clipKind: "previz"`, a clip without sound, the run's roles) and never
 *    with a wording, a masking, a face mesh, a shot list or a shot lock,
 *    whatever the settings say; Pulse has none (400), and an engine that
 *    takes no previz clip is never asked (503), nor lists the key;
 *  - a Precise or a Motion request names the shot lock (`shotLock: true`)
 *    while the engine's saved shot lock is on, when a preview asks for it, or
 *    when its overrides hold the part; never to an engine that does not
 *    declare `castSwap.shotLock`, which is asked exactly as before;
 *  - a save that sets or changes a `previz` entry, or an override of one of
 *    the three part ids, is 422 `platform_unsupported` until EVERY
 *    environment's platform claims them (nothing asked, nothing saved); one
 *    that leaves them as they are, or removes them, is never held;
 *  - the stored row answers the engine its `previz` entry under each key.
 */
const h = vi.hoisted(() => ({
  row: null as { value: unknown; updated_at: string } | null,
  motionRow: null as { value: unknown; updated_at: string } | null,
  maskingRow: null as { value: unknown; updated_at: string } | null,
  wordingRow: null as { value: unknown; updated_at: string } | null,
  stepsRow: null as { value: unknown; updated_at: string } | null,
  shotLockRow: null as { value: unknown; updated_at: string } | null,
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
        nodaro_motion_shot_lock: () => h.shotLockRow,
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
const {
  PULSE_TAKES_NO_PREVIZ_MESSAGE,
  environmentsWhosePlatformCannotTakePrevizPromptParts,
  platformHoldOfPrevizPromptParts,
  previzPromptPartsSetOrChanged,
} = await import("../../lib/nodaro-motion-previz-prompt-parts-gate.js")
const { forLoadedEngine } = await import("../../lib/cast-swap-prompt-parts.js")
const { directRunRequest } = await import("../../lib/nodaro-motion-prompt-check.js")
const { PLATFORM_SUPPORTS } = await import("../../lib/engine-environments.js")
const { parseNodaroMotionPromptParts, withEarlierPromptPartKeys } = await import("../../../lib/nodaro-motion-prompt-parts.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const SECRET = "0".repeat(64) // src/test/setup.ts
const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const HASH = "0123456789abcdef"
const AT = "2026-11-03T00:00:00Z"

/** An engine of before the shot lock and the 3D previz clips, and one that declares both; both answer prompt parts with prompt styles. */
const CS = { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: ["720p"], trendRun: true, promptParts: true, promptStyles: ["precise", "flexible"], styleOnly: true }
const PREVIZ_ENGINE = { ...CS, previz: true, shotLock: true }
/** Every lever that shapes a Flex request, so the previz request's lack of them means something. */
const EVERY_LEVER_ENGINE = {
  ...PREVIZ_ENGINE,
  promptWordings: ["current", "new"],
  fullDepthScenes: ["description", "original", "none"],
  faceMesh: true,
  steps: true,
  shotList: true,
}

/** An environment's record: its engine, and its platform's claim (fresh unless `claimedAt` says otherwise). */
const env = (name: string, castSwap: Record<string, unknown>, platform: Record<string, unknown> | null = PLATFORM_SUPPORTS as never, claimedAt = new Date().toISOString()) => ({
  env: name,
  pluginBuildId: "b",
  supports: { castSwap },
  updatedAt: AT,
  ...(platform ? { platformClaim: { supports: platform, at: claimedAt } } : {}),
})
const BOTH_TAKE_THEM = [env("production", PREVIZ_ENGINE), env("staging", PREVIZ_ENGINE)]
/** Production's app is from before the parts: it claims everything but them. */
const PRODUCTION_PLATFORM_BEHIND = [env("production", PREVIZ_ENGINE, { ...PLATFORM_SUPPORTS, previzPromptParts: undefined }), env("staging", PREVIZ_ENGINE)]

function answer(problems: Array<Record<string, unknown>> = []) {
  return {
    set: "flexible",
    parts: [{ id: "opener", default: "Use {video}.", defaultHash: HASH, placeholders: ["{video}"], required: [], applies: true }],
    assembled: "Use {video:1}.",
    length: 14,
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
  h.shotLockRow = null
  h.upserts = []
  h.audits = []
  h.admin = true
  h.calls = []
  h.problemsFor = null
  h.envs = BOTH_TAKE_THEM as never
  h.envReads = 0
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: PREVIZ_ENGINE } as never)
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
const get = () => app.inject({ method: "GET", url: "/v1/admin/video-remake/prompt-parts", headers: as })
const put = (promptParts: unknown) => app.inject({ method: "PUT", url: "/v1/admin/video-remake/prompt-parts", headers: as, payload: { promptParts } })
const previewOf = (payload: unknown) => app.inject({ method: "POST", url: "/v1/admin/video-remake/prompt-parts/preview", headers: as, payload: payload as object })

const NEW_IDS = ["shotLock", "sound", "referenceOnly"] as const

describe("the previz request", () => {
  it("the preview sends the previz set with the sample role, a clip without sound, and no wording, masking, mesh, scene, shot list or shot lock, whatever the settings", async () => {
    setPluginSupports({ castSwap: EVERY_LEVER_ENGINE } as never)
    h.wordingRow = { value: { "nodaro-prism": "new" }, updated_at: AT }
    h.shotLockRow = { value: { "nodaro-prism": "on" }, updated_at: AT }
    h.maskingRow = { value: { "nodaro-prism": { mode: "always", faceMesh: true } }, updated_at: AT }
    h.motionRow = { value: { "nodaro-prism": { masking: { mode: "always", source: "full-depth" } } }, updated_at: AT }
    h.stepsRow = { value: { "nodaro-prism": { shotList: { precise: { mode: "on" } } } }, updated_at: AT }
    // The same settings shape a Flex preview (so their absence below is the previz set's own).
    await previewOf({ engine: "nodaro-prism", style: "motion" })
    expect(h.calls[0]).toMatchObject({ promptWording: "new", source: "full-depth", scene: "description", shotLock: true })

    const res = await previewOf({ engine: "nodaro-prism", style: "previz", promptWording: "new", shotLock: "on", overrides: { referenceOnly: "Only the camera of {video}." } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(answer())
    expect(h.calls[1]).toEqual({
      engine: "seedance-2-5",
      style: "motion",
      clipKind: "previz",
      hasAudio: false,
      roles: [expect.objectContaining({ kind: "person", name: "the person" })],
      overrides: { referenceOnly: "Only the camera of {video}." },
    })
  })

  it("a save checks previz on the previz set with every role, room for the user's pre and post prompts and a clip without sound", async () => {
    setPluginSupports({ castSwap: EVERY_LEVER_ENGINE } as never)
    h.wordingRow = { value: { "nodaro-prism": "new" }, updated_at: AT }
    h.shotLockRow = { value: { "nodaro-prism": "on" }, updated_at: AT }
    expect((await put({ "nodaro-prism": { previz: { opener: "Render {video}." } } })).statusCode).toBe(200)
    expect(h.calls).toHaveLength(1)
    const call = h.calls[0]!
    expect(call).toMatchObject({ engine: "seedance-2-5", style: "motion", clipKind: "previz", hasAudio: false, overrides: { opener: "Render {video}." } })
    expect((call.roles as unknown[]).length).toBe(13)
    expect((call.references as unknown[]).length).toBeGreaterThan(0)
    expect((call.prePrompt as string).length).toBe(1000)
    expect((call.postPrompt as string).length).toBe(1000)
    for (const key of ["promptStyle", "promptWording", "source", "scene", "faceMesh", "shotList", "shotLock", "styleOnly", "depthColormap", "maskFill"]) {
      expect(call, key).not.toHaveProperty(key)
    }
    expect(h.row!.value).toEqual({ "nodaro-prism": { previz: { opener: "Render {video}." } } })
  })

  it("previz and motion never cross: each is stored, checked and answered to the engine on its own", async () => {
    expect((await put({ "nodaro-prism": { motion: { avoid: "A" }, previz: { avoid: "B" } } })).statusCode).toBe(200)
    expect(h.calls.map((c) => [c.clipKind, c.overrides])).toEqual([
      [undefined, { avoid: "A" }],
      ["previz", { avoid: "B" }],
    ])
    const stored = parseNodaroMotionPromptParts(h.row!.value)!
    expect(stored).toEqual({ "nodaro-prism": { motion: { avoid: "A" }, previz: { avoid: "B" } } })
    expect(withEarlierPromptPartKeys(stored)["motion-prism"]).toEqual({ motion: { avoid: "A" }, previz: { avoid: "B" } })
  })

  it("the engine's problems with a previz override are 422 naming the previz key, and nothing is saved", async () => {
    h.problemsFor = (body) => (body.clipKind === "previz" ? [{ part: "opener", code: "missing_placeholder", message: "The opener needs {video}." }] : [])
    const res = await put({ "nodaro-prism": { motion: { avoid: "A" }, previz: { opener: "Render it." } } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({ code: "prompt_parts_invalid", problems: [{ part: "opener", code: "missing_placeholder", engine: "nodaro-prism", style: "previz" }] })
    expect(h.upserts).toEqual([])
  })
})

describe("Pulse takes no 3D previz clip", () => {
  it("a Pulse previz entry is 400 previz_engine, before any environment is read, and saves nothing", async () => {
    const res = await put({ "nodaro-pulse": { previz: { avoid: "B" } } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "previz_engine", message: PULSE_TAKES_NO_PREVIZ_MESSAGE })
    expect(h.envReads).toBe(0)
    expect(h.calls).toEqual([])
    expect(h.upserts).toEqual([])
  })

  it("a Pulse previz preview is 400 previz_engine, and the engine is never asked", async () => {
    const res = await previewOf({ engine: "nodaro-pulse", style: "previz" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("previz_engine")
    expect(h.calls).toEqual([])
  })
})

describe("an engine that takes no 3D previz clip (every engine before it)", () => {
  it("the GET lists previz only for an engine that takes one", async () => {
    expect((await get()).json().data.styles).toEqual(["precise", "motion", "styleOnly", "previz"])
    setPluginSupports({ castSwap: CS } as never)
    expect((await get()).json().data.styles).toEqual(["precise", "motion", "styleOnly"])
    setPluginSupports({ castSwap: { ...CS, styleOnly: false, previz: true } } as never)
    expect((await get()).json().data.styles).toEqual(["precise", "motion", "previz"])
  })

  it("is 503 engine_unsupported for a previz preview and for a new previz entry, never asked, nothing saved", async () => {
    setPluginSupports({ castSwap: CS } as never)
    const preview = await previewOf({ engine: "nodaro-prism", style: "previz" })
    expect(preview.statusCode).toBe(503)
    expect(preview.json().error.code).toBe("engine_unsupported")
    const save = await put({ "nodaro-prism": { previz: { avoid: "B" } } })
    expect(save.statusCode).toBe(503)
    expect(h.calls).toEqual([])
    expect(h.upserts).toEqual([])
  })

  it("keeps an unchanged previz entry without asking for its set, and checks the other keys as before", async () => {
    setPluginSupports({ castSwap: CS } as never)
    h.row = { value: { "nodaro-prism": { previz: { avoid: "B" } } }, updated_at: AT }
    expect((await put({ "nodaro-prism": { motion: { avoid: "A" }, previz: { avoid: "B" } } })).statusCode).toBe(200)
    expect(h.calls).toEqual([expect.objectContaining({ style: "motion", overrides: { avoid: "A" } })])
    expect(h.calls[0]).not.toHaveProperty("clipKind")
    expect(h.row!.value).toEqual({ "nodaro-prism": { motion: { avoid: "A" }, previz: { avoid: "B" } } })
  })

  it("is never sent clipKind or shotLock by a prompt-parts request, whoever builds it", () => {
    for (const castSwap of [CS, { ...CS, previz: false, shotLock: false }]) {
      setPluginSupports({ castSwap } as never)
      const sent = forLoadedEngine({ engine: "seedance-2-5", style: "motion", clipKind: "previz", shotLock: true, hasAudio: true, roles: [] })
      expect(sent).not.toHaveProperty("clipKind")
      expect(sent).not.toHaveProperty("shotLock")
      expect(sent).toEqual(forLoadedEngine({ engine: "seedance-2-5", style: "motion", hasAudio: true, roles: [] }))
    }
    setPluginSupports({ castSwap: { ...CS, previz: true } } as never)
    expect(forLoadedEngine({ engine: "seedance-2-5", style: "motion", clipKind: "previz", shotLock: true, hasAudio: true, roles: [] })).toMatchObject({ clipKind: "previz" })
    expect(forLoadedEngine({ engine: "seedance-2-5", style: "motion", clipKind: "previz", shotLock: true, hasAudio: true, roles: [] })).not.toHaveProperty("shotLock")
    setPluginSupports({ castSwap: { ...CS, shotLock: true } } as never)
    expect(forLoadedEngine({ engine: "seedance-2-5", style: "motion", shotLock: true, hasAudio: true, roles: [] })).toMatchObject({ shotLock: true })
  })
})

describe("the shot lock in a Precise or a Motion request", () => {
  const body = { hasAudio: true, roles: [] }

  it("is named while the engine's shot lock is on, never for off, and never on a style-only or a previz request", () => {
    for (const style of ["precise", "motion"] as const) {
      expect(directRunRequest("nodaro-prism", style, undefined, body, undefined, undefined, undefined, "on"), style).toMatchObject({ shotLock: true })
      expect(directRunRequest("nodaro-prism", style, undefined, body, undefined, undefined, undefined, "off"), style).not.toHaveProperty("shotLock")
      // Left out: the request of before, key for key.
      expect(directRunRequest("nodaro-prism", style, undefined, body, undefined, undefined, undefined, "off")).toEqual(directRunRequest("nodaro-prism", style, undefined, body))
    }
    for (const style of ["styleOnly", "previz"] as const) {
      expect(directRunRequest("nodaro-prism", style, undefined, body, undefined, undefined, undefined, "on"), style).not.toHaveProperty("shotLock")
    }
  })

  it("is named for an override of its part whatever the setting, so it can be seen, checked and reset", () => {
    expect(directRunRequest("nodaro-prism", "precise", undefined, { ...body, overrides: { shotLock: "Keep the shots of {video}." } }, undefined, undefined, undefined, "off")).toMatchObject({ shotLock: true })
    expect(directRunRequest("nodaro-prism", "precise", undefined, { ...body, overrides: { face: "x" } })).not.toHaveProperty("shotLock")
  })

  it("a preview follows the saved setting, or the choice it is sent", async () => {
    await previewOf({ engine: "nodaro-prism", style: "precise" })
    expect(h.calls[0]).not.toHaveProperty("shotLock")
    h.shotLockRow = { value: { "nodaro-prism": "on" }, updated_at: AT }
    await previewOf({ engine: "nodaro-prism", style: "precise" })
    expect(h.calls[1]).toMatchObject({ shotLock: true })
    // The other engine is still off; a preview may ask for either value.
    await previewOf({ engine: "nodaro-pulse", style: "precise" })
    expect(h.calls[2]).not.toHaveProperty("shotLock")
    await previewOf({ engine: "nodaro-pulse", style: "precise", shotLock: "on" })
    expect(h.calls[3]).toMatchObject({ shotLock: true })
    await previewOf({ engine: "nodaro-prism", style: "precise", shotLock: "off" })
    expect(h.calls[4]).not.toHaveProperty("shotLock")
    expect((await previewOf({ engine: "nodaro-prism", style: "precise", shotLock: "always" })).statusCode).toBe(400)
  })

  it("a save checks each engine's overrides with that engine's saved shot lock", async () => {
    h.shotLockRow = { value: { "nodaro-pulse": "on" }, updated_at: AT }
    expect((await put({ "nodaro-prism": { precise: { avoid: "A" } }, "nodaro-pulse": { precise: { avoid: "B" } } })).statusCode).toBe(200)
    expect(h.calls.map((c) => [c.engine, c.shotLock])).toEqual([
      ["seedance-2-5", undefined],
      ["kling-4", true],
    ])
  })

  it("an engine that does not write the line is asked exactly as before, and the setting is not read for it", async () => {
    setPluginSupports({ castSwap: { ...CS, previz: true } } as never)
    h.shotLockRow = { value: { "nodaro-prism": "on" }, updated_at: AT }
    await previewOf({ engine: "nodaro-prism", style: "precise", shotLock: "on" })
    await previewOf({ engine: "nodaro-prism", style: "precise" })
    expect(h.calls[0]).not.toHaveProperty("shotLock")
    expect(h.calls[0]).toEqual(h.calls[1])
  })
})

describe("the platform hold on the previz key and the three part ids", () => {
  it("a new previz entry while production's platform does not claim them is 422, asks nothing and saves nothing", async () => {
    h.envs = PRODUCTION_PLATFORM_BEHIND as never
    const res = await put({ "nodaro-prism": { motion: { avoid: "A" }, previz: { avoid: "B" } } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({ code: "platform_unsupported", envs: ["production"] })
    expect(res.json().error.message).toContain("production")
    expect(h.calls).toEqual([])
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("an override of each new part id, under any key, is held the same way; a stale claim and a missing record do not count", async () => {
    for (const envs of [PRODUCTION_PLATFORM_BEHIND, [env("staging", PREVIZ_ENGINE)], [env("production", PREVIZ_ENGINE, PLATFORM_SUPPORTS as never, "2020-01-01T00:00:00.000Z"), env("staging", PREVIZ_ENGINE)], [env("production", PREVIZ_ENGINE, null), env("staging", PREVIZ_ENGINE)]]) {
      h.envs = envs as never
      for (const id of NEW_IDS) {
        for (const key of ["precise", "motion", "styleOnly"]) {
          const res = await put({ "nodaro-prism": { [key]: { [id]: "Keep {video}." } } })
          expect(res.statusCode, `${id} under ${key}`).toBe(422)
          expect(res.json().error).toMatchObject({ code: "platform_unsupported", envs: ["production"] })
        }
      }
    }
    expect(h.calls).toEqual([])
    expect(h.upserts).toEqual([])
  })

  it("a save that leaves them as they are, removes them, or holds none never reads the environments", async () => {
    h.envs = PRODUCTION_PLATFORM_BEHIND as never
    h.row = { value: { "nodaro-prism": { precise: { shotLock: "Keep {video}." }, previz: { avoid: "B" } } }, updated_at: AT }
    expect((await put({ "nodaro-prism": { precise: { shotLock: "Keep {video}.", avoid: "A" }, previz: { avoid: "B" } } })).statusCode).toBe(200)
    expect((await put({ "nodaro-prism": { precise: { avoid: "A2" } } })).statusCode).toBe(200)
    expect((await put({ "nodaro-pulse": { motion: { avoid: "C" } } })).statusCode).toBe(200)
    expect(h.envReads).toBe(0)
    expect(h.row!.value).toEqual({ "nodaro-pulse": { motion: { avoid: "C" } } })
  })

  it("once every environment's platform claims them, the entry is checked and saved", async () => {
    const res = await put({ "nodaro-prism": { precise: { shotLock: "Keep the shots of {video}." }, previz: { sound: "Only footsteps.", referenceOnly: "Only the camera of {video}." } } })
    expect(res.statusCode).toBe(200)
    expect(h.envReads).toBe(1)
    expect(h.calls.map((c) => [c.clipKind, c.shotLock])).toEqual([
      [undefined, true],
      ["previz", undefined],
    ])
    expect(h.audits).toHaveLength(1)
  })

  it("the gate's own rules: what counts as set or changed, and which platforms lack the claim", () => {
    const before = { "nodaro-prism": { precise: { shotLock: "A" }, previz: { avoid: "B" } } }
    expect(previzPromptPartsSetOrChanged(before, before)).toBe(false)
    expect(previzPromptPartsSetOrChanged({}, before)).toBe(false)
    expect(previzPromptPartsSetOrChanged({ "nodaro-prism": { precise: { avoid: "x" } } }, before)).toBe(false)
    expect(previzPromptPartsSetOrChanged({ "nodaro-prism": { precise: { shotLock: "A2" } } }, before)).toBe(true)
    expect(previzPromptPartsSetOrChanged({ "nodaro-prism": { previz: { avoid: "B2" } } }, before)).toBe(true)
    expect(previzPromptPartsSetOrChanged({ "nodaro-prism": { previz: { avoid: "B" } } }, null)).toBe(true)
    expect(previzPromptPartsSetOrChanged({ "nodaro-pulse": { motion: { sound: "x" } } }, before)).toBe(true)
    expect(environmentsWhosePlatformCannotTakePrevizPromptParts(BOTH_TAKE_THEM as never)).toEqual([])
    expect(environmentsWhosePlatformCannotTakePrevizPromptParts([])).toEqual(["staging", "production"])
    expect(platformHoldOfPrevizPromptParts(BOTH_TAKE_THEM as never)).toBeNull()
    expect(platformHoldOfPrevizPromptParts(PRODUCTION_PLATFORM_BEHIND as never)).toMatchObject({ code: "platform_unsupported", envs: ["production"] })
    expect(PLATFORM_SUPPORTS.previzPromptParts).toBe(true)
  })
})
