import Fastify from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A DIRECT Nodaro Motion run or quote gets its Prism reference audio from the
 * admin's setting (a mode per output resolution), never from the caller, and
 * only on a Prism run (one naming Prism, or no engine at all):
 * - an engine declaring `castSwap.prismReferenceAudioPerResolution` is sent
 *   the object of the non-"full" resolutions (no key when all are full);
 * - an engine declaring only `castSwap.prismReferenceAudio` is sent the mode
 *   of the run's own resolution (a draft, and a run naming none, is 480p);
 * - otherwise no key at all (the full audio, today's body).
 * The run and its quote get the same, so the quote prices what the run sends.
 * A trend run (`trendRun` on an internal request) keeps the body its trend
 * composed.
 */
import type { CastSwapPrismReferenceAudio } from "../../lib/cast-swap-prism-reference-audio.js"

type Mode = "full" | "voice" | "none" | "one-tone" | "octave"
type ByRes = CastSwapPrismReferenceAudio
const h = vi.hoisted(() => ({ choice: null as ByRes | null, failed: false, reads: 0 }))

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
const { parseNodaroMotionPrismReferenceAudio } = await import("../../lib/cast-swap-prism-reference-audio.js")

const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["480p" as const], trendRun: true }
const SECRET = { "x-internal-orchestrator-secret": "s".repeat(40) }
const URLS = ["/v1/cast-swap", "/v1/cast-swap/estimate"]
const every = (mode: Mode): ByRes => ({ "480p": mode, "720p": mode, "1080p": mode })

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
  h.choice = every("voice")
  h.failed = false
  h.reads = 0
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { ...CS, prismReferenceAudio: true } })
})

describe("registerNodaroMotionPrismReferenceAudioHook — an engine that takes a mode per resolution", () => {
  beforeEach(() => setPluginSupports({ castSwap: { ...CS, prismReferenceAudioPerResolution: true } }))

  it("sends a Prism run and its quote the setting's non-full resolutions, at any resolution", async () => {
    h.choice = { "480p": "full", "720p": "none", "1080p": "voice" }
    for (const url of URLS) {
      for (const over of [{}, { resolution: "720p" }, { resolution: "1080p", draft: false }, { draft: true }]) {
        expect(await seen({ videoUrl: "x", engine: "motion-prism", ...over }, url), `${url} ${JSON.stringify(over)}`).toEqual({
          videoUrl: "x",
          engine: "motion-prism",
          ...over,
          prismReferenceAudio: { "720p": "none", "1080p": "voice" },
        })
      }
    }
  })

  it("wins over the one-mode flag when both are declared", async () => {
    setPluginSupports({ castSwap: { ...CS, prismReferenceAudio: true, prismReferenceAudioPerResolution: true } })
    h.choice = { "720p": "none" }
    expect(await seen({ videoUrl: "x", resolution: "720p" })).toEqual({ videoUrl: "x", resolution: "720p", prismReferenceAudio: { "720p": "none" } })
  })

  it("sends no key when every resolution is the full audio, the setting was never saved, or the read failed", async () => {
    for (const choice of [every("full"), {}, null]) {
      h.choice = choice
      for (const url of URLS) expect(await seen({ videoUrl: "x", resolution: "720p" }, url)).toEqual({ videoUrl: "x", resolution: "720p" })
    }
    h.choice = every("none")
    h.failed = true
    expect(await seen({ videoUrl: "x" })).toEqual({ videoUrl: "x" })
  })

  it("sends a setting saved as one plain mode (the first shape) as that mode at every resolution", async () => {
    h.choice = parseNodaroMotionPrismReferenceAudio("none")
    expect(await seen({ videoUrl: "x", resolution: "1080p" })).toEqual({ videoUrl: "x", resolution: "1080p", prismReferenceAudio: every("none") })
  })

  it("drops a caller-sent object too", async () => {
    h.choice = null
    expect(await seen({ videoUrl: "x", prismReferenceAudio: { "720p": "none" } })).toEqual({ videoUrl: "x" })
  })
})

