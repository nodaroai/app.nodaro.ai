import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// The hooks that set a run's audio read the Video Remake settings: none is saved here.
vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../app-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../app-settings.js")>()),
  getAppSettings: async () => ({ nodaro_motion_pulse_audio: null, nodaro_motion_pulse_reference_audio: null, nodaro_motion_prism_reference_audio: null }),
  settingsReadFailed: () => false,
}))

const { PREVIZ_GATED_ROUTES, namesPrevizClip, registerCastSwapPrevizGate } = await import("../cast-swap-previz-gate.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../private-plugins/supports-registry.js")
const { nonAdminJobInputData, redactPrivateJobData } = await import("../public-job-data.js")
const { registerServerOnlyBodyKeysHook } = await import("../../middleware/server-only-body-keys.js")
const { registerNodaroMotionEngineHook } = await import("../../middleware/nodaro-motion-engine.js")
const { registerNodaroMotionPulseAudioHook } = await import("../../middleware/nodaro-motion-pulse-audio.js")
const { registerNodaroMotionPulseReferenceAudioHook } = await import("../../middleware/nodaro-motion-pulse-reference-audio.js")
const { registerNodaroMotionPrismReferenceAudioHook } = await import("../../middleware/nodaro-motion-prism-reference-audio.js")

/**
 * A Video Remake body that states a 3D previz clip, at the app's door.
 *
 * What must hold:
 *  - with an engine that declares `castSwap.previz`, nothing of the body is
 *    refused, changed or taken out before the engine's route sees it:
 *    `clipKind`, `previz` (`lighting`, `sound`) and a role's `subject` arrive
 *    as sent, on the run and the estimate, under both prefixes;
 *  - with an engine that does not (every engine before it), such a body is
 *    refused 403 `previz_not_available` and the engine's route never runs: it
 *    would drop the keys and run an ordinary edit;
 *  - an ordinary body is never touched, whatever the engine;
 *  - the app's own hooks that rewrite a Video Remake body before the engine
 *    reads it (the server-only keys, the engine id, the three audio settings)
 *    keep `clipKind`, `previz` and each role's `subject` as sent, and take out
 *    only a caller's `__` keys;
 *  - a job's read shows `clipKind` and `previz`, and hides the `__` keys.
 */
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const ROUTES = ["/v1/video-remake", "/v1/video-remake/estimate", "/v1/cast-swap", "/v1/cast-swap/estimate"]
const PREVIZ_BODY = {
  videoUrl: "https://cdn.example.com/previz.mp4",
  clipKind: "previz",
  previz: { lighting: true, sound: "generated" },
  roles: [{ kind: "person", name: "the pink model", subject: "the detective", images: ["https://cdn.example.com/a.png"] }],
  postPrompt: "A rainy street at night.",
}

let app: FastifyInstance
let seen: Array<{ url: string; body: unknown }>

beforeEach(async () => {
  seen = []
  _resetPluginSupportsForTests()
  app = Fastify({ logger: false })
  registerCastSwapPrevizGate(app)
  // Stand-ins for the engine's routes: they answer what they were sent.
  for (const url of [...ROUTES, "/v1/video-remake/plan-roles"]) {
    app.post(url, async (req) => {
      seen.push({ url, body: req.body })
      return { ok: true }
    })
  }
  await app.ready()
})
afterEach(() => _resetPluginSupportsForTests())

const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as object })

describe("the gated routes", () => {
  it("are the run and the estimate, under both prefixes", () => {
    expect([...PREVIZ_GATED_ROUTES].sort()).toEqual([...ROUTES].sort())
  })
})

describe("an engine that takes a 3D previz clip", () => {
  it("is sent the body as it came: clipKind, previz and a role's subject untouched", async () => {
    setPluginSupports({ castSwap: { ...CS, previz: true } })
    for (const url of ROUTES) {
      const res = await post(url, PREVIZ_BODY)
      expect(res.statusCode, url).toBe(200)
    }
    expect(seen.map((s) => s.url)).toEqual(ROUTES)
    for (const s of seen) expect(s.body, s.url).toEqual(PREVIZ_BODY)
  })
})

