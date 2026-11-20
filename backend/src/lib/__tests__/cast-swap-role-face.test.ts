import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// The hooks that set a run's audio read the Video Remake settings: none is saved here.
vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../app-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../app-settings.js")>()),
  getAppSettings: async () => ({ nodaro_motion_pulse_audio: null, nodaro_motion_pulse_reference_audio: null, nodaro_motion_prism_reference_audio: null }),
  settingsReadFailed: () => false,
}))

const { ROLE_FACE_GATED_ROUTES, asksForOriginalFace, engineTakesRoleFace, engineTakesRoleFaceStoredMask, registerCastSwapRoleFaceGate } = await import("../cast-swap-role-face.js")
const { registerCastSwapPrevizGate } = await import("../cast-swap-previz-gate.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../private-plugins/supports-registry.js")
const { registerServerOnlyBodyKeysHook } = await import("../../middleware/server-only-body-keys.js")
const { registerNodaroMotionEngineHook } = await import("../../middleware/nodaro-motion-engine.js")
const { registerNodaroMotionPulseAudioHook } = await import("../../middleware/nodaro-motion-pulse-audio.js")
const { registerNodaroMotionPulseReferenceAudioHook } = await import("../../middleware/nodaro-motion-pulse-reference-audio.js")
const { registerNodaroMotionPrismReferenceAudioHook } = await import("../../middleware/nodaro-motion-prism-reference-audio.js")

/**
 * A person role's Face chip (`face`, decided 2026-11-20) on a direct Video Remake run, at the app's door.
 *
 * What must hold:
 *  - with an engine that declares `castSwap.roleFace`, `face` reaches the engine's route exactly as sent, through
 *    every hook the app runs on a Video Remake body first (server-only keys, the engine id, the three audio settings);
 *  - with an engine that does not, a body asking any role for `face: "original"` is refused 409
 *    `engine_unsupported` and the engine's route never runs (it would ignore the key and hide the face);
 *  - a body without `face`, or with only `face: "new"`, reaches the route untouched on every engine.
 */
const CS = { roleKinds: ["person" as const], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const ROUTES = ["/v1/video-remake", "/v1/video-remake/estimate", "/v1/cast-swap", "/v1/cast-swap/estimate"]
const body = (face?: "new" | "original") => ({
  videoUrl: "https://cdn.example.com/clip.mp4",
  roles: [
    { kind: "person", name: "the man", images: ["https://cdn.example.com/a.png"], outfit: "new", ...(face ? { face } : {}) },
    { kind: "person", name: "the woman", images: ["https://cdn.example.com/b.png"] },
  ],
})

let app: FastifyInstance
let seen: Array<{ url: string; body: unknown }>

beforeEach(async () => {
  seen = []
  _resetPluginSupportsForTests()
  app = Fastify({ logger: false })
  // As app.ts registers them.
  registerCastSwapPrevizGate(app)
  registerCastSwapRoleFaceGate(app)
  registerServerOnlyBodyKeysHook(app)
  registerNodaroMotionEngineHook(app)
  registerNodaroMotionPulseAudioHook(app)
  registerNodaroMotionPulseReferenceAudioHook(app)
  registerNodaroMotionPrismReferenceAudioHook(app)
  for (const url of ROUTES) {
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
    expect([...ROLE_FACE_GATED_ROUTES].sort()).toEqual([...ROUTES].sort())
  })
})

describe("an engine that takes the Face chip", () => {
  it("is sent face as it came, on the run and the estimate", async () => {
    setPluginSupports({ castSwap: { ...CS, roleFace: true } })
    for (const face of ["original", "new"] as const) {
      for (const url of ROUTES) {
        const res = await post(url, body(face))
        expect(res.statusCode).toBe(200)
        const roles = (seen.at(-1)!.body as { roles: Array<Record<string, unknown>> }).roles
        expect(roles[0]).toEqual({ kind: "person", name: "the man", images: ["https://cdn.example.com/a.png"], outfit: "new", face })
        expect(roles[1]).not.toHaveProperty("face")
      }
    }
  })
})

describe("an engine from before the Face chip", () => {
  it('refuses a role asking for face "original", before the engine route runs', async () => {
    setPluginSupports({ castSwap: CS })
    for (const url of ROUTES) {
      const res = await post(url, body("original"))
      expect(res.statusCode).toBe(409)
      expect(res.json().error).toEqual({ code: "engine_unsupported", message: expect.stringContaining('face: "original"') })
    }
    expect(seen).toEqual([])
  })

  it('passes a body without face, or with face "new" only, as it came', async () => {
    setPluginSupports({ castSwap: CS })
    for (const payload of [body(), body("new")]) {
      for (const url of ROUTES) {
        const res = await post(url, payload)
        expect(res.statusCode).toBe(200)
        expect((seen.at(-1)!.body as { roles: unknown[] }).roles).toEqual(payload.roles)
      }
    }
  })

  it("never asks on a GET, nor on another route", async () => {
    setPluginSupports({ castSwap: CS })
    app = Fastify({ logger: false })
    registerCastSwapRoleFaceGate(app)
    app.post("/v1/video-remake/plan-roles", async () => ({ ok: true }))
    await app.ready()
    expect((await post("/v1/video-remake/plan-roles", body("original"))).statusCode).toBe(200)
  })
})

describe("the helpers", () => {
  it("read a body's roles, and an engine's flags", () => {
    expect(asksForOriginalFace(body("original"))).toBe(true)
    expect(asksForOriginalFace(body("new"))).toBe(false)
    expect(asksForOriginalFace({ roles: "x" })).toBe(false)
    expect(asksForOriginalFace(null)).toBe(false)
    expect(engineTakesRoleFace({ ...CS, roleFace: true })).toBe(true)
    expect(engineTakesRoleFace(CS)).toBe(false)
    expect(engineTakesRoleFace(undefined)).toBe(false)
    expect(engineTakesRoleFaceStoredMask({ ...CS, roleFaceStoredMask: true })).toBe(true)
    expect(engineTakesRoleFaceStoredMask(CS)).toBe(false)
  })
})