describe("registerNodaroMotionPrismReferenceAudioHook — one-tone and octave (cast-swap 0.426.0)", () => {
  const MODES = ["full", "voice", "none", "one-tone", "octave"] as const

  it("sends them only to an engine that lists them in castSwap.prismReferenceAudioModes, a run and its quote alike", async () => {
    h.choice = { "480p": "one-tone", "720p": "octave", "1080p": "none" }
    setPluginSupports({ castSwap: { ...CS, prismReferenceAudioPerResolution: true, prismReferenceAudioModes: MODES } })
    for (const url of URLS) {
      expect(await seen({ videoUrl: "x", resolution: "720p" }, url)).toEqual({
        videoUrl: "x",
        resolution: "720p",
        prismReferenceAudio: { "480p": "one-tone", "720p": "octave", "1080p": "none" },
      })
    }
    // An engine listing only one of them: the other is the full audio there.
    setPluginSupports({ castSwap: { ...CS, prismReferenceAudioPerResolution: true, prismReferenceAudioModes: ["full", "voice", "none", "one-tone"] as const } })
    expect(await seen({ videoUrl: "x" })).toEqual({ videoUrl: "x", prismReferenceAudio: { "480p": "one-tone", "1080p": "none" } })
  })

  it("an engine that does not list them is sent the full audio for them: no key where nothing else is chosen", async () => {
    for (const cs of [
      { prismReferenceAudioPerResolution: true },
      { prismReferenceAudio: true },
      { prismReferenceAudioPerResolution: true, prismReferenceAudioModes: ["full", "voice", "none"] },
    ] as Array<{ prismReferenceAudioPerResolution?: boolean; prismReferenceAudio?: boolean; prismReferenceAudioModes?: Array<"full" | "voice" | "none"> }>) {
      setPluginSupports({ castSwap: { ...CS, ...cs } })
      h.choice = every("one-tone")
      for (const url of URLS) expect(await seen({ videoUrl: "x", resolution: "720p" }, url), JSON.stringify(cs)).toEqual({ videoUrl: "x", resolution: "720p" })
      h.choice = { "480p": "octave", "720p": "voice" }
      const sent = await seen({ videoUrl: "x", resolution: "720p" })
      expect(sent.prismReferenceAudio, JSON.stringify(cs)).toEqual(cs.prismReferenceAudioPerResolution ? { "720p": "voice" } : "voice")
    }
  })

  it("an engine that takes one mode is sent the run's own resolution's, when it lists it", async () => {
    setPluginSupports({ castSwap: { ...CS, prismReferenceAudio: true, prismReferenceAudioModes: MODES } })
    h.choice = { "480p": "octave", "720p": "one-tone" }
    expect(await seen({ videoUrl: "x", draft: true })).toEqual({ videoUrl: "x", draft: true, prismReferenceAudio: "octave" })
    expect(await seen({ videoUrl: "x", resolution: "720p" })).toEqual({ videoUrl: "x", resolution: "720p", prismReferenceAudio: "one-tone" })
  })

  it("is never sent on a Pulse run", async () => {
    setPluginSupports({ castSwap: { ...CS, prismReferenceAudioPerResolution: true, prismReferenceAudioModes: MODES } })
    h.choice = every("one-tone")
    expect(await seen({ videoUrl: "x", engine: "motion-pulse" })).toEqual({ videoUrl: "x", engine: "motion-pulse" })
  })
})

