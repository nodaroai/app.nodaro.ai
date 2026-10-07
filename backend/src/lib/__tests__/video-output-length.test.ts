/**
 * Every video producer has a length rule (decided 2026-10-07), so a listing can
 * price a length-priced step on any chain of them and never quote below the
 * charge. A node that delivers a video and has no rule fails here, and so does
 * a rule that cannot bound its output without being named in
 * `UNBOUNDED_LENGTH_REASONS` — the list of what the listing still cannot bound,
 * which may only shrink.
 *
 * The rules are checked against the functions each node's own run prices with
 * (generate-video-pro's clamp, the lip-sync audio cap, the cinematic clamp, ...).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  AI_AVATAR_MAX_AUDIO_SEC,
  AI_AVATAR_MAX_DURATION_SEC,
  CINEMATIC_MAX_DURATION_SEC,
  DYNAMIC_PRODUCER_TYPES,
  MODEL_CATALOG,
  PRO3D_RENDER_LIMITS,
  VIDEO_PRODUCER_TYPES,
  VIDEO_SFX_PRICING,
  VIDEO_UTIL_PRICING,
  clampCinematicDuration,
  estimateScriptDurationSec,
  isRenderNodeType,
  getLipSyncMaxAudioSeconds,
  ltxExtendDurationSec,
} from "@nodaro/shared"
import {
  DYNAMIC_VIDEO_OUTPUT_TYPES,
  PASS_THROUGH_VIDEO_TYPES,
  SLIDESHOW_MAX_IMAGES,
  motionTransferCeilingSec,
  UNBOUNDED_LENGTH_REASONS,
  VIDEO_OUTPUT_LENGTH_RULES,
  floorLength,
  videoOutputLength,
  type InputLength,
  type WireInput,
  type WireLength,
} from "../video-output-length.js"
import { seedanceExtendDurationWindow, seedanceExtendGenerationModel } from "../seedance-extend-model.js"
import { generateVideoProClampedSec, generateVideoProLengthSec } from "../generate-video-pro-length.js"
import { computeGenerateVideoProPricing } from "../../ee/billing/generate-video-pro-credits.js"

const fixed = (sec: number): InputLength => ({ fixedSec: sec, perEpisodeSec: 0 })
const episode: InputLength = { fixedSec: 0, perEpisodeSec: 60 }
const wire = (kind: WireInput["kind"], length: WireLength, handle: string | null = null, sourceId = `${kind}-${handle ?? "w"}`): WireInput => ({ sourceId, handle, kind, length })
const video = (length: WireLength, handle = "video") => wire("video", length, handle)
const audio = (length: WireLength, handle = "audio") => wire("audio", length, handle)
const run = (type: string, inputs: WireInput[], data: Record<string, unknown> = {}) => videoOutputLength({ id: "n", type, data }, inputs)

describe("every video producer has a length rule", () => {
  const delivering = [...new Set([...VIDEO_PRODUCER_TYPES, ...DYNAMIC_VIDEO_OUTPUT_TYPES])]

  it.each(delivering)("%s", (type) => {
    expect(VIDEO_OUTPUT_LENGTH_RULES[type], `${type} has no length rule in video-output-length.ts`).toBeDefined()
  })

  it("no rule names a node that delivers no video", () => {
    for (const type of Object.keys(VIDEO_OUTPUT_LENGTH_RULES)) expect(delivering, type).toContain(type)
  })

  it("a render is read as a render, and only a render", () => {
    for (const [type, rule] of Object.entries(VIDEO_OUTPUT_LENGTH_RULES)) expect(rule.via === "render", type).toBe(isRenderNodeType(type))
  })

  it("the dynamic steps the registry lists are the dynamic producers the platform has", () => {
    for (const type of DYNAMIC_VIDEO_OUTPUT_TYPES) expect(DYNAMIC_PRODUCER_TYPES.has(type) || VIDEO_PRODUCER_TYPES.has(type), type).toBe(true)
  })
})

describe("what the listing cannot bound is named, and only that", () => {
  // Fully known inputs on every handle a producer reads; and the same with the
  // audio's length unknown (a generated or wired-in audio has none before the run).
  const handles = ["video", "in", "media"]
  const knownInputs = [...handles.map((h) => video(fixed(30), h)), audio(fixed(20), "audio")]
  const audioUnknown = [...handles.map((h) => video(fixed(30), h)), audio(undefined, "audio")]
  const unboundedBy = (inputs: WireInput[]) =>
    Object.entries(VIDEO_OUTPUT_LENGTH_RULES)
      .filter(([, rule]) => rule.via === "rule")
      .filter(([type]) => run(type, inputs) === "unknown")
      .map(([type]) => type)

  it("the producers that can return unknown are exactly UNBOUNDED_LENGTH_REASONS", () => {
    const named = Object.keys(UNBOUNDED_LENGTH_REASONS).filter((t) => VIDEO_OUTPUT_LENGTH_RULES[t]?.via === "rule")
    const found = [...new Set([...unboundedBy(knownInputs), ...unboundedBy(audioUnknown)])]
    expect(found.sort()).toEqual(named.sort())
  })

  it("pins the burn-down list (it only shrinks: delete an entry when its rule gets a bound)", () => {
    expect(Object.keys(UNBOUNDED_LENGTH_REASONS).sort()).toEqual(
      [
        "assemble-narrated-video",
        "extend-video",
        "gif-to-video",
        "list",
        "manual-edit",
        "merge-video-audio",
        "reduce",
        "render-video",
        "slideshow",
        "speech-to-video",
        "still-to-video",
        "sub-workflow",
        "suno-music-video",
        "youtube-video",
      ].sort(),
    )
  })
})

describe("the floor: never below the length the next step's run reads", () => {
  it("lifts a fixed length to the estimators' fallback when the node carries no duration", () => {
    expect(floorLength(fixed(3), {})).toEqual(fixed(VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS))
  })
  it("reads the node's own configured duration", () => {
    expect(floorLength(fixed(3), { duration: 12 })).toEqual(fixed(12))
  })
  it("leaves a longer length and a per-minute length alone", () => {
    expect(floorLength(fixed(30), {})).toEqual(fixed(30))
    expect(floorLength(episode, {})).toEqual(episode)
    expect(floorLength("unknown", {})).toBe("unknown")
  })
})

describe("steps that keep their input's length", () => {
  it.each(PASS_THROUGH_VIDEO_TYPES)("%s passes a fixed length and a per-minute length through", (type) => {
    expect(run(type, [video(fixed(90))])).toEqual(fixed(90))
    expect(run(type, [video(episode)])).toEqual(episode)
    expect(run(type, [video("unknown")])).toBe("unknown")
    expect(run(type, [])).toBe("unknown")
  })

  it("the dual-mode steps keep a video or an audio", () => {
    for (const type of ["adjust-volume", "voice-changer", "voice-changer-pro", "dubbing"]) {
      expect(run(type, [wire("video", fixed(40), "in")]), type).toEqual(fixed(40))
      expect(run(type, [wire("audio", fixed(40), "in")]), type).toEqual(fixed(40))
    }
  })

  it("Edit Video Pro adds a stitch seam to its source", () => {
    expect(run("edit-video-pro", [video(fixed(60))])).toEqual(fixed(61))
    expect(run("edit-video-pro", [video(episode)])).toEqual({ fixedSec: 1, perEpisodeSec: 60 })
  })
})

describe("generate-video-pro: the clamp its pricing applies", () => {
  const providers = ["seedance-2", "seedance-2-fast", "veo3", "kling-3-omni"].filter((p) => MODEL_CATALOG[p]?.durations?.length)
  it.each(providers)("%s: the helper's clamp is the pricing's clampedDurationSec", async (provider) => {
    for (const duration of [undefined, 1, 4, 8, 12, 15, 16, 30, 61, 200]) {
      let pricing
      try {
        pricing = await computeGenerateVideoProPricing({ provider, resolution: "720p", durationSec: duration ?? 8 })
      } catch {
        continue // a provider the pro engine cannot price at this shape: no run to follow
      }
      expect(generateVideoProClampedSec(provider, duration), `${provider} @ ${duration}`).toBe(pricing.clampedDurationSec)
      expect(generateVideoProLengthSec(provider, duration), `${provider} @ ${duration}`).toBeGreaterThanOrEqual(pricing.clampedDurationSec)
    }
  }, 120_000)

  it("lists the configured duration, and a stitched clip one second over", () => {
    expect(run("generate-video-pro", [], { provider: "seedance-2", duration: 10 })).toEqual(fixed(10))
    expect(run("generate-video-pro", [], { provider: "seedance-2", duration: 40 })).toEqual(fixed(41))
  })

  it("an unset duration is the run's 8 seconds", () => {
    expect(run("generate-video-pro", [], { provider: "seedance-2" })).toEqual(fixed(8))
  })
})

describe("Cinematic Avatar", () => {
  it("lists the clamped duration", () => {
    expect(run("cinematic-avatar", [], { duration: 6 })).toEqual(fixed(clampCinematicDuration(6)))
  })
  it("lists the 15-second ceiling on auto duration, as its run reserves it", () => {
    expect(run("cinematic-avatar", [], { duration: 5, autoDuration: true })).toEqual(fixed(CINEMATIC_MAX_DURATION_SEC))
  })
})

describe("Lip Sync: the audio, capped at what its provider takes", () => {
  it("a known audio is its length up to the cap", () => {
    const cap = getLipSyncMaxAudioSeconds("kling-avatar")
    expect(run("lip-sync", [audio(fixed(40))], { provider: "kling-avatar" })).toEqual(fixed(40))
    expect(run("lip-sync", [audio(fixed(cap + 100))], { provider: "kling-avatar" })).toEqual(fixed(cap))
  })
  it("an unknown audio is the provider's cap (the run trims to it)", () => {
    expect(run("lip-sync", [audio(undefined)], { provider: "infinitalk" })).toEqual(fixed(getLipSyncMaxAudioSeconds("infinitalk")))
    expect(run("lip-sync", [], { provider: "heygen-lipsync-precision" })).toEqual(fixed(300))
  })
  it("an audio that follows the episode lists at the cap", () => {
    expect(run("lip-sync", [audio(episode)], { provider: "kling-avatar" })).toEqual(fixed(300))
  })
  it("an audio wire carried as a video (it left a dynamic step) is the audio, never the video", () => {
    const cap = getLipSyncMaxAudioSeconds("kling-avatar")
    expect(run("lip-sync", [wire("video", "unknown", "audio")], { provider: "kling-avatar" })).toEqual(fixed(cap))
    expect(run("lip-sync", [wire("video", undefined, "audio")], { provider: "kling-avatar" })).toEqual(fixed(cap))
  })
  it("a video-driven mode is never below the video", () => {
    expect(run("lip-sync", [video(fixed(500)), audio(fixed(20))], { provider: "sync-lipsync-v3" })).toEqual(fixed(500))
    expect(run("lip-sync", [video("unknown"), audio(fixed(20))], { provider: "sync-lipsync-v3" })).toBe("unknown")
  })
})

describe("AI Avatar", () => {
  it("text mode: the script's estimated reading, as its own reserve counts it", () => {
    const script = "a".repeat(240)
    expect(run("ai-avatar", [], { speechMode: "text", script, voiceSpeed: 1 })).toEqual(fixed(Math.max(estimateScriptDurationSec(script, 1), VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS)))
  })
  it("text mode with a wired script or a {Label} in it: the top bucket", () => {
    expect(run("ai-avatar", [wire("other", undefined, "script")], { speechMode: "text", script: "hi" })).toEqual(fixed(AI_AVATAR_MAX_DURATION_SEC))
    expect(run("ai-avatar", [], { speechMode: "text", script: "read {Script} aloud" })).toEqual(fixed(AI_AVATAR_MAX_DURATION_SEC))
  })
  it("audio mode: the audio, trimmed to 600 seconds", () => {
    expect(run("ai-avatar", [audio(fixed(100))], { speechMode: "audio" })).toEqual(fixed(100))
    expect(run("ai-avatar", [audio(fixed(5000))], { speechMode: "audio" })).toEqual(fixed(AI_AVATAR_MAX_AUDIO_SEC))
    expect(run("ai-avatar", [audio(undefined)], { speechMode: "audio" })).toEqual(fixed(AI_AVATAR_MAX_AUDIO_SEC))
  })
})

describe("Motion Transfer: the driving video, at most the longest tier priced", () => {
  const ceiling = motionTransferCeilingSec()
  it("the ceiling is the top tier its credit id carries", () => {
    expect(Number.isFinite(ceiling)).toBe(true)
    expect(ceiling).toBe(30)
  })
  it("lists the video's length up to the ceiling", () => {
    expect(run("motion-transfer", [video(fixed(12))])).toEqual(fixed(12))
    expect(run("motion-transfer", [video(fixed(600))])).toEqual(fixed(ceiling))
    expect(run("motion-transfer", [video(episode)])).toEqual(fixed(ceiling))
  })
  it("an unknown video is the ceiling", () => {
    expect(run("motion-transfer", [])).toEqual(fixed(ceiling))
  })
})

describe("Extend Video: the input and what the extension adds", () => {
  it("LTX adds its own duration (default 6 s)", () => {
    expect(run("extend-video", [video(fixed(30))], { provider: "ltx-2.3-pro", duration: 10 })).toEqual(fixed(30 + ltxExtendDurationSec(10)))
    expect(run("extend-video", [video(fixed(30))], { provider: "ltx-2.3-pro" })).toEqual(fixed(30 + ltxExtendDurationSec(undefined)))
  })
  it("Seedance extend adds its duration, 8 s when unset, as its price counts it", () => {
    expect(run("extend-video", [video(fixed(30))], { provider: "seedance-2-extend", duration: 12 })).toEqual(fixed(42))
    expect(run("extend-video", [video(fixed(30))], { provider: "seedance-2-extend" })).toEqual(fixed(38))
    expect(run("extend-video", [video(episode)], { provider: "seedance-2-extend", duration: 4 })).toEqual({ fixedSec: 4, perEpisodeSec: 60 })
  })
  it("Seedance extend adds what the run generates: its duration snapped up to the model's 4-second floor", () => {
    expect(run("extend-video", [video(fixed(30))], { provider: "seedance-2-extend", duration: 2 })).toEqual(fixed(34))
    expect(run("extend-video", [video(fixed(30))], { provider: "seedance-2-extend", duration: 1.4 })).toEqual(fixed(34))
  })
  it("Seedance extend adds at most the model's window ceiling", () => {
    const ceiling = seedanceExtendDurationWindow(seedanceExtendGenerationModel()).max
    expect(run("extend-video", [video(fixed(30))], { provider: "seedance-2-extend", duration: ceiling + 5 })).toEqual(fixed(30 + ceiling))
  })
  it("VEO and Runway extend add a length the catalog does not declare: unknown", () => {
    expect(run("extend-video", [video(fixed(8))], { provider: "veo-extend" })).toBe("unknown")
    expect(run("extend-video", [video(fixed(8))], { provider: "runway-extend" })).toBe("unknown")
  })
})

describe("Video to Video", () => {
  it("is its input, or the 5 or 10 seconds it is set to render when longer", () => {
    expect(run("video-to-video", [video(fixed(30))], { provider: "wan" })).toEqual(fixed(30))
    expect(run("video-to-video", [video(fixed(3))], { provider: "kling-o1", v2vDuration: "10" })).toEqual(fixed(10))
    expect(run("video-to-video", [video(episode)], { provider: "wan" })).toEqual(episode)
  })
})

describe("Speed Ramp", () => {
  it("a constant speed divides the length, per minute included", () => {
    expect(run("speed-ramp", [video(fixed(60))], { speed: 2 })).toEqual(fixed(30))
    expect(run("speed-ramp", [video(episode)], { speed: 0.5 })).toEqual({ fixedSec: 0, perEpisodeSec: 120 })
  })
  it("never shorter than the input's when slowed, whatever the ramps", () => {
    expect(run("speed-ramp", [video(fixed(60))], { ramps: [{ start: 10, end: 20, speed: 0.5 }, { start: 30, end: 40, speed: 4 }] })).toEqual(fixed(70))
  })
  it("an unset speed keeps the length", () => {
    expect(run("speed-ramp", [video(fixed(60))])).toEqual(fixed(60))
  })
})

describe("Merge Video Audio", () => {
  it("is the video when the audio ends inside it", () => {
    expect(run("merge-video-audio", [wire("video", fixed(60), "in"), wire("audio", fixed(20), "in")])).toEqual(fixed(60))
  })
  it("ends with a track that starts late and runs past it", () => {
    const track = wire("audio", fixed(20), "in", "voice")
    expect(run("merge-video-audio", [wire("video", fixed(30), "in"), track], { trackSettings: { voice: { startTime: 25 } } })).toEqual(fixed(45))
  })
  it("an audio that left a dynamic step (carried as a video wire) is not taken for the video, and keeps its start offset", () => {
    const voice = wire("video", fixed(20), "in", "voice")
    const clip = wire("video", fixed(60), "in", "clip")
    for (const inputs of [[voice, clip], [clip, voice]]) {
      expect(run("merge-video-audio", inputs, { trackSettings: { voice: { startTime: 50 } } })).toEqual(fixed(70))
    }
  })
  it("an audio with no length before the run: unknown", () => {
    expect(run("merge-video-audio", [wire("video", fixed(30), "in"), wire("audio", undefined, "in")])).toBe("unknown")
  })
})

describe("Assemble Narrated Video: each block is its clip or its narration, the longer", () => {
  it("sums the blocks", () => {
    expect(run("assemble-narrated-video", [video(fixed(5)), audio(fixed(8)), video(fixed(6)), audio(fixed(3))])).toEqual(fixed(14))
  })
  it("a narration with no length before the run: unknown", () => {
    expect(run("assemble-narrated-video", [video(fixed(5)), audio(undefined)])).toBe("unknown")
  })
})

describe("Slideshow", () => {
  it("a wired audio is the total", () => {
    expect(run("slideshow", [audio(fixed(90))])).toEqual(fixed(90))
    expect(run("slideshow", [audio(episode)])).toEqual(episode)
    expect(run("slideshow", [audio(undefined)])).toBe("unknown")
  })
  it("with no audio: at most 100 images at the longest slot", () => {
    expect(run("slideshow", [], { perImageDuration: 4 })).toEqual(fixed(SLIDESHOW_MAX_IMAGES * 4))
    expect(run("slideshow", [], { perImageDuration: 2, imageDurations: [null, 7] })).toEqual(fixed(SLIDESHOW_MAX_IMAGES * 7))
    expect(run("slideshow", [])).toEqual(fixed(SLIDESHOW_MAX_IMAGES * 3))
  })
  it("the cap is the route's", () => {
    const route = readFileSync(join(__dirname, "..", "..", "routes", "slideshow.ts"), "utf8")
    expect(route).toMatch(new RegExp(`imageUrls: z\\.array\\([^\\n]*\\)\\.max\\(${SLIDESHOW_MAX_IMAGES}[,)]`))
  })
})

describe("3D Render Pro", () => {
  it("lists the render's own duration ceiling", () => {
    expect(run("pro-3d-render", [])).toEqual(fixed(PRO3D_RENDER_LIMITS.maxDurationSeconds))
  })
})

describe("Split into Chunks", () => {
  it("no chunk is longer than the chunk length", () => {
    expect(run("split-media", [wire("video", fixed(600), "in")], { chunkDuration: 30 })).toEqual(fixed(30))
    expect(run("split-media", [wire("video", fixed(10), "in")], { chunkDuration: 30 })).toEqual(fixed(10))
    expect(run("split-media", [wire("video", "unknown", "in")], { chunkDuration: 30 })).toEqual(fixed(30))
  })
})

describe("the four length-priced steps pass a length on", () => {
  it("Trim: a fixed window is the window, any other mode its input", () => {
    expect(run("trim-video", [wire("video", fixed(900), "in")], { trimMode: "time", startTime: 5, endTime: 25 })).toEqual(fixed(20))
    expect(run("trim-video", [wire("video", episode, "in")], { trimMode: "seconds", trimStartSeconds: 1 })).toEqual(episode)
    expect(run("trim-video", [wire("video", fixed(100), "in")], { trimMode: "keep-first-seconds", keepFirstSeconds: 30 })).toEqual(fixed(30))
  })
  it("Loop: its input times its copy count, or its target", () => {
    expect(run("loop-video", [wire("video", fixed(30), "in")], { mode: "repeat", repeatCount: 3 })).toEqual(fixed(90))
    expect(run("loop-video", [wire("video", fixed(30), "in")], { mode: "duration", targetDuration: 120 })).toEqual(fixed(120))
  })
  it("Combine Videos: the sum of its inputs, an unmeasured one at the fallback", () => {
    expect(run("combine-videos", [wire("video", fixed(10), "in"), wire("video", episode, "in")])).toEqual({ fixedSec: 10, perEpisodeSec: 60 })
    expect(run("combine-videos", [wire("video", fixed(10), "in"), wire("video", "unknown", "in")])).toEqual(fixed(10 + VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS))
  })
  it("Video SFX: its input's, at most 300 seconds; the episode or an unknown is the 300", () => {
    expect(run("video-sfx", [wire("video", fixed(40), "video")])).toEqual(fixed(40))
    expect(run("video-sfx", [wire("video", fixed(900), "video")])).toEqual(fixed(VIDEO_SFX_PRICING.MAX_DURATION_SEC))
    expect(run("video-sfx", [wire("video", episode, "video")])).toEqual(fixed(VIDEO_SFX_PRICING.MAX_DURATION_SEC))
    expect(run("video-sfx", [wire("video", "unknown", "video")])).toEqual(fixed(VIDEO_SFX_PRICING.MAX_DURATION_SEC))
  })
})
