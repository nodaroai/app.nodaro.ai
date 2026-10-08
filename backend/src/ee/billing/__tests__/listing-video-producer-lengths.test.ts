/**
 * A listing prices a length-priced step (Trim, Loop, Combine Videos, Video SFX)
 * on the output of ANY video producer by the length that producer passes on
 * (decided 2026-10-07): the "never quotes less" promise holds everywhere but a
 * video whose length is not known before the run. These guards run the real
 * listing over a chain `recording -> producer -> step`, against the charge of
 * the same step at the length the producer delivers (`videoUtilityBaseCredits`,
 * the Video SFX row), at `STATIC_CREDIT_COSTS`' base prices.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { AI_AVATAR_MAX_AUDIO_SEC, VIDEO_SFX_PRICING, VIDEO_UTIL_PRICING, getLipSyncMaxAudioSeconds, videoSfxCreditId } from "@nodaro/shared"
import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"
import { videoUtilityBaseCredits } from "../../../lib/video-utility-credits.js"
import { NODE_HANDLES } from "../../../lib/mcp/generated/node-handles.js"
import {
  DYNAMIC_VIDEO_OUTPUT_TYPES,
  PASS_THROUGH_VIDEO_TYPES,
  UNBOUNDED_LENGTH_REASONS,
  VIDEO_OUTPUT_LENGTH_RULES,
  motionTransferCeilingSec,
} from "../../../lib/video-output-length.js"
import { generateVideoProLengthSec } from "../../../lib/generate-video-pro-length.js"

type N = { id: string; type: string; data?: Record<string, unknown> }
type E = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

const rec: N = { id: "rec", type: "upload-video", data: {} }
const combine: N = { id: "op", type: "combine-videos", data: { trimStartFrames: 0, trimEndFrames: 0 } }
const sfx: N = { id: "op", type: "video-sfx", data: {} }
const MINUTES = [1, 2, 7, 45, 180]
const maxRow = STATIC_CREDIT_COSTS[videoSfxCreditId(VIDEO_SFX_PRICING.MAX_DURATION_SEC)]!

const listingOf = (nodes: N[], edges: E[], replaced = ["rec"]) =>
  CreditsService.estimateWorkflowBaseListing(nodes, edges, "app", { replaceableMediaNodeIds: new Set(replaced) })
const at = (l: { preview: number; previewPerMinute: number }, minutes: number) => l.preview + l.previewPerMinute * minutes
const combineCharge = (durations: Array<number | undefined>) =>
  videoUtilityBaseCredits("combine-videos", { transition: "cut", transitionDuration: 0.5, trimStartFrames: 0, trimEndFrames: 0, videoUrls: durations.map(() => ""), upstreamDurations: durations })!

/** The listing of `graph` plus the step `op` wired from `from`, less the listing of `graph` alone. */
function stepDelta(graph: N[], wires: E[], op: N, from: string, replaced = ["rec"]) {
  const handle = op.type === "video-sfx" ? "video" : "in"
  const withOp = listingOf([...graph, op], [...wires, { source: from, target: op.id, targetHandle: handle }], replaced)
  const without = listingOf(graph, wires, replaced)
  return { fixed: withOp.preview - without.preview, perMinute: withOp.previewPerMinute - without.previewPerMinute, at: (m: number) => at(withOp, m) - at(without, m) }
}

const firstInput = (type: string) => NODE_HANDLES[type]?.inputs[0] ?? "in"