describe("an engine that does not declare castSwap.previz", () => {
  it("is never sent a body that states a 3D previz clip: 403 previz_not_available", async () => {
    for (const castSwap of [undefined, CS, { ...CS, previz: false }, { ...CS, shotLock: true, planRoles: true }]) {
      if (castSwap) setPluginSupports({ castSwap })
      else _resetPluginSupportsForTests()
      for (const url of ROUTES) {
        for (const body of [PREVIZ_BODY, { ...PREVIZ_BODY, previz: undefined }, { videoUrl: PREVIZ_BODY.videoUrl, roles: [], previz: { sound: "clip" } }]) {
          const res = await post(url, body)
          expect(res.statusCode, `${url} ${JSON.stringify(castSwap)}`).toBe(403)
          expect(res.json().error).toEqual({ code: "previz_not_available", message: "A 3D previz clip is not available here. Send an ordinary clip instead." })
        }
      }
    }
    expect(seen).toEqual([])
  })

  it("is sent an ordinary body as before, one that names its clip as footage included", async () => {
    setPluginSupports({ castSwap: CS })
    const ordinary = { videoUrl: PREVIZ_BODY.videoUrl, roles: PREVIZ_BODY.roles, postPrompt: "x" }
    for (const body of [ordinary, { ...ordinary, clipKind: "footage" }, { ...ordinary, previz: null }]) {
      expect((await post("/v1/video-remake", body)).statusCode, JSON.stringify(body)).toBe(200)
    }
    expect(seen.map((s) => s.body)).toEqual([ordinary, { ...ordinary, clipKind: "footage" }, { ...ordinary, previz: null }])
  })

  it("leaves every other route alone", async () => {
    setPluginSupports({ castSwap: CS })
    expect((await post("/v1/video-remake/plan-roles", PREVIZ_BODY)).statusCode).toBe(200)
  })
})

describe("the app's own hooks in front of the engine's routes", () => {
  /** Every hook `app.ts` registers that replaces `req.body` on these routes, in its order, then the gate. */
  async function withBodyHooks() {
    const chain = Fastify({ logger: false })
    registerServerOnlyBodyKeysHook(chain)
    registerCastSwapPrevizGate(chain)
    registerNodaroMotionEngineHook(chain)
    registerNodaroMotionPulseAudioHook(chain)
    registerNodaroMotionPulseReferenceAudioHook(chain)
    registerNodaroMotionPrismReferenceAudioHook(chain)
    const got: Array<{ url: string; body: unknown }> = []
    for (const url of ROUTES) {
      chain.post(url, async (req) => {
        got.push({ url, body: req.body })
        return { ok: true }
      })
    }
    await chain.ready()
    return { chain, got }
  }

  it("keep clipKind, previz and each role's subject as sent, on the run and the estimate, and drop only a caller's __ keys", async () => {
    setPluginSupports({ castSwap: { ...CS, previz: true, engines: ["nodaro-prism", "nodaro-pulse"], engineAliases: true } as never })
    const { chain, got } = await withBodyHooks()
    const sent = { ...PREVIZ_BODY, engine: "nodaro-prism", __previzLook: "style", __shotLock: true }
    for (const url of ROUTES) expect((await chain.inject({ method: "POST", url, payload: sent })).statusCode, url).toBe(200)
    expect(got.map((g) => g.url)).toEqual(ROUTES)
    for (const { url, body } of got) {
      const read = body as Record<string, unknown>
      expect(read.clipKind, url).toBe("previz")
      expect(read.previz, url).toEqual(PREVIZ_BODY.previz)
      expect(read.roles, url).toEqual(PREVIZ_BODY.roles)
      expect(read, url).not.toHaveProperty("__previzLook")
      expect(read, url).not.toHaveProperty("__shotLock")
    }
    await chain.close()
  })

  it("with an engine that takes no such clip, the same chain refuses the body before any route runs", async () => {
    setPluginSupports({ castSwap: CS })
    const { chain, got } = await withBodyHooks()
    for (const url of ROUTES) {
      const res = await chain.inject({ method: "POST", url, payload: { ...PREVIZ_BODY, engine: "nodaro-prism" } })
      expect(res.statusCode, url).toBe(403)
      expect(res.json().error.code).toBe("previz_not_available")
    }
    expect(got).toEqual([])
    await chain.close()
  })
})

describe("what states a 3D previz clip", () => {
  it("is clipKind previz, or any previz options", () => {
    for (const body of [{ clipKind: "previz" }, { previz: {} }, { previz: { lighting: false } }, { clipKind: "footage", previz: { sound: "clip" } }]) {
      expect(namesPrevizClip(body), JSON.stringify(body)).toBe(true)
    }
    for (const body of [undefined, null, "previz", [], {}, { clipKind: "footage" }, { clipKind: "Previz" }, { previz: null }, { roles: [{ subject: "x" }] }]) {
      expect(namesPrevizClip(body), JSON.stringify(body)).toBe(false)
    }
  })
})

describe("a 3D previz run's job, as its owner reads it", () => {
  it("shows clipKind, previz and the roles' subject, and hides what the run resolved for itself", () => {
    const row = {
      input_data: {
        type: "cast-swap",
        clipKind: "previz",
        previz: { lighting: true, sound: "generated" },
        roles: [{ kind: "person", name: "the pink model", subject: "the detective" }],
        __previzLook: "real-world",
        __shotLock: true,
      },
    }
    expect(nonAdminJobInputData(redactPrivateJobData(row).input_data)).toEqual({
      type: "cast-swap",
      clipKind: "previz",
      previz: { lighting: true, sound: "generated" },
      roles: [{ kind: "person", name: "the pink model", subject: "the detective" }],
    })
  })
})
