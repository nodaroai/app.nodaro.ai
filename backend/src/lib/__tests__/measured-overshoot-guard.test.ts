/**
 * The quote of a step whose run measures the clip it is given is never below
 * what that run charges for a clip that runs past its planned length by as much
 * as a made file was measured to (production, read-only measurement of
 * container lengths): swept across every 5-second mark.
 *
 * - Trim, Loop and Combine Videos: a clip made in the run is quoted at its
 *   planned length plus `VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC` (0.15 s), and
 *   the charge takes `VIDEO_UTILITY_PRICE_GRACE_SEC` (0.15 s) off what it
 *   measures, so a clip up to 0.15 s past its planned length is charged no
 *   more than its quote (a made clip's container was measured up to 0.104 s
 *   past the length it was asked for).
 * - After a PixVerse V6 extension made in the run, every measuring step reads
 *   the file at least a quarter second past its planned length
 *   (`LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC`: measured 0.145 s past its source
 *   plus the seconds it adds, its video stream 0.144 s). After a Dubbing or an
 *   Audio Isolation, every step that measures the CONTAINER does (a dub was
 *   measured up to 0.133 s past its input); the steps that measure the VIDEO
 *   STREAM (Video Overlay, Topaz and Nodaro Video Upscale) keep their own one
 *   frame, as a dub keeps its input's picture exactly. Voice Changer, Voice
 *   Changer Pro, Adjust Volume and Extract Audio keep the step's own slack. A
 *   step that reads with no slack (Nemotron only) adds none: its hold and its
 *   charge forgive a second.
 *
 * - Every measuring step (`MEASURING_STEP_ALLOWANCES`): its planned-clip
 *   slack, plus what its charge forgives past a mark, less what its quote
 *   forgives, covers how far a made file runs past its planned length on what
 *   its run measures (`MADE_CLIP_OVERSHOOT_SEC`: 0.15 s on the container, one
 *   24 fps frame on the video stream), on its own reading and on the one it
 *   falls back to. The table must name every step whose quote reads the
 *   measured walk, so a new step cannot reopen a window, and each step's real
 *   quote and charge rules are swept against it.
 *
 * The quote is the measured walk (`measuredWireLengthSec`, the one reading the
 * editor and the server share) through the step's units rule; the charge is
 * the route's (`videoUtilityUnits` over the measured lengths it reserves by).
 */
import { describe, expect, it } from "vitest"
import {
  AI_AVATAR_PLANNED_CLIP_SLACK_SEC,
  aiAvatarCreditIdOf,
  aiAvatarQuoteCreditId,
  dubbingHeldMinutes,
  dubbingQuotedMinutes,
  LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC,
  MADE_CLIP_OVERSHOOT_SEC,
  MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC,
  MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC,
  MEASURED_INPUT_READING,
  MEASURING_STEP_ALLOWANCES,
  measuredWireLengthSec,
  NEMOTRON_WIRE_READ_OPTIONS,
  nodaroVideoUpscaleBilledSec,
  nodaroVideoUpscaleEstimateUnits,
  nodaroVideoUpscaleUnits,
  CONTAINER_FALLBACK_GRACE_SEC,
  containerFallbackPricedSec,
  topazVideoHoldSourceSec,
  topazVideoHoldUnits,
  TOPAZ_VIDEO_CONTAINER_GRACE_SEC,
  VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC,
  VIDEO_OVERLAY_READING,
  VIDEO_UTILITY_READING,
  type MeasuredFileReading,
  type MeasuredInputStepType,
  type MeasuringStepId,
  type VideoUtilityStepType,
  VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC,
  VIDEO_UTILITY_PRICE_GRACE_SEC,
  videoUtilityUnitsOf,
  type EstimateGraphEdge,
  type EstimateGraphNode,
} from "@nodaro/render-rules"
import {
  lipSyncAudioRateOf,
  lipSyncEstimateSeconds,
  lipSyncHeldSeconds,
  NEMOTRON_UPWARD_GRACE_SEC,
  nemotronHeldMinutes,
  nemotronTranscribeHeldCreditId,
  nemotronTranscribeQuoteCreditId,
  nemotronTranscribeStartedMinutes,
  parseNemotronTranscribeCreditId,
  parsePitchTempoCreditId,
  pickLipSyncBucket,
  pitchTempoHeldCreditId,
  pitchTempoQuoteCreditId,
  videoOverlayVideoUnits,
  videoSfxHeldCreditId,
  videoSfxQuoteCreditId,
} from "@nodaro/shared/credits"
import { maskCompositeUnits, videoDepthCreditId, videoMaskCreditId } from "@nodaro/shared/media"
import { audioIsolationEstimateUnits, checkAudioIsolationLength, checkMotionTransferLength, motionTransferEstimateSeconds, checkVideoToVideoClipLength, videoToVideoEstimateSeconds, checkVoiceChangerLength, voiceChangerEstimateUnits } from "@nodaro/shared/credits"
import { lipSyncAudioPricingOf, lipSyncHeldSecondsOf } from "../lip-sync-inputs.js"
import { nemotronChargeId } from "../nemotron-transcribe-settle.js"
import { MEASURED_VIDEO_UTILITY_JOBS, videoUtilityClipReading, videoUtilityUnits, withMeasuredInputLengths } from "../video-utility-credits.js"