describe("a step that keeps its video whole is transparent to the listing", () => {
  it.each(PASS_THROUGH_VIDEO_TYPES)("%s: rec -> %s -> Combine Videos lists as rec -> Combine Videos", (type) => {
    const direct = stepDelta([rec], [], combine, "rec")
    const step: N = { id: "step", type, data: {} }
    const chained = stepDelta([rec, step], [{ source: "rec", target: "step", targetHandle: firstInput(type) }], combine, "step")
    expect(chained.perMinute, type).toBe(direct.perMinute)
    expect(chained.fixed, type).toBe(direct.fixed)
    for (const m of MINUTES) expect(chained.at(m), `${type} @ ${m} min`).toBeGreaterThanOrEqual(combineCharge([m * 60]))
  })

  it("and a Video SFX after it lists the fixed 300-second row", () => {
    const step: N = { id: "step", type: "resize-video", data: {} }
    const d = stepDelta([rec, step], [{ source: "rec", target: "step", targetHandle: "in" }], sfx, "step")
    expect(d.perMinute).toBe(0)
    expect(d.fixed).toBe(maxRow)
  })
})

describe("steps with a length of their own", () => {
  const chain = (step: N, wires: E[], op: N, replaced = ["rec"]) => stepDelta([rec, step], wires, op, "step", replaced)
  const recTo = (handle: string): E => ({ source: "rec", target: "step", targetHandle: handle })

  it("Speed Ramp at 0.5x: twice the recording, per minute, never below the charge", () => {
    const d = chain({ id: "step", type: "speed-ramp", data: { speed: 0.5 } }, [recTo("video")], combine)
    for (const m of MINUTES) expect(d.at(m), `${m} min`).toBeGreaterThanOrEqual(combineCharge([2 * m * 60]))
  })

  it("Speed Ramp at 4x: a quarter of it", () => {
    const d = chain({ id: "step", type: "speed-ramp", data: { speed: 4 } }, [recTo("video")], combine)
    for (const m of MINUTES) {
      expect(d.at(m), `${m} min`).toBeGreaterThanOrEqual(combineCharge([(m * 60) / 4]))
      expect(d.at(m), `${m} min`).toBeLessThanOrEqual(combineCharge([m * 60]))
    }
  })

  it("Extend Video (Seedance) on the recording: the recording plus its duration, per minute", () => {
    const d = chain({ id: "step", type: "extend-video", data: { provider: "seedance-2-extend", duration: 12 } }, [recTo("video")], combine)
    for (const m of MINUTES) expect(d.at(m), `${m} min`).toBeGreaterThanOrEqual(combineCharge([m * 60 + 12]))
  })

  it("Extend Video (VEO): no declared length, so the fallback, as before", () => {
    const d = chain({ id: "step", type: "extend-video", data: { provider: "veo-extend" } }, [recTo("video")], combine)
    expect(d.perMinute).toBe(0)
    expect(d.fixed).toBe(combineCharge([undefined]))
  })

  it("Generate Video Pro at 40 seconds: the stitched clip's length, fixed", () => {
    const step: N = { id: "step", type: "generate-video-pro", data: { provider: "seedance-2", duration: 40 } }
    const d = stepDelta([step], [], combine, "step", [])
    expect(d.perMinute).toBe(0)
    expect(d.fixed).toBe(combineCharge([generateVideoProLengthSec("seedance-2", 40)]))
  })

  it("Generate Video Pro with a Duration wired into its settings: the wired length, as the run generates it", () => {
    const step: N = { id: "step", type: "generate-video-pro", data: { provider: "seedance-2" } }
    const dur: N = { id: "dur", type: "duration", data: { seconds: 60 } }
    const d = stepDelta([step, dur], [{ source: "dur", target: "step", targetHandle: "settings" }], combine, "step", [])
    expect(d.perMinute).toBe(0)
    expect(d.fixed).toBe(combineCharge([generateVideoProLengthSec("seedance-2", 60)]))
  })

  it("Generate Video with a Duration wired into its settings: the wired length", () => {
    const step: N = { id: "step", type: "generate-video", data: { provider: "seedance-2" } }
    const dur: N = { id: "dur", type: "duration", data: { seconds: 15 } }
    const wired = stepDelta([step, dur], [{ source: "dur", target: "step", targetHandle: "settings" }], combine, "step", [])
    const set = stepDelta([{ ...step, data: { provider: "seedance-2", duration: 15 } }], [], combine, "step", [])
    expect(wired.fixed).toBe(set.fixed)
  })

  it("Lip Sync with a generated audio passed through Adjust Volume: still the provider's cap, not the 8-second fallback", () => {
    const tts: N = { id: "voice", type: "text-to-speech", data: { text: "hello" } }
    const vol: N = { id: "vol", type: "adjust-volume", data: {} }
    const step: N = { id: "step", type: "lip-sync", data: { provider: "kling-avatar" } }
    const d = stepDelta(
      [tts, vol, step],
      [
        { source: "voice", target: "vol", targetHandle: "in" },
        { source: "vol", target: "step", targetHandle: "audio" },
      ],
      combine,
      "step",
      [],
    )
    expect(d.perMinute).toBe(0)
    expect(d.fixed).toBe(combineCharge([getLipSyncMaxAudioSeconds("kling-avatar")]))
  })

  it("Cinematic Avatar on auto duration: its 15-second ceiling", () => {
    const step: N = { id: "step", type: "cinematic-avatar", data: { autoDuration: true } }
    expect(stepDelta([step], [], combine, "step", []).fixed).toBe(combineCharge([15]))
  })

  it("Lip Sync on a generated audio: the provider's own cap, fixed", () => {
    const tts: N = { id: "voice", type: "text-to-speech", data: { text: "hello" } }
    const step: N = { id: "step", type: "lip-sync", data: { provider: "kling-avatar" } }
    const d = stepDelta([tts, step], [{ source: "voice", target: "step", targetHandle: "audio" }], combine, "step", [])
    expect(d.perMinute).toBe(0)
    expect(d.fixed).toBe(combineCharge([getLipSyncMaxAudioSeconds("kling-avatar")]))
  })

  it("Lip Sync on the episode's audio: at the cap (the run trims to it), fixed", () => {
    const audio: N = { id: "rec", type: "upload-audio", data: {} }
    const step: N = { id: "step", type: "lip-sync", data: { provider: "kling-avatar" } }
    const d = stepDelta([audio, step], [{ source: "rec", target: "step", targetHandle: "audio" }], combine, "step")
    expect(d.perMinute).toBe(0)
    expect(d.fixed).toBe(combineCharge([300]))
  })

  it("AI Avatar on an audio: the audio, at most 600 seconds", () => {
    const audio: N = { id: "rec", type: "upload-audio", data: {} }
    const step: N = { id: "step", type: "ai-avatar", data: { speechMode: "audio" } }
    const d = stepDelta([audio, step], [{ source: "rec", target: "step", targetHandle: "audio" }], combine, "step")
    expect(d.fixed).toBe(combineCharge([AI_AVATAR_MAX_AUDIO_SEC]))
  })

  it("Motion Transfer: the driving video, at most the longest tier priced", () => {
    const d = chain({ id: "step", type: "motion-transfer", data: {} }, [recTo("video")], combine)
    expect(d.perMinute).toBe(0)
    expect(d.fixed).toBe(combineCharge([motionTransferCeilingSec()]))
  })

  it("Merge Video Audio keeps the video's length when its audio is a recording", () => {
    const voice: N = { id: "voice", type: "upload-audio", data: { duration: 10 } }
    const step: N = { id: "step", type: "merge-video-audio", data: {} }
    const d = stepDelta(
      [rec, voice, step],
      [{ source: "rec", target: "step", targetHandle: "in" }, { source: "voice", target: "step", targetHandle: "in" }],
      combine,
      "step",
    )
    for (const m of MINUTES) expect(d.at(m), `${m} min`).toBeGreaterThanOrEqual(combineCharge([m * 60]))
  })

  it("a length that carries on: rec -> Resize -> Speed Ramp 0.5x -> Trim -> Combine", () => {
    const resize: N = { id: "resize", type: "resize-video", data: {} }
    const ramp: N = { id: "step", type: "speed-ramp", data: { speed: 0.5 } }
    const trim: N = { id: "trim", type: "trim-video", data: { trimMode: "seconds", trimStartSeconds: 0 } }
    const graph = [rec, resize, ramp, trim]
    const wires: E[] = [
      { source: "rec", target: "resize", targetHandle: "in" },
      { source: "resize", target: "step", targetHandle: "video" },
      { source: "step", target: "trim", targetHandle: "in" },
    ]
    const d = stepDelta(graph, wires, combine, "trim")
    for (const m of MINUTES) expect(d.at(m), `${m} min`).toBeGreaterThanOrEqual(combineCharge([2 * m * 60]))
  })
})

