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
 * The quote is the measured walk (`measuredWireLengthSec`, the one reading the
 * editor and the server share) through the step's units rule; the charge is
 * the route's (`videoUtilityUnits` over the measured lengths it reserves by).
 */
import { describe, expect, it } from "vitest"
import {
  LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC,
  MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC,
  MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC,
  MEASURED_INPUT_READING,
  measuredWireLengthSec,
  NEMOTRON_WIRE_READ_OPTIONS,
  VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC,
  VIDEO_OVERLAY_READING,
  type MeasuredFileReading,
  type MeasuredInputStepType,
  VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC,
  VIDEO_UTILITY_PRICE_GRACE_SEC,
  videoUtilityUnitsOf,
  type EstimateGraphEdge,
  type EstimateGraphNode,
} from "@nodaro/render-rules"
import { NEMOTRON_UPWARD_GRACE_SEC, nemotronHeldMinutes, nemotronTranscribeHeldCreditId, nemotronTranscribeQuoteCreditId, nemotronTranscribeStartedMinutes, videoSfxHeldCreditId, videoSfxQuoteCreditId } from "@nodaro/shared/credits"
import { nemotronChargeId } from "../nemotron-transcribe-settle.js"
import { videoUtilityUnits, withMeasuredInputLengths } from "../video-utility-credits.js"

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

/** Every measuring step's reading of the walk: its slack and what its run measures. */
const STEP_READS: ReadonlyArray<readonly [string, number, MeasuredFileReading]> = [
  ...(Object.keys(MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC) as MeasuredInputStepType[]).map((t) => [t, MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC[t], MEASURED_INPUT_READING[t]] as const),
  ["mask-composite", MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC, "container"],
  ["video-overlay", VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC, VIDEO_OVERLAY_READING],
  ["trim / loop / combine", VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC, "container"],
]

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

  it("the steps that measure the video stream are exactly the one-frame steps: Video Overlay and Video Upscale (Topaz, Nodaro)", () => {
    expect(VIDEO_OVERLAY_READING).toBe("video-stream")
    expect(MEASURED_INPUT_READING["video-upscale"]).toBe("video-stream")
    for (const [step, slack, reading] of STEP_READS) expect(reading === "video-stream", step).toBe(slack === VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC)
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

  it("Trim, Loop and Combine Videos after one: quote(planned) ≥ charge(planned + 0.25 s) at every planned length", () => {
    const short: string[] = []
    for (const [type, medium] of LONG_OVERSHOOT_PRODUCERS) {
      for (const sec of PLANNED_SECS) {
        const read = walk(producer(type, sec, medium), VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC)!
        const planned = plannedOf(type, sec)
        for (const step of Object.keys(STEPS) as Array<keyof typeof STEPS>) {
          const secs = step === "combine-videos" ? [read, read] : [read]
          if (videoUtilityUnitsOf(step, STEPS[step], secs)! < chargedUnits(step, planned + LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC)) short.push(`${type}/${medium} → ${step} @ ${planned}`)
        }
      }
    }
    expect(short).toEqual([])
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