type N = EstimateGraphNode & { readonly type: string; readonly data?: Record<string, unknown> }
const upload = (id: string, sec: number): N => ({ id, type: "upload-video", data: { url: `https://cdn.example/${id}.mp4`, generatedResults: [{ url: `https://cdn.example/${id}.mp4`, duration: sec }], activeResultIndex: 0 } })
const wire = (source: string, target: string, targetHandle = "video"): EstimateGraphEdge => ({ source, target, targetHandle })

/** Planned lengths across the first six 5-second marks, a hundredth apart. */
const PLANNED_SECS = Array.from({ length: 3000 }, (_, i) => Math.round((0.5 + i * 0.01) * 100) / 100)

/** The longest a made clip's container was measured past its planned length (a Seedance 2 Mini clip). */
const MEASURED_MADE_CLIP_OVERSHOOT_SEC = 0.104

/**
 * A clip of `sec` seconds that a node makes in the run: an upload re-rendered by a provider step that keeps
 * its length (Face Swap), so the walk plans it at the upload's length plus the step's slack.
 */
function madeClip(id: string, sec: number): { nodes: N[]; edges: EstimateGraphEdge[] } {
  return { nodes: [upload(`${id}-src`, sec), { id, type: "face-swap", data: {} }], edges: [wire(`${id}-src`, id)] }
}

const STEPS = {
  "trim-video": { trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 },
  "loop-video": { mode: "repeat", repeatCount: 2 },
  "combine-videos": { transition: "cut", transitionDuration: 0.5, trimStartFrames: 1, trimEndFrames: 2 },
} as const

/** The units a quote names for the step on clips of `planned` seconds made in the run (one, or two for Combine Videos). */
function quotedUnits(type: keyof typeof STEPS, planned: number): number {
  const clips = type === "combine-videos" ? [madeClip("a", planned), madeClip("b", planned)] : [madeClip("a", planned)]
  const nodes = clips.flatMap((c) => c.nodes)
  const edges = clips.flatMap((c) => c.edges)
  const secs = ["a", "b"].slice(0, clips.length).map((id) => measuredWireLengthSec(id, nodes, edges, new Set(nodes.map((n) => n.id)), { plannedClipSlackSec: VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC }))
  return videoUtilityUnitsOf(type, STEPS[type], secs)!
}

/** The units the route charges the step on clips measured at `measured` seconds (no rate read: no frames cut). */
function chargedUnits(type: keyof typeof STEPS, measured: number): number {
  const secs = type === "combine-videos" ? [measured, measured] : [measured]
  const body = { ...STEPS[type], ...(type === "combine-videos" ? { videoUrls: secs.map(() => "https://cdn.example/x.mp4") } : { videoUrl: "https://cdn.example/x.mp4" }) }
  return videoUtilityUnits(type, withMeasuredInputLengths(type, body, secs))!
}

describe("Trim, Loop and Combine Videos: a clip made in the run is quoted at no less than its charge 0.15 s past its planned length", () => {
  it("the slack and the grace are 0.15 s, past the longest a made clip's container was measured over its length", () => {
    expect(VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC).toBe(0.15)
    expect(VIDEO_UTILITY_PRICE_GRACE_SEC).toBe(VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC)
    expect(VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC).toBeGreaterThan(MEASURED_MADE_CLIP_OVERSHOOT_SEC)
  })

  it.each(Object.keys(STEPS) as Array<keyof typeof STEPS>)("%s: quote(planned) ≥ charge(planned + 0.15 s) at every planned length", (type) => {
    const short: number[] = []
    for (const planned of PLANNED_SECS) {
      if (quotedUnits(type, planned) < chargedUnits(type, planned + 0.15)) short.push(planned)
    }
    expect(short).toEqual([])
  })

  it("the bound is tight: a clip run 0.16 s past a planned length on a mark is charged a unit more than its quote", () => {
    expect(quotedUnits("trim-video", 10)).toBe(2)
    expect(chargedUnits("trim-video", 10.15)).toBe(2)
    expect(chargedUnits("trim-video", 10.16)).toBe(3)
  })
})

/** The longest a dub (0.133 s past its input) and a PixVerse V6 extension (0.145 s past its source plus what it adds) were measured past their planned length. */
const MEASURED_LONG_OVERSHOOT_SEC = 0.145

