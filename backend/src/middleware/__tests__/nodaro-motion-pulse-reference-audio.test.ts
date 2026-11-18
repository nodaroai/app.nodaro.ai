import Fastify from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A DIRECT Video Remake run or quote gets its Pulse reference audio ("audio
 * in") from the admin's setting, never from the caller: on a Pulse run on an
 * engine declaring `castSwap.pulseReferenceAudio`, only the resolutions off the
 * default of the run's audio out (the body's `pulseAudio` as the Pulse audio
 * hook left it, so this hook runs after that one); otherwise no key at all
 * (today's body, byte for byte). A trend run (`trendRun` on an internal
 * request) keeps the body its trend composed.
 */
const h = vi.hoisted(() => ({
  stored: null as Record<string, unknown> | null,
  pulseAudio: null as "original" | "generated" | null,
  failed: false,
  reads: 0,
}))

vi.mock("../../lib/app-settings.js", () => {
  const failedMarker = { failed: true }
  return {
    getAppSettings: async () => {
      h.reads++
      return h.failed ? failedMarker : { nodaro_motion_pulse_reference_audio: h.stored, nodaro_motion_pulse_audio: h.pulseAudio }
    },
    settingsReadFailed: (s: unknown) => s === failedMarker,
  }
})
vi.mock("../../lib/config.js", () => ({ config: { INTERNAL_ORCHESTRATOR_SECRET: "s".repeat(40) } }))

const { registerNodaroMotionPulseReferenceAudioHook } = await import("../nodaro-motion-pulse-reference-audio.js")
const { registerNodaroMotionPulseAudioHook } = await import("../nodaro-motion-pulse-audio.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../lib/private-plugins/supports-registry.js")

const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const, "1080p" as const], trendRun: true }
const SECRET = { "x-internal-orchestrator-secret": "s".repeat(40) }
const VOICE = { mode: "voice", semitones: 4 }

/** The hooks as app.ts registers them: the Pulse audio hook (when asked), then this one. */
async function seen(body: unknown, url = "/v1/cast-swap", headers: Record<string, string> = {}, withPulseAudioHook = false) {
  const app = Fastify()
  if (withPulseAudioHook) registerNodaroMotionPulseAudioHook(app)
  registerNodaroMotionPulseReferenceAudioHook(app)
  // Registered as a private plugin's routes are: in an encapsulated child, after the hook.
  await app.register(async (child) => {
    child.post("/v1/cast-swap", async (req) => req.body)
    child.post("/v1/cast-swap/estimate", async (req) => req.body)
    child.post("/v1/cast-swap/:jobId/full-quality", async (req) => req.body)
    child.post("/v1/video-remake", async (req) => req.body)
    child.post("/v1/video-remake/estimate", async (req) => req.body)
    child.post("/v1/generate-video", async (req) => req.body)
  })
  const res = await app.inject({ method: "POST", url, headers, payload: body as Record<string, unknown> })
  await app.close()
  return res.json() as Record<string, unknown>
}

beforeEach(() => {
  h.stored = { "720p": VOICE, "1080p": { mode: "full", semitones: 4 } }
  h.pulseAudio = null
  h.failed = false
  h.reads = 0
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { ...CS, pulseAudio: true, pulseReferenceAudio: true } })
})

