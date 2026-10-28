import Fastify from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A DIRECT Nodaro Motion run or quote gets its Pulse audio from the admin's
 * setting, never from the caller: `pulseAudio: "generated"` only on a Pulse run,
 * when the setting says so and the engine declares `castSwap.pulseAudio`;
 * otherwise no key at all (the original audio, today's body). A trend run
 * (`trendRun` on an internal request) keeps the body its trend composed.
 */
const h = vi.hoisted(() => ({ choice: null as "original" | "generated" | null, failed: false, reads: 0 }))

vi.mock("../../lib/app-settings.js", () => {
  const failedMarker = { failed: true }
  return {
    getAppSettings: async () => {
      h.reads++
      return h.failed ? failedMarker : { nodaro_motion_pulse_audio: h.choice }
    },
    settingsReadFailed: (s: unknown) => s === failedMarker,
  }
})
vi.mock("../../lib/config.js", () => ({ config: { INTERNAL_ORCHESTRATOR_SECRET: "s".repeat(40) } }))

const { registerNodaroMotionPulseAudioHook } = await import("../nodaro-motion-pulse-audio.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../lib/private-plugins/supports-registry.js")

const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const SECRET = { "x-internal-orchestrator-secret": "s".repeat(40) }

async function seen(body: unknown, url = "/v1/cast-swap", headers: Record<string, string> = {}) {
  const app = Fastify()
  registerNodaroMotionPulseAudioHook(app)
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
  h.choice = "generated"
  h.failed = false
  h.reads = 0
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { ...CS, pulseAudio: true } })
})

describe("registerNodaroMotionPulseAudioHook", () => {
  it.each(["motion-pulse", "motion-lite", "kling-4"])("a direct Pulse run or quote naming %s is sent pulseAudio: generated when the setting says so", async (engine) => {
    for (const url of ["/v1/cast-swap", "/v1/cast-swap/estimate"]) {
      expect(await seen({ videoUrl: "x", engine }, url)).toEqual({ videoUrl: "x", engine, pulseAudio: "generated" })
    }
  })

  it("sends no key for the original audio, a setting never saved, or a failed settings read", async () => {
    for (const choice of ["original", null] as const) {
      h.choice = choice
      expect(await seen({ videoUrl: "x", engine: "motion-pulse" })).toEqual({ videoUrl: "x", engine: "motion-pulse" })
    }
    h.choice = "generated"
    h.failed = true
    expect(await seen({ videoUrl: "x", engine: "motion-pulse" })).toEqual({ videoUrl: "x", engine: "motion-pulse" })
  })

  it("sends no key to an engine that does not declare castSwap.pulseAudio, and does not read the setting", async () => {
    for (const castSwap of [CS, { ...CS, pulseAudio: false }]) {
      setPluginSupports({ castSwap })
      expect(await seen({ videoUrl: "x", engine: "motion-pulse" })).toEqual({ videoUrl: "x", engine: "motion-pulse" })
    }
    expect(h.reads).toBe(0)
  })

  it("sends no key on a Prism run (named, or no engine at all), and does not read the setting", async () => {
    expect(await seen({ videoUrl: "x", engine: "motion-prism" })).toEqual({ videoUrl: "x", engine: "motion-prism" })
    expect(await seen({ videoUrl: "x" })).toEqual({ videoUrl: "x" })
    expect(h.reads).toBe(0)
  })

  it("drops a caller-sent pulseAudio on a direct run: people never choose it", async () => {
    h.choice = "original"
    expect(await seen({ videoUrl: "x", engine: "motion-pulse", pulseAudio: "generated" })).toEqual({ videoUrl: "x", engine: "motion-pulse" })
    expect(await seen({ videoUrl: "x", engine: "motion-prism", pulseAudio: "generated" })).toEqual({ videoUrl: "x", engine: "motion-prism" })
    // Over the internal hop too (MCP cast_swap relays a caller's arguments).
    expect(await seen({ videoUrl: "x", engine: "kling-4", pulseAudio: "generated" }, "/v1/cast-swap", SECRET)).toEqual({ videoUrl: "x", engine: "kling-4" })
    h.choice = "generated"
    expect(await seen({ videoUrl: "x", engine: "motion-pulse", pulseAudio: "original" })).toEqual({ videoUrl: "x", engine: "motion-pulse", pulseAudio: "generated" })
  })

  it("leaves a trend run (trendRun on an internal request) exactly as its trend composed it", async () => {
    const trend = { videoUrl: "x", engine: "kling-4", trendRun: { display: {} } }
    h.choice = "generated"
    expect(await seen(trend, "/v1/cast-swap", SECRET)).toEqual(trend)
    expect(await seen({ ...trend, pulseAudio: "generated" }, "/v1/cast-swap", SECRET)).toEqual({ ...trend, pulseAudio: "generated" })
    h.choice = "original"
    expect(await seen({ ...trend, pulseAudio: "generated" }, "/v1/cast-swap/estimate", SECRET)).toEqual({ ...trend, pulseAudio: "generated" })
  })

  it("treats trendRun without the internal secret (or a wrong one) as a direct run", async () => {
    h.choice = "original"
    const forged = { videoUrl: "x", engine: "kling-4", trendRun: { display: {} }, pulseAudio: "generated" }
    const { pulseAudio: _p, ...stripped } = forged
    expect(await seen(forged)).toEqual(stripped)
    expect(await seen(forged, "/v1/cast-swap", { "x-internal-orchestrator-secret": "wrong" })).toEqual(stripped)
  })

  it("leaves other routes as sent", async () => {
    const body = { engine: "motion-pulse", pulseAudio: "original" }
    expect(await seen(body, "/v1/cast-swap/j-1/full-quality")).toEqual(body)
    expect(await seen(body, "/v1/generate-video")).toEqual(body)
  })
})