const audioUpload = (id: string, sec: number): N => ({ id, type: "upload-audio", data: { url: `https://cdn.example/${id}.mp3`, metadata: { durationSeconds: sec } } })

/** A node of `type` made in the run from a recording of `sec` seconds (an Extend Video adds 5 s on PixVerse V6). */
function producer(type: string, sec: number, medium: "audio" | "video"): { nodes: N[]; edges: EstimateGraphEdge[] } {
  const src = medium === "audio" ? audioUpload("src", sec) : upload("src", sec)
  const data = type === "extend-video" ? { provider: "pixverse-v6-extend", duration: 5 } : {}
  return { nodes: [src, { id: "p", type, data }], edges: [wire("src", "p", medium)] }
}

const plannedOf = (type: string, sec: number) => (type === "extend-video" ? sec + 5 : sec)
const walk = (graph: { nodes: N[]; edges: EstimateGraphEdge[] }, slack: number, reading: MeasuredFileReading = "container") =>
  measuredWireLengthSec("p", graph.nodes, graph.edges, new Set(graph.nodes.map((n) => n.id)), { plannedClipSlackSec: slack, reading })

/** Every measuring step's reading of the walk: its slack and what its run measures (Nemotron, with no slack, apart). */
const STEP_READS: ReadonlyArray<readonly [string, number, MeasuredFileReading]> = (Object.keys(MEASURING_STEP_ALLOWANCES) as MeasuringStepId[])
  .filter((step) => step !== "nemotron")
  .map((step) => [step, MEASURING_STEP_ALLOWANCES[step].plannedClipSlackSec, MEASURING_STEP_ALLOWANCES[step].reading] as const)

/** The producers whose file runs a quarter second past, and on which readings: a dub's sound only, a PixVerse V6 extension's picture too. */
const LONG_OVERSHOOT_PRODUCERS: ReadonlyArray<readonly [string, "audio" | "video", ReadonlySet<MeasuredFileReading>]> = [
  ["dubbing", "audio", new Set(["container"])],
  ["dubbing", "video", new Set(["container"])],
  ["audio-isolation", "audio", new Set(["container"])],
  ["extend-video", "video", new Set(["container", "video-stream"])],
]