describe("registerNodaroMotionPulseReferenceAudioHook", () => {
  it.each(["nodaro-pulse", "motion-pulse", "kling-4"])("a direct Pulse run or quote naming %s is sent the setting's resolutions off the default", async (engine) => {
    for (const url of ["/v1/video-remake", "/v1/video-remake/estimate", "/v1/cast-swap", "/v1/cast-swap/estimate"]) {
      expect(await seen({ videoUrl: "x", engine }, url)).toEqual({ videoUrl: "x", engine, pulseReferenceAudio: { "720p": VOICE } })
    }
  })

  it("reads the default from the run's audio out: full at +4 is sent where the run delivers Kling's own audio", async () => {
    expect(await seen({ videoUrl: "x", engine: "kling-4", pulseAudio: "generated" })).toEqual({
      videoUrl: "x",
      engine: "kling-4",
      pulseAudio: "generated",
      pulseReferenceAudio: { "720p": VOICE, "1080p": { mode: "full", semitones: 4 } },
    })
    h.stored = { "720p": { mode: "full", semitones: 0 } }
    expect(await seen({ videoUrl: "x", engine: "kling-4", pulseAudio: "generated" })).toEqual({ videoUrl: "x", engine: "kling-4", pulseAudio: "generated" })
    expect(await seen({ videoUrl: "x", engine: "kling-4" })).toEqual({ videoUrl: "x", engine: "kling-4", pulseReferenceAudio: { "720p": { mode: "full", semitones: 0 } } })
  })

  it("runs after the Pulse audio hook and reads the audio out it leaves, never the caller's", async () => {
    h.stored = { "720p": { mode: "full", semitones: 0 } }
    // The setting delivers the original audio: the caller's "generated" is dropped, so full at 0 is off the default.
    h.pulseAudio = "original"
    expect(await seen({ videoUrl: "x", engine: "kling-4", pulseAudio: "generated" }, "/v1/cast-swap", {}, true)).toEqual({
      videoUrl: "x",
      engine: "kling-4",
      pulseReferenceAudio: { "720p": { mode: "full", semitones: 0 } },
    })
    // The setting delivers Kling's own audio: full at 0 is the default there.
    h.pulseAudio = "generated"
    expect(await seen({ videoUrl: "x", engine: "kling-4" }, "/v1/cast-swap", {}, true)).toEqual({ videoUrl: "x", engine: "kling-4", pulseAudio: "generated" })
  })

  it("leaves a body exactly as sent when nothing is off the default, the setting was never saved, or its read failed", async () => {
    for (const stored of [null, {}, { "720p": { mode: "full", semitones: 4 } }]) {
      h.stored = stored
      const body = { videoUrl: "x", engine: "kling-4", resolution: "1080p" }
      expect(await seen(body)).toEqual(body)
    }
    h.failed = true
    expect(await seen({ videoUrl: "x", engine: "kling-4" })).toEqual({ videoUrl: "x", engine: "kling-4" })
  })

  it("sends no key to an engine that does not declare castSwap.pulseReferenceAudio, and does not read the setting", async () => {
    for (const castSwap of [CS, { ...CS, pulseAudio: true }, { ...CS, pulseReferenceAudio: false }]) {
      setPluginSupports({ castSwap })
      expect(await seen({ videoUrl: "x", engine: "kling-4" })).toEqual({ videoUrl: "x", engine: "kling-4" })
    }
    expect(h.reads).toBe(0)
  })

  it("sends no key on a Prism run (named, or no engine at all), and does not read the setting", async () => {
    expect(await seen({ videoUrl: "x", engine: "nodaro-prism" })).toEqual({ videoUrl: "x", engine: "nodaro-prism" })
    expect(await seen({ videoUrl: "x" })).toEqual({ videoUrl: "x" })
    expect(h.reads).toBe(0)
  })

  it("drops a caller-sent pulseReferenceAudio on a direct run: people never choose it", async () => {
    h.stored = null
    const forged = { "720p": { mode: "none" } }
    expect(await seen({ videoUrl: "x", engine: "kling-4", pulseReferenceAudio: forged })).toEqual({ videoUrl: "x", engine: "kling-4" })
    expect(await seen({ videoUrl: "x", engine: "nodaro-prism", pulseReferenceAudio: forged })).toEqual({ videoUrl: "x", engine: "nodaro-prism" })
    // Over the internal hop too (MCP video_remake relays a caller's arguments).
    expect(await seen({ videoUrl: "x", engine: "kling-4", pulseReferenceAudio: forged }, "/v1/cast-swap", SECRET)).toEqual({ videoUrl: "x", engine: "kling-4" })
    h.stored = { "720p": VOICE }
    expect(await seen({ videoUrl: "x", engine: "kling-4", pulseReferenceAudio: forged })).toEqual({ videoUrl: "x", engine: "kling-4", pulseReferenceAudio: { "720p": VOICE } })
  })

  it("leaves a trend run (trendRun on an internal request) exactly as its trend composed it", async () => {
    const trend = { videoUrl: "x", engine: "kling-4", trendRun: { display: {} } }
    expect(await seen(trend, "/v1/cast-swap", SECRET)).toEqual(trend)
    const own = { ...trend, pulseReferenceAudio: { "1080p": { mode: "none" } } }
    expect(await seen(own, "/v1/cast-swap/estimate", SECRET)).toEqual(own)
  })

  it("treats trendRun without the internal secret (or a wrong one) as a direct run", async () => {
    h.stored = null
    const forged = { videoUrl: "x", engine: "kling-4", trendRun: { display: {} }, pulseReferenceAudio: { "720p": { mode: "none" } } }
    const { pulseReferenceAudio: _p, ...stripped } = forged
    expect(await seen(forged)).toEqual(stripped)
    expect(await seen(forged, "/v1/cast-swap", { "x-internal-orchestrator-secret": "wrong" })).toEqual(stripped)
  })

  it("leaves other routes as sent", async () => {
    const body = { engine: "kling-4", pulseReferenceAudio: { "720p": { mode: "none" } } }
    expect(await seen(body, "/v1/cast-swap/j-1/full-quality")).toEqual(body)
    expect(await seen(body, "/v1/generate-video")).toEqual(body)
  })
})