describe("registerNodaroMotionPrismReferenceAudioHook — an engine that takes one mode", () => {
  it("sends the mode of the run's own resolution: a draft, the deprecated draft quality and a run naming none are 480p", async () => {
    h.choice = { "480p": "voice", "720p": "none", "1080p": "full" }
    for (const url of URLS) {
      for (const [over, mode] of [
        [{}, "voice"],
        [{ draft: true }, "voice"],
        [{ quality: "draft" }, "voice"],
        [{ resolution: "480p" }, "voice"],
        [{ resolution: "720p" }, "none"],
        [{ resolution: "720p", draft: false }, "none"],
        [{ resolution: "1080p" }, undefined],
        [{ resolution: "4k" }, "voice"],
      ] as const) {
        const sent = await seen({ videoUrl: "x", ...over }, url)
        expect(sent, `${url} ${JSON.stringify(over)}`).toEqual({ videoUrl: "x", ...over, ...(mode ? { prismReferenceAudio: mode } : {}) })
      }
    }
  })

  it("reads a setting saved as one plain mode as that mode at every resolution", async () => {
    h.choice = parseNodaroMotionPrismReferenceAudio("none")
    for (const resolution of ["480p", "720p", "1080p"]) {
      expect(await seen({ videoUrl: "x", resolution })).toEqual({ videoUrl: "x", resolution, prismReferenceAudio: "none" })
    }
  })

  it.each(["motion-prism", "motion-pro", "seedance-2-5"])(
    "a direct Prism run and its quote naming %s are both sent the admin's voice or none",
    async (engine) => {
      for (const choice of ["voice", "none"] as const) {
        h.choice = every(choice)
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
    for (const choice of [every("full"), {}, null]) {
      h.choice = choice
      expect(await seen({ videoUrl: "x", engine: "motion-prism" })).toEqual({ videoUrl: "x", engine: "motion-prism" })
    }
    h.choice = every("none")
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
    h.choice = every("full")
    for (const url of URLS) {
      expect(await seen({ videoUrl: "x", engine: "motion-prism", prismReferenceAudio: "none" }, url)).toEqual({ videoUrl: "x", engine: "motion-prism" })
    }
    expect(await seen({ videoUrl: "x", engine: "motion-pulse", prismReferenceAudio: "voice" })).toEqual({ videoUrl: "x", engine: "motion-pulse" })
    // Over the internal hop too (MCP cast_swap relays a caller's arguments).
    expect(await seen({ videoUrl: "x", prismReferenceAudio: "voice" }, "/v1/cast-swap", SECRET)).toEqual({ videoUrl: "x" })
    h.choice = every("voice")
    expect(await seen({ videoUrl: "x", engine: "motion-prism", prismReferenceAudio: "none" })).toEqual({
      videoUrl: "x",
      engine: "motion-prism",
      prismReferenceAudio: "voice",
    })
  })

  it("leaves a trend run (trendRun on an internal request) exactly as its trend composed it, its quote too", async () => {
    const trend = { videoUrl: "x", trendRun: { display: {} } }
    h.choice = every("voice")
    expect(await seen(trend, "/v1/cast-swap", SECRET)).toEqual(trend)
    for (const url of URLS) {
      expect(await seen({ ...trend, prismReferenceAudio: "none" }, url, SECRET)).toEqual({ ...trend, prismReferenceAudio: "none" })
    }
    h.choice = every("full")
    expect(await seen({ ...trend, prismReferenceAudio: "voice" }, "/v1/cast-swap/estimate", SECRET)).toEqual({ ...trend, prismReferenceAudio: "voice" })
  })

  it("treats trendRun without the internal secret (or a wrong one) as a direct run", async () => {
    h.choice = every("full")
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

describe("registerNodaroMotionPrismReferenceAudioHook — a mode and a pitch shift per resolution", () => {
  const PITCH = {
    ...CS,
    prismReferenceAudioPerResolution: true,
    prismReferenceAudioPitch: true,
    prismReferenceAudioModes: ["full", "voice", "none", "one-tone", "octave", "full-one-tone", "voice-one-tone"] as const,
  }

  it("sends an engine with the pitch shift the object form, a run and its quote alike, the default left out", async () => {
    setPluginSupports({ castSwap: PITCH })
    h.choice = parseNodaroMotionPrismReferenceAudio({ "480p": "full", "720p": { mode: "full", semitones: 7 }, "1080p": "none" })
    for (const url of URLS) {
      expect(await seen({ videoUrl: "x", resolution: "720p" }, url)).toEqual({
        videoUrl: "x",
        resolution: "720p",
        prismReferenceAudio: { "720p": { mode: "full", semitones: 7 }, "1080p": { mode: "none" } },
      })
    }
    // Today's ids too, as the values they always were.
    h.choice = { "480p": "voice", "720p": "octave" }
    expect(await seen({ videoUrl: "x" })).toEqual({ videoUrl: "x", prismReferenceAudio: { "480p": { mode: "voice", semitones: 4 }, "720p": { mode: "full", semitones: 12 } } })
    // Every resolution at the default: no key.
    h.choice = every("full")
    expect(await seen({ videoUrl: "x" })).toEqual({ videoUrl: "x" })
  })

  it("sends an engine without it the ids a value is, and the full audio where none says it", async () => {
    h.choice = parseNodaroMotionPrismReferenceAudio({ "480p": { mode: "voice", semitones: 4 }, "720p": { mode: "full", semitones: 7 }, "1080p": { mode: "voice-one-tone" } })
    setPluginSupports({ castSwap: { ...CS, prismReferenceAudioPerResolution: true, prismReferenceAudioModes: ["full", "voice", "none", "one-tone", "octave"] as const } })
    for (const url of URLS) expect(await seen({ videoUrl: "x", resolution: "720p" }, url)).toEqual({ videoUrl: "x", resolution: "720p", prismReferenceAudio: { "480p": "voice" } })
    setPluginSupports({ castSwap: { ...CS, prismReferenceAudio: true } })
    expect(await seen({ videoUrl: "x", resolution: "720p" })).toEqual({ videoUrl: "x", resolution: "720p" })
    expect(await seen({ videoUrl: "x", draft: true })).toEqual({ videoUrl: "x", draft: true, prismReferenceAudio: "voice" })
  })

  it("never sends it on a Pulse run, and drops a caller's object form", async () => {
    setPluginSupports({ castSwap: PITCH })
    h.choice = parseNodaroMotionPrismReferenceAudio({ "480p": { mode: "full", semitones: 7 } })
    expect(await seen({ videoUrl: "x", engine: "motion-pulse" })).toEqual({ videoUrl: "x", engine: "motion-pulse" })
    h.choice = null
    expect(await seen({ videoUrl: "x", prismReferenceAudio: { "480p": { mode: "none" } } })).toEqual({ videoUrl: "x" })
  })
})