describe("after a Dubbing, an Audio Isolation or a PixVerse V6 extension, a measuring step reads a quarter second past the planned length where the file runs past it", () => {
  it("a quarter second, past the longest either was measured over its planned length", () => {
    expect(LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC).toBe(0.25)
    expect(LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC).toBeGreaterThan(MEASURED_LONG_OVERSHOOT_SEC)
  })

  it("the steps that measure the video stream: Video Overlay and Video Upscale (Topaz, Nodaro) with their one frame, and Combine Videos with its 0.15 s", () => {
    expect(VIDEO_OVERLAY_READING).toBe("video-stream")
    expect(MEASURED_INPUT_READING["video-upscale"]).toBe("video-stream")
    expect(VIDEO_UTILITY_READING["combine-videos"]).toBe("video-stream")
    const stream = STEP_READS.filter(([, , reading]) => reading === "video-stream")
    expect(stream.map(([step]) => step).sort()).toEqual(["combine-videos", "video-overlay", "video-upscale:nodaro", "video-upscale:topaz"])
    for (const [step, slack] of stream) expect(slack, step).toBe(step === "combine-videos" ? VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC : VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC)
  })

  it.each(LONG_OVERSHOOT_PRODUCERS)("%s of a %s recording: planned + 0.25 s on every step that measures what runs past, its own slack on the rest, at every length", (type, medium, past) => {
    const wrong: string[] = []
    for (const [step, slack, reading] of STEP_READS) {
      for (const sec of PLANNED_SECS.filter((_, i) => i % 7 === 0)) {
        const read = walk(producer(type, sec, medium), slack, reading)
        const want = plannedOf(type, sec) + (past.has(reading) ? LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC : slack)
        if (read === undefined || Math.abs(read - want) > 1e-9) wrong.push(`${step} (${reading}) @ ${sec}: ${read}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it("Trim, Loop and Combine Videos after one: quote(planned) ≥ charge(planned + what runs past on the step's reading) at every planned length", () => {
    const short: string[] = []
    for (const [type, medium, past] of LONG_OVERSHOOT_PRODUCERS) {
      for (const sec of PLANNED_SECS) {
        const planned = plannedOf(type, sec)
        for (const step of Object.keys(STEPS) as Array<keyof typeof STEPS>) {
          const reading = VIDEO_UTILITY_READING[step]
          const read = walk(producer(type, sec, medium), VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC, reading)!
          const over = past.has(reading) ? LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC : MADE_CLIP_OVERSHOOT_SEC[reading]
          const secs = step === "combine-videos" ? [read, read] : [read]
          if (videoUtilityUnitsOf(step, STEPS[step], secs)! < chargedUnits(step, planned + over)) short.push(`${type}/${medium} → ${step} @ ${planned}`)
        }
      }
    }
    expect(short).toEqual([])
  })

  it("a Combine Videos after a Dubbing keeps its own allowance (it measures the video stream, which a dub keeps); Trim and Loop read the quarter second", () => {
    const dub = producer("dubbing", 10, "video")
    expect(walk(dub, VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC, VIDEO_UTILITY_READING["combine-videos"])).toBeCloseTo(10 + VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC, 9)
    expect(walk(dub, VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC, VIDEO_UTILITY_READING["trim-video"])).toBeCloseTo(10 + LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC, 9)
    expect(walk(dub, VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC, VIDEO_UTILITY_READING["loop-video"])).toBeCloseTo(10 + LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC, 9)
    // After a PixVerse V6 extension, whose picture runs further too, Combine keeps the quarter second.
    expect(walk(producer("extend-video", 10, "video"), VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC, "video-stream")).toBeCloseTo(15 + LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC, 9)
  })

  it("a bucketed step after one: Video SFX's quoted row at the walk is never below the row it holds a file 0.25 s past the planned length at", () => {
    const rowSec = (id: string) => Number(/:(\d+)s$/.exec(id)![1])
    const short: string[] = []
    for (const [type, medium] of LONG_OVERSHOOT_PRODUCERS) {
      for (const sec of PLANNED_SECS.filter((s) => s <= 25)) {
        const read = walk(producer(type, sec, medium), MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC["video-sfx"], MEASURED_INPUT_READING["video-sfx"])!
        const planned = plannedOf(type, sec)
        if (rowSec(videoSfxQuoteCreditId(read)) < rowSec(videoSfxHeldCreditId(planned + LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC))) short.push(`${type}/${medium} @ ${planned}`)
      }
    }
    expect(short).toEqual([])
  })

  it("every other extend model, and Voice Changer, Voice Changer Pro, Adjust Volume and Extract Audio, keep the step's own slack", () => {
    for (const [, slack, reading] of STEP_READS) {
      for (const type of ["voice-changer", "voice-changer-pro", "adjust-volume", "extract-audio"]) {
        const medium = type === "extract-audio" ? "video" : "audio"
        expect(walk(producer(type, 10, medium), slack, reading), `${type} @ ${slack}`).toBeCloseTo(10 + slack, 9)
      }
      const seedance = { nodes: [upload("src", 10), { id: "p", type: "extend-video", data: { provider: "seedance-2-5-extend", duration: 5 } }], edges: [wire("src", "p")] }
      expect(walk(seedance, slack, reading)).toBeCloseTo(15 + slack, 9)
    }
  })

  it("the zero-slack rule is Nemotron's only: every other measuring step reads with a slack above 0", () => {
    expect(NEMOTRON_WIRE_READ_OPTIONS.plannedClipSlackSec).toBe(0)
    for (const [step, slack] of STEP_READS) expect(slack, step).toBeGreaterThan(0)
  })

  it("Transcribe and Add Captions on Nemotron add none after a Dubbing, as their hold and their charge forgive more than a quarter second: quote(planned) ≥ hold and charge (planned + 0.25 s)", () => {
    expect(NEMOTRON_UPWARD_GRACE_SEC).toBeGreaterThanOrEqual(LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC)
    const minutes = (id: string) => Number(/:(\d+)m$/.exec(id)![1])
    const short: string[] = []
    for (const sec of Array.from({ length: 2000 }, (_, i) => Math.round((50 + i * 0.01) * 100) / 100)) {
      const read = walk(producer("dubbing", sec, "audio"), 0)!
      expect(read).toBe(sec)
      const quoted = minutes(nemotronTranscribeQuoteCreditId(read))
      expect(quoted).toBe(nemotronTranscribeStartedMinutes(read))
      const measured = sec + LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC
      const held = nemotronTranscribeHeldCreditId(measured)
      if (quoted < nemotronHeldMinutes(measured)) short.push(`hold @ ${sec}`)
      // The charge reads the provider's own length; at the probed length (the worst it can be inside the second the charge forgives).
      if (quoted < minutes(nemotronChargeId(held, measured))) short.push(`charge @ ${sec}`)
    }
    expect(short).toEqual([])
  })
})

/**
 * A window a decision is still open on: the guard finds it, and lists it here
 * until the decision lands (then its step's rule moves and the entry goes).
 * None is open: Topaz's container fallback, the last one, now holds the
 * container's frames less the 0.15 s a made clip's audio can carry past its
 * planned length (`TOPAZ_VIDEO_CONTAINER_GRACE_SEC`), as Nodaro Video Upscale's does.
 */
const AWAITING_DECISION: ReadonlySet<string> = new Set()

/** One reading a step's run measures by: its own, or the one it falls back to. */
interface StepReading { readonly name: string; readonly step: MeasuringStepId; readonly reading: MeasuredFileReading; readonly chargeGraceSec: number }

const STEP_READINGS: readonly StepReading[] = (Object.keys(MEASURING_STEP_ALLOWANCES) as MeasuringStepId[]).flatMap((step) => {
  const a = MEASURING_STEP_ALLOWANCES[step]
  const own: StepReading = { name: step, step, reading: a.reading, chargeGraceSec: a.chargeGraceSec }
  return a.fallback ? [own, { name: `${step} (${a.fallback.reading} fallback)`, step, reading: a.fallback.reading, chargeGraceSec: a.fallback.chargeGraceSec }] : [own]
})

/** How far a made file runs past its planned length on `reading` (float noise forgiven). */
const covers = (step: MeasuringStepId, r: StepReading) => {
  const a = MEASURING_STEP_ALLOWANCES[step]
  return a.plannedClipSlackSec + r.chargeGraceSec - a.quoteGraceSec >= MADE_CLIP_OVERSHOOT_SEC[r.reading] - 1e-9
}

describe("every measuring step's declared allowances cover a made file's overshoot: slack + charge grace − quote grace ≥ the overshoot on what its run measures", () => {
  it("the overshoot: 0.15 s on the container (a made clip measured up to 0.104 s past), one 24 fps frame on the video stream", () => {
    expect(MADE_CLIP_OVERSHOOT_SEC.container).toBe(0.15)
    expect(MADE_CLIP_OVERSHOOT_SEC.container).toBeGreaterThan(MEASURED_MADE_CLIP_OVERSHOOT_SEC)
    expect(MADE_CLIP_OVERSHOOT_SEC["video-stream"]).toBeCloseTo(1 / 24, 12)
  })

  it("the table has a row for every step of the registries that read the measured walk (and the walk is read with a slack only through a row: measured-walk-callers.test.ts)", () => {
    const steps = new Set(Object.keys(MEASURING_STEP_ALLOWANCES))
    for (const t of Object.keys(MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC) as MeasuredInputStepType[]) {
      if (t === "video-upscale") expect([...steps].filter((s) => s.startsWith("video-upscale:")).sort()).toEqual(["video-upscale:nodaro", "video-upscale:topaz"])
      else if (t === "video-to-video") expect([...steps].filter((s) => s.startsWith("video-to-video:")).sort()).toEqual(["video-to-video:happyhorse-edit", "video-to-video:wan-videoedit"])
      else expect(steps.has(t), t).toBe(true)
    }
    for (const t of MEASURED_VIDEO_UTILITY_JOBS) expect(steps.has(t), t).toBe(true)
  })

  it("every row whose run reads the video stream declares the container fallback that run falls back to, with its grace", () => {
    for (const step of Object.keys(MEASURING_STEP_ALLOWANCES) as MeasuringStepId[]) {
      const a = MEASURING_STEP_ALLOWANCES[step]
      if (a.reading !== "video-stream") continue
      expect(a.fallback?.reading, step).toBe("container")
      expect(a.fallback!.chargeGraceSec - a.chargeGraceSec, step).toBeCloseTo(CONTAINER_FALLBACK_GRACE_SEC, 12)
    }
  })

  it("each step's slack and reading are the ones its quote passes the walk, and Trim / Loop / Combine Videos read as their runs measure", () => {
    for (const t of Object.keys(MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC) as MeasuredInputStepType[]) {
      const ids = t === "video-upscale" ? ["video-upscale:topaz", "video-upscale:nodaro"] : t === "video-to-video" ? ["video-to-video:happyhorse-edit", "video-to-video:wan-videoedit"] : [t]
      for (const id of ids as MeasuringStepId[]) {
        expect(MEASURING_STEP_ALLOWANCES[id].plannedClipSlackSec, id).toBe(MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC[t])
        expect(MEASURING_STEP_ALLOWANCES[id].reading, id).toBe(MEASURED_INPUT_READING[t])
      }
    }
    expect(MEASURING_STEP_ALLOWANCES["mask-composite"].plannedClipSlackSec).toBe(MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC)
    expect(MEASURING_STEP_ALLOWANCES["video-overlay"].plannedClipSlackSec).toBe(VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC)
    expect(MEASURING_STEP_ALLOWANCES.nemotron.plannedClipSlackSec).toBe(NEMOTRON_WIRE_READ_OPTIONS.plannedClipSlackSec)
    expect(MEASURING_STEP_ALLOWANCES["ai-avatar"].plannedClipSlackSec).toBe(AI_AVATAR_PLANNED_CLIP_SLACK_SEC)
    expect([...MEASURED_VIDEO_UTILITY_JOBS].sort()).toEqual(Object.keys(VIDEO_UTILITY_READING).sort())
    for (const t of MEASURED_VIDEO_UTILITY_JOBS) {
      expect(MEASURING_STEP_ALLOWANCES[t as VideoUtilityStepType].reading, t).toBe(videoUtilityClipReading(t))
      expect(MEASURING_STEP_ALLOWANCES[t as VideoUtilityStepType].plannedClipSlackSec, t).toBe(VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC)
    }
  })

  it("the bound holds on every reading but the ones awaiting a decision", () => {
    const open = STEP_READINGS.filter((r) => !covers(r.step, r)).map((r) => r.name)
    expect(open.sort()).toEqual([...AWAITING_DECISION].sort())
  })

  it("no step's quote forgives more than its charge: a producer's longer overshoot, read in place of the slack, is covered too", () => {
    for (const step of Object.keys(MEASURING_STEP_ALLOWANCES) as MeasuringStepId[]) {
      const a = MEASURING_STEP_ALLOWANCES[step]
      expect(a.chargeGraceSec, step).toBeGreaterThanOrEqual(a.quoteGraceSec)
      if (a.fallback) expect(a.fallback.chargeGraceSec, step).toBeGreaterThanOrEqual(a.quoteGraceSec)
    }
  })
})

/** The rank of a step's price for a length (a row's index, minutes, seconds, units): larger is dearer. */
type PriceRank = (sec: number) => number

const SFX_ROWS = ["replicate-mmaudio:8s", "replicate-mmaudio:15s", "replicate-mmaudio:30s", "replicate-mmaudio:60s", "replicate-mmaudio:120s", "replicate-mmaudio:300s"]
const OMNI = lipSyncAudioRateOf("omnihuman-2-0")!
const KLING_AVATAR = lipSyncAudioPricingOf("kling-avatar")!
const decoded = (seconds: number) => ({ overCap: false as const, samples: Math.round(seconds * 48_000), seconds })
const rowSecOf = (id: string) => Number(/:(\d+)s$/.exec(id)![1])
const TOPAZ_1080P_30: Omit<Parameters<typeof topazVideoHoldUnits>[0], "durationSec"> = { resolution: "1080p", fps: 30 }

/**
 * Each step's real quote and charge rules over a length (on the reading named;
 * a step charged two ways is swept on each): the quote reads the walk's
 * length, the charge a file at the planned length plus the overshoot.
 */
const SWEPT: ReadonlyArray<{ readonly name: string; readonly step: MeasuringStepId; readonly reading: MeasuredFileReading; readonly maxSec: number; readonly quote: PriceRank; readonly charge: PriceRank }> = [
  { name: "Video SFX", step: "video-sfx", reading: "container", maxSec: 300, quote: (s) => SFX_ROWS.indexOf(videoSfxQuoteCreditId(s)), charge: (s) => SFX_ROWS.indexOf(videoSfxHeldCreditId(s)) },
  { name: "Video Mask", step: "video-mask", reading: "container", maxSec: 300, quote: (s) => rowSecOf(videoMaskCreditId(s)), charge: (s) => rowSecOf(videoMaskCreditId(s)) },
  { name: "Video Depth", step: "video-depth", reading: "container", maxSec: 300, quote: (s) => rowSecOf(videoDepthCreditId("video-depth-anything", s)), charge: (s) => rowSecOf(videoDepthCreditId("video-depth-anything", s)) },
  { name: "Pitch & Tempo", step: "pitch-tempo", reading: "container", maxSec: 1800, quote: (s) => parsePitchTempoCreditId(pitchTempoQuoteCreditId(s))!.minutes, charge: (s) => parsePitchTempoCreditId(pitchTempoHeldCreditId(s))!.minutes },
  { name: "Dubbing", step: "dubbing", reading: "container", maxSec: 1800, quote: (s) => dubbingQuotedMinutes({}, s), charge: (s) => dubbingHeldMinutes(s) },
  { name: "Lip Sync, a length tier (Kling Avatar)", step: "lip-sync", reading: "container", maxSec: 300, quote: (s) => pickLipSyncBucket(s), charge: (s) => lipSyncHeldSecondsOf(KLING_AVATAR, decoded(s))! },
  { name: "Lip Sync, OmniHuman 2.0's seconds", step: "lip-sync", reading: "container", maxSec: OMNI.maxSeconds, quote: (s) => lipSyncEstimateSeconds(OMNI, s), charge: (s) => lipSyncHeldSeconds(OMNI, s) },
  // Motion Transfer's driving video (Kling following the video's orientation: its 30 s limit), its billed seconds.
  { name: "Motion Transfer, its billed seconds", step: "motion-transfer", reading: "container", maxSec: 30, quote: (s) => motionTransferEstimateSeconds("kling-3.0", "video", s), charge: (s) => { const r = checkMotionTransferLength("kling-3.0", "video", s); return r.ok ? r.billedSeconds : 0 } },
  // Video to Video's clip, its billed seconds: HappyHorse Edit's started half-seconds (as a count), Wan 2.7 VideoEdit's whole seconds.
  { name: "Video to Video, HappyHorse Edit's half-seconds", step: "video-to-video:happyhorse-edit", reading: "container", maxSec: 60, quote: (s) => 2 * videoToVideoEstimateSeconds("happyhorse-edit", undefined, s), charge: (s) => { const r = checkVideoToVideoClipLength("happyhorse-edit", s); return r.ok ? 2 * r.billedSeconds : 0 } },
  { name: "Video to Video, Wan 2.7 VideoEdit's seconds", step: "video-to-video:wan-videoedit", reading: "container", maxSec: 10, quote: (s) => videoToVideoEstimateSeconds("wan-videoedit", "0", s), charge: (s) => { const r = checkVideoToVideoClipLength("wan-videoedit", s, "0"); return r.ok ? r.billedSeconds : 0 } },
  // Audio Isolation's audio (its 30-minute cap), its started ten seconds.
  { name: "Audio Isolation, its started ten seconds", step: "audio-isolation", reading: "container", maxSec: 1800, quote: (s) => audioIsolationEstimateUnits(s), charge: (s) => { const r = checkAudioIsolationLength(s); return r.ok ? r.units : 0 } },
  // Voice Changer's audio (a video's sound; its 5-minute cap), its started ten seconds.
  { name: "Voice Changer, its started ten seconds", step: "voice-changer", reading: "container", maxSec: 300, quote: (s) => voiceChangerEstimateUnits(s), charge: (s) => { const r = checkVoiceChangerLength(s); return r.ok ? r.units : 0 } },
  { name: "Mask Composite", step: "mask-composite", reading: "container", maxSec: 300, quote: (s) => maskCompositeUnits(s), charge: (s) => maskCompositeUnits(s) },
  { name: "Video Overlay", step: "video-overlay", reading: "video-stream", maxSec: 60, quote: (s) => videoOverlayVideoUnits(s), charge: (s) => videoOverlayVideoUnits(s) },
  { name: "Topaz Video Upscale, the stream", step: "video-upscale:topaz", reading: "video-stream", maxSec: 60, quote: (s) => topazVideoHoldUnits({ ...TOPAZ_1080P_30, durationSec: s }), charge: (s) => topazVideoHoldUnits({ ...TOPAZ_1080P_30, durationSec: s }) },
  { name: "Topaz Video Upscale, the container fallback", step: "video-upscale:topaz", reading: "container", maxSec: 60, quote: (s) => topazVideoHoldUnits({ ...TOPAZ_1080P_30, durationSec: s }), charge: (s) => topazVideoHoldUnits({ ...TOPAZ_1080P_30, durationSec: topazVideoHoldSourceSec(s, "container") }) },
  { name: "Nodaro Video Upscale, the stream", step: "video-upscale:nodaro", reading: "video-stream", maxSec: 60, quote: (s) => nodaroVideoUpscaleEstimateUnits(s), charge: (s) => nodaroVideoUpscaleUnits(nodaroVideoUpscaleBilledSec(s, "video-stream")) },
  { name: "Video Overlay, the container fallback", step: "video-overlay", reading: "container", maxSec: 60, quote: (s) => videoOverlayVideoUnits(s), charge: (s) => videoOverlayVideoUnits(containerFallbackPricedSec(s, "container")) },
  { name: "Combine Videos (two clips), the stream", step: "combine-videos", reading: "video-stream", maxSec: 300, quote: (s) => videoUtilityUnitsOf("combine-videos", STEPS["combine-videos"], [s, s])!, charge: (s) => chargedUnits("combine-videos", s) },
  { name: "Combine Videos (two clips), the container fallback", step: "combine-videos", reading: "container", maxSec: 300, quote: (s) => videoUtilityUnitsOf("combine-videos", STEPS["combine-videos"], [s, s])!, charge: (s) => chargedUnits("combine-videos", containerFallbackPricedSec(s, "container")) },
  { name: "Nodaro Video Upscale, the container fallback", step: "video-upscale:nodaro", reading: "container", maxSec: 60, quote: (s) => nodaroVideoUpscaleEstimateUnits(s), charge: (s) => nodaroVideoUpscaleUnits(nodaroVideoUpscaleBilledSec(s, "container")) },
  { name: "AI Avatar in audio mode (its duration buckets)", step: "ai-avatar", reading: "container", maxSec: 600, quote: (s) => rowSecOf(aiAvatarQuoteCreditId({ speechMode: "audio" }, s)), charge: (s) => rowSecOf(aiAvatarCreditIdOf({ speechMode: "audio" }, Math.ceil(s))) },
  { name: "Nemotron 3.5 Transcribe", step: "nemotron", reading: "container", maxSec: 3600, quote: (s) => parseNemotronTranscribeCreditId(nemotronTranscribeQuoteCreditId(s))!.minutes, charge: (s) => parseNemotronTranscribeCreditId(nemotronTranscribeHeldCreditId(s))!.minutes },
]

describe("each step's real quote and charge rules, swept: quote(the walk at its planned length) ≥ charge(planned + the overshoot on what it measures)", () => {
  it.each(SWEPT)("$name", ({ step, reading, maxSec, quote, charge }) => {
    const { plannedClipSlackSec } = MEASURING_STEP_ALLOWANCES[step]
    const short: number[] = []
    for (const planned of [...PLANNED_SECS, 59.5, 59.9, 59.95, 119.9, 299.85, 299.9].filter((p) => p + MADE_CLIP_OVERSHOOT_SEC[reading] <= maxSec)) {
      // The quote reads a clip made in the run (a Face Swap of an upload), with the step's slack.
      const read = measuredWireLengthSec("a", madeClip("a", planned).nodes, madeClip("a", planned).edges, new Set(["a-src", "a"]), { plannedClipSlackSec, reading: MEASURING_STEP_ALLOWANCES[step].reading })!
      if (quote(read) < charge(planned + MADE_CLIP_OVERSHOOT_SEC[reading])) short.push(planned)
    }
    expect(short).toEqual([])
  })

  it("Combine Videos on its container fallback after a Dubbing (whose file runs a quarter second past its input): quote(planned) ≥ charge(container − its allowance)", () => {
    const short: number[] = []
    for (const sec of PLANNED_SECS) {
      const read = walk(producer("dubbing", sec, "video"), VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC, "video-stream")!
      const quoted = videoUtilityUnitsOf("combine-videos", STEPS["combine-videos"], [read, read])!
      if (quoted < chargedUnits("combine-videos", containerFallbackPricedSec(sec + LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC, "container"))) short.push(sec)
    }
    expect(short).toEqual([])
  })

  it("the container fallbacks need their grace: without it, Topaz on a container 0.15 s past a planned length could hold more than its quote, and Nodaro bill more", () => {
    const { plannedClipSlackSec } = MEASURING_STEP_ALLOWANCES["video-upscale:topaz"]
    const hold = (s: number) => topazVideoHoldUnits({ ...TOPAZ_1080P_30, durationSec: s })
    expect(PLANNED_SECS.filter((p) => hold(p + plannedClipSlackSec) < hold(p + MADE_CLIP_OVERSHOOT_SEC.container)).length).toBeGreaterThan(0)
    expect(TOPAZ_VIDEO_CONTAINER_GRACE_SEC).toBe(MADE_CLIP_OVERSHOOT_SEC.container)
    expect(topazVideoHoldSourceSec(5.1, "container")).toBeCloseTo(4.95, 9)
    expect(topazVideoHoldSourceSec(5.1, "video-stream")).toBe(5.1)
    expect(topazVideoHoldSourceSec(0.1, "container")).toBe(0)
  })

  it("the steps whose slack moved to 0.15 s would break at the old 0.1 s: Mask Composite, Video Mask, Video Depth", () => {
    const at = (planned: number, slack: number) => measuredWireLengthSec("a", madeClip("a", planned).nodes, madeClip("a", planned).edges, new Set(["a-src", "a"]), { plannedClipSlackSec: slack })!
    // 9.92 s: the walk read 10.02 s at a tenth (priced as 10 s), the file can run to 10.07 s (11 s).
    expect(maskCompositeUnits(at(9.92, 0.1))).toBeLessThan(maskCompositeUnits(9.92 + MADE_CLIP_OVERSHOOT_SEC.container))
    expect(maskCompositeUnits(at(9.92, MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC))).toBe(maskCompositeUnits(9.92 + MADE_CLIP_OVERSHOOT_SEC.container))
    expect(rowSecOf(videoMaskCreditId(at(9.92, 0.1)))).toBeLessThan(rowSecOf(videoMaskCreditId(9.92 + MADE_CLIP_OVERSHOOT_SEC.container)))
    expect(rowSecOf(videoDepthCreditId("video-depth-anything", at(9.92, 0.1)))).toBeLessThan(rowSecOf(videoDepthCreditId("video-depth-anything", 9.92 + MADE_CLIP_OVERSHOOT_SEC.container)))
  })
})