describe("a render lists the length of its EDL: Speaker View as Apply EDL", () => {
  const RENDERS = ["apply-edl", "speaker-view"] as const
  const edlOf = (minutes: number) => ({ version: 1, segments: [{ sourceId: "a", inMs: 0, outMs: minutes * 60_000 }] })

  it.each(RENDERS)("%s with an inline 3-minute EDL: a step after it is never listed below the charge at 3 minutes", (type) => {
    const render: N = { id: "step", type, data: { edl: edlOf(3) } }
    const d = stepDelta([render], [], combine, "step", [])
    expect(d.at(0), type).toBeGreaterThanOrEqual(combineCharge([180]))
    expect(d.perMinute, type).toBe(0)
  })

  it("Speaker View lists the same step charge as Apply EDL on an inline EDL", () => {
    const inline = (type: string) => stepDelta([{ id: "step", type, data: { edl: edlOf(7) } }], [], combine, "step", [])
    expect(inline("speaker-view").fixed).toBe(inline("apply-edl").fixed)
    expect(inline("speaker-view").perMinute).toBe(inline("apply-edl").perMinute)
    expect(inline("speaker-view").fixed).toBeGreaterThanOrEqual(combineCharge([7 * 60]))
  })

  // The per-minute episode rule: an Edit Plan on the episode recording wired
  // into the render's `edl`, then a length-priced step after the render.
  it.each(["trim", "combine"] as const)("Speaker View lists the same %s charge as Apply EDL on an Edit Plan wired from the episode recording", (which) => {
    const op: N = which === "combine" ? combine : { id: "op", type: "trim-video", data: { trimMode: "seconds", trimStartSeconds: 1 } }
    const after = (type: (typeof RENDERS)[number]) => {
      const graph: N[] = [rec, { id: "plan", type: "edit-plan", data: { mode: "tighten", planTier: "standard" } }, { id: "step", type, data: {} }]
      const wires: E[] = [
        { source: "rec", target: "plan", sourceHandle: "video", targetHandle: "sources" },
        { source: "plan", target: "step", sourceHandle: "edl", targetHandle: "edl" },
      ]
      const out = type === "speaker-view" ? "video" : "media"
      const withOp = listingOf([...graph, op], [...wires, { source: "step", target: "op", sourceHandle: out, targetHandle: "in" }])
      const without = listingOf(graph, wires)
      return { fixed: withOp.preview - without.preview, perMinute: withOp.previewPerMinute - without.previewPerMinute }
    }
    const speaker = after("speaker-view")
    expect(speaker.perMinute).toBeGreaterThan(0)
    expect(speaker).toEqual(after("apply-edl"))
  })

  it("Video SFX after Speaker View lists no lower than after Apply EDL (a render is capped like any other)", () => {
    const after = (type: string) => stepDelta([{ id: "step", type, data: { edl: edlOf(2) } }], [], sfx, "step", [])
    expect(after("speaker-view").fixed).toBe(after("apply-edl").fixed)
  })
})

