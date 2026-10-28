import Fastify from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A DIRECT Nodaro Motion run or quote gets its Prism reference audio from the
 * admin's setting, never from the caller: `prismReferenceAudio: "voice" |
 * "none"` only on a Prism run (one naming Prism, or no engine at all), when the
 * setting says so and the engine declares `castSwap.prismReferenceAudio`;
 * otherwise no key at all (the full audio, today's body). The run and its
 * quote get the same, so the quote prices what the run sends. A trend run
 * (`trendRun` on an internal request) keeps the body its trend composed.
 */
const h = vi.hoisted(() => ({ choice: null as "full" | "voice" | "none" | null, failed: false, reads: 0 }))

vi.mock("../../lib/app-settings.js", () => {
  const failedMarker = { failed: true }
  return {
    getAppSettings: async () => {
      h.reads++
      return h.failed ? failedMarker : { nodaro_motion_prism_reference_audio: h.choice }
    },
    settingsReadFailed: (s: unknown) => s === failedMarker,
  }
})
vi.mock("../../lib/config.js", () => ({ config: { INTERNAL_ORCHESTRATOR_SECRET: "s".repeat(40) } }))

const { registerNodaroMotionPrismReferenceAudioHook } = await import("../nodaro-motion-prism-reference-audio.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../lib/private-plugins/supports-registry.js")

const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["480p" as const], trendRun: true }
const SECRET = { "x-internal-orchestrator-secret": "s".repeat(40) }
const URLS = ["/v1/cast-swap", "/v1/cast-swap/estimate"]

async function seen(body: unknown, url = "/v1/cast-swap", headers: Record<string, string> = {}) {
  const app = Fastify()
  registerNodaroMotionPrismReferenceAudioHook(app)
  // Registered as a private plugin's routes are: in an encapsulated child, after the hook.
  await app.register(async (child) => {
    child.post("/v1/cast-swap", async (req) => req.body)
    child.post("/v1/cast-swap/estimate", async (req) => req.body)
    child.post("/v1/cast-swap/:jobId/full-quality", async (req) => req.body)
    child.post("/v1/generate-video", async (req) => req.body)
  })
  const res = await app.inject({ method: "POST", url, headers, payload: body as Record<string, unknown> })
  await app.close()
  return res.json() as Record<string, unknown>
}

beforeEach(() => {
  h.choice = "voice"
  h.failed = false
  h.reads = 0
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { ...CS, prismReferenceAudio: true } })
})

describe("registerNodaroMotionPrismReferenceAudioHook", () => {
  it.each(["motion-prism", "motion-pro", "seedance-2-5"])(
    "a direct Prism run and its quote naming %s are both sent the admin's voice or none",
    async (engine) => {
      for (const choice of ["voice", "none"] as const) {
        h.choice = choice
        for (const url of URLS) {
          expect(await seen({ videoUrl: "x", engine }, url), `${choice} ${url}`).toEqual({ videoUrl: "x", engine, prismReferenceAudio: choice })
        }
      }
    },
  )

  it("treats a run naming no engine as Prism: it gets the admin default too", async () => {
    for (const url of URLS) expect(await seen({ videoUrl: "x" }, url)).toEqual({ videoUrl: "x", prismReferenceAudio: "voice" })
  })

  it("sends no key for the full audio, a setting never saved, or a failed settings read", async () => {
    for (const choice of ["full", null] as const) {
      h.choice = choice
      expect(await seen({ videoUrl: "x", engine: "motion-prism" })).toEqual({ videoUrl: "x", engine: "motion-prism" })
    }
    h.choice = "none"
    h.failed = true
    expect(await seen({ videoUrl: "x", engine: "motion-prism" })).toEqual({ videoUrl: "x", engine: "motion-prism" })
  })

  it("sends no key to an engine that does not declare castSwap.prismReferenceAudio, and does not read the setting", async () => {
    for (const castSwap of [CS, { ...CS, prismReferenceAudio: false }]) {
      setPluginSupports({ castSwap })
      for (const url of URLS) expect(await seen({ videoUrl: "x", engine: "motion-prism" }, url)).toEqual({ videoUrl: "x", engine: "motion-prism" })
    }
    expect(h.reads).toBe(0)
  })

  it("sends no key on a Pulse run, or one naming an engine no vocabulary knows, and does not read the setting", async () => {
    expect(await seen({ videoUrl: "x", engine: "motion-pulse" })).toEqual({ videoUrl: "x", engine: "motion-pulse" })
    expect(await seen({ videoUrl: "x", engine: "kling-4" }, "/v1/cast-swap/estimate")).toEqual({ videoUrl: "x", engine: "kling-4" })
    expect(await seen({ videoUrl: "x", engine: "motion-other" })).toEqual({ videoUrl: "x", engine: "motion-other" })
    expect(h.reads).toBe(0)
  })

  it("drops a caller-sent prismReferenceAudio on a direct run: people never choose it", async () => {
    h.choice = "full"
    for (const url of URLS) {
      expect(await seen({ videoUrl: "x", engine: "motion-prism", prismReferenceAudio: "none" }, url)).toEqual({ videoUrl: "x", engine: "motion-prism" })
    }
    expect(await seen({ videoUrl: "x", engine: "motion-pulse", prismReferenceAudio: "voice" })).toEqual({ videoUrl: "x", engine: "motion-pulse" })
    // Over the internal hop too (MCP cast_swap relays a caller's arguments).
    expect(await seen({ videoUrl: "x", prismReferenceAudio: "voice" }, "/v1/cast-swap", SECRET)).toEqual({ videoUrl: "x" })
    h.choice = "voice"
    expect(await seen({ videoUrl: "x", engine: "motion-prism", prismReferenceAudio: "none" })).toEqual({
      videoUrl: "x",
      engine: "motion-prism",
      prismReferenceAudio: "voice",
    })
  })

  it("leaves a trend run (trendRun on an internal request) exactly as its trend composed it, its quote too", async () => {
    const trend = { videoUrl: "x", trendRun: { display: {} } }
    h.choice = "voice"
    expect(await seen(trend, "/v1/cast-swap", SECRET)).toEqual(trend)
    for (const url of URLS) {
      expect(await seen({ ...trend, prismReferenceAudio: "none" }, url, SECRET)).toEqual({ ...trend, prismReferenceAudio: "none" })
    }
    h.choice = "full"
    expect(await seen({ ...trend, prismReferenceAudio: "voice" }, "/v1/cast-swap/estimate", SECRET)).toEqual({ ...trend, prismReferenceAudio: "voice" })
  })

  it("treats trendRun without the internal secret (or a wrong one) as a direct run", async () => {
    h.choice = "full"
    const forged = { videoUrl: "x", trendRun: { display: {} }, prismReferenceAudio: "none" }
    const { prismReferenceAudio: _p, ...stripped } = forged
    expect(await seen(forged)).toEqual(stripped)
    expect(await seen(forged, "/v1/cast-swap", { "x-internal-orchestrator-secret": "wrong" })).toEqual(stripped)
  })

  it("leaves other routes as sent", async () => {
    const body = { engine: "motion-prism", prismReferenceAudio: "none" }
    expect(await seen(body, "/v1/cast-swap/j-1/full-quality")).toEqual(body)
    expect(await seen(body, "/v1/generate-video")).toEqual(body)
  })
})