describe("a producer whose length the listing cannot bound lists at the run's own stand-in", () => {
  it("Video SFX on it: the 300-second row, the most a run accepts", () => {
    for (const type of ["gif-to-video", "render-video", "manual-edit", "suno-music-video"]) {
      const step: N = { id: "step", type, data: {} }
      const d = stepDelta([step], [], sfx, "step", [])
      expect(d.fixed, type).toBe(maxRow)
      expect(d.perMinute, type).toBe(0)
    }
  })

  it("Combine Videos on it: the estimators' fallback length", () => {
    for (const type of ["gif-to-video", "render-video", "manual-edit", "suno-music-video"]) {
      const step: N = { id: "step", type, data: {} }
      expect(stepDelta([step], [], combine, "step", []).fixed, type).toBe(combineCharge([VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS]))
    }
  })

  it("the intro card stays unknown through a pass-through step (the documented exception)", () => {
    const card: N = { id: "card", type: "upload-video", data: { duration: 8 } }
    const step: N = { id: "step", type: "resize-video", data: {} }
    const nodes: N[] = [rec, card, { id: "stt", type: "transcribe", data: { provider: "elevenlabs-stt" } }, step]
    const edges: E[] = [
      { source: "rec", target: "stt", targetHandle: "audio" },
      { source: "card", target: "step", targetHandle: "in" },
    ]
    const withOp = CreditsService.estimateWorkflowBaseListing([...nodes, sfx], [...edges, { source: "step", target: "op", targetHandle: "video" }], "template")
    const without = CreditsService.estimateWorkflowBaseListing(nodes, edges, "template")
    expect(withOp.preview - without.preview).toBe(maxRow)
  })
})

// Every producer with a rule, run through the real listing: no throw, and a
// step after it is never listed below the charge at the estimators' fallback.
describe("every video producer with a rule lists a step after it", () => {
  const types = Object.keys(VIDEO_OUTPUT_LENGTH_RULES).filter((t) => VIDEO_OUTPUT_LENGTH_RULES[t]!.via === "rule" && !["list", "sub-workflow", "reduce"].includes(t))
  it.each(types)("%s", (type) => {
    const step: N = { id: "step", type, data: {} }
    const wires: E[] = [{ source: "rec", target: "step", targetHandle: firstInput(type) }]
    const d = stepDelta([rec, step], wires, combine, "step")
    expect(Number.isFinite(d.fixed), type).toBe(true)
    for (const m of [1, 60]) expect(d.at(m), `${type} @ ${m} min`).toBeGreaterThanOrEqual(combineCharge([VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS]))
  })
})

describe("the docs name the unbounded producers, and no longer Resize Video or Lip Sync", () => {
  const DOCS = join(__dirname, "..", "..", "..", "..", "..", "docs")
  const read = (rel: string) => readFileSync(join(DOCS, rel), "utf8").replace(/\s+/g, " ")
  it.each(["nodes/processing-video/apply-edl.md", "app-view-modes.md", "deployment.md", "nodes/ai-video/video-sfx.md"])("%s", (rel) => {
    const text = read(rel)
    expect(text, rel).toMatch(/no length before the run|not known before the run/)
    expect(text, rel).not.toMatch(/such as Resize Video or Lip Sync/)
    expect(text, rel).not.toMatch(/whose length the listing does not follow/)
  })

  it("the sentences name every kind of unbounded producer the registry declares", () => {
    expect(Object.keys(UNBOUNDED_LENGTH_REASONS).length).toBeGreaterThan(0)
    expect(DYNAMIC_VIDEO_OUTPUT_TYPES.length).toBeGreaterThan(0)
    for (const rel of ["app-view-modes.md", "deployment.md", "nodes/processing-video/apply-edl.md"]) {
      const text = read(rel)
      for (const word of ["YouTube", "GIF to Video", "Render Video", "Manual Edit", "VEO or Runway", "Suno music video", "list or sub-workflow"]) {
        expect(text, `${rel}: ${word}`).toContain(word)
      }
    }
  })
})
