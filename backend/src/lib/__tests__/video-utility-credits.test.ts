/**
 * Trim / Loop / Combine / Assemble Narrated Video are priced per unit of what
 * they make. A run is charged in two places — the single-node route and the
 * workflow run — and quoted in two more (the editor and the server's workflow
 * estimate). These pin that they all read one mapping, and the worked examples
 * the node docs quote.
 */
import { describe, expect, it } from "vitest"
import { VIDEO_UTIL_PRICING } from "@nodaro/shared/credits"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"
import { buildPayload } from "../../services/workflow-engine/payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../../services/workflow-engine/types.js"
import {
  assembleNarratedVideoUnits,
  combineVideosUnits,
  loopVideoUnits,
  trimVideoUnits,
  videoUtilityUnits,
  videoUtilityEstimateBody,
} from "../video-utility-credits.js"

const clip = (name: string) => `https://cdn.nodaro.ai/videos/${name}.mp4`

const UTILITY_TYPES = ["trim-video", "loop-video", "combine-videos", "assemble-narrated-video"] as const

/** Credits for `units` at the type's static one-unit row (the rows the worked examples are written at). */
const atRow = (type: string, units: number) => STATIC_CREDIT_COSTS[type]! * units

/** The workflow run's payload for a node, as the orchestrator builds it. */
function workflowPayload(type: string, data: Record<string, unknown>, inputs: Partial<ResolvedInputs>): Record<string, unknown> {
  const node = { id: "n1", type, data } as SimpleNode
  return buildPayload(node, "job-1", inputs as ResolvedInputs).payload
}

describe("each node's own price row is one unit", () => {
  // An estimate quotes the row × the units, so the row must be exactly one.
  it.each(UTILITY_TYPES)("%s", (type) => {
    expect(STATIC_CREDIT_COSTS[type]).toBe(VIDEO_UTIL_PRICING.CREDIT_UNIT)
  })
})

describe("the workflow run counts the units the single-node route charges", () => {
  it("Trim Video: 0–60 s is 12 units, 120 credits", () => {
    const route = trimVideoUnits({ trimMode: "time", startTime: 0, endTime: 60 })
    const workflow = videoUtilityUnits(
      "trim-video",
      workflowPayload("trim-video", { trimMode: "time", startTime: 0, endTime: 60 }, { videoUrl: clip("v"), videoDuration: 90 }),
    )
    expect(route).toBe(12)
    expect(atRow("trim-video", route)).toBe(120)
    expect(workflow).toBe(route)
  })

  it("Trim Video with no end (the node's default end of 0): from its start to the clip's end on both", () => {
    // A 12 s clip from 2 s: 12 − 0.15 − 2 = 9.85 s → 2 units.
    const route = trimVideoUnits({ startTime: 2, upstreamDuration: 12 })
    const workflow = videoUtilityUnits(
      "trim-video",
      { ...workflowPayload("trim-video", { startTime: 2, endTime: 0 }, { videoUrl: clip("v") }), upstreamDuration: 12 },
    )
    expect(route).toBe(2)
    expect(workflow).toBe(route)
  })

  it("Loop Video: three repeats of a 10 s clip is 6 units, 60 credits", () => {
    const route = loopVideoUnits({ mode: "repeat", repeatCount: 3, upstreamDuration: 10 })
    const workflow = videoUtilityUnits(
      "loop-video",
      workflowPayload("loop-video", { mode: "repeat", repeatCount: 3 }, { videoUrl: clip("v"), videoDuration: 10 }),
    )
    expect(route).toBe(6)
    expect(atRow("loop-video", route)).toBe(60)
    expect(workflow).toBe(route)
  })

  it("Combine Videos: three 10 s clips, cut, no trims is 6 + 1 units, 70 credits", () => {
    const route = combineVideosUnits({
      transition: "cut",
      trimStartFrames: 0,
      trimEndFrames: 0,
      videoUrls: [clip("a"), clip("b"), clip("c")],
      upstreamDurations: [10, 10, 10],
    })
    const workflow = videoUtilityUnits(
      "combine-videos",
      workflowPayload(
        "combine-videos",
        { transition: "cut", trimStartFrames: 0, trimEndFrames: 0 },
        {
          videoUrls: [clip("a"), clip("b"), clip("c")],
          videoUrlsWithSourceIds: [
            { url: clip("a"), nodeId: "s1", duration: 10 },
            { url: clip("b"), nodeId: "s2", duration: 10 },
            { url: clip("c"), nodeId: "s3", duration: 10 },
          ],
        } as Partial<ResolvedInputs>,
      ),
    )
    expect(route).toBe(7)
    expect(atRow("combine-videos", route)).toBe(70)
    expect(workflow).toBe(route)
  })

  it("Assemble Narrated Video: 7 blocks is 3 + 2 units, 50 credits", () => {
    const blocks = Array.from({ length: 7 }, (_, i) => ({ videoUrl: clip(`v${i}`) }))
    const route = assembleNarratedVideoUnits({ blocks })
    const workflow = videoUtilityUnits(
      "assemble-narrated-video",
      workflowPayload("assemble-narrated-video", {}, { videoUrls: blocks.map((b) => b.videoUrl) }),
    )
    expect(route).toBe(5)
    expect(atRow("assemble-narrated-video", route)).toBe(50)
    expect(workflow).toBe(route)
  })

  it("prices nothing else", () => {
    expect(videoUtilityUnits("generate-image", {})).toBeUndefined()
  })
})

describe("the server's workflow estimate", () => {
  it("counts the clips and blocks the wires bring, with the run's own defaults", () => {
    const edges = [
      { target: "c", targetHandle: "videos" },
      { target: "c", targetHandle: "videos" },
      { target: "a", targetHandle: "video" },
      { target: "a", targetHandle: "audio" },
      { target: "other", targetHandle: "video" },
    ]
    const combine = videoUtilityEstimateBody({ id: "c", type: "combine-videos", data: {} }, edges)
    // Two clips at the 8 s fallback, the run's default 1 + 2 frame trims: 15.75 s → 4 units.
    expect(videoUtilityUnits("combine-videos", combine!)).toBe(4)
    const assemble = videoUtilityEstimateBody({ id: "a", type: "assemble-narrated-video", data: {} }, edges)
    expect(videoUtilityUnits("assemble-narrated-video", assemble!)).toBe(4)
    expect(videoUtilityEstimateBody({ id: "g", type: "generate-image", data: {} }, edges)).toBeUndefined()
  })

  it("prices a Trim over the fields its run sends: the node's mode only, an end of 0 open", () => {
    const trim = (data: Record<string, unknown>) => videoUtilityUnits("trim-video", { ...videoUtilityEstimateBody({ id: "t", type: "trim-video", data })!, upstreamDuration: 30 })
    // The default node (end 0): 30 − 0.15 s → 6 units, not the one-unit floor of an empty window.
    expect(trim({ startTime: 0, endTime: 0 })).toBe(6)
    expect(trim({ startTime: 0, endTime: 12 })).toBe(3)
    // Keep the last 4 s with a stale frames setting from an earlier mode: the run sends only the keep field.
    expect(trim({ trimMode: "keep-last-seconds", keepLastSeconds: 4, trimEndFrames: 24 })).toBe(1)
    // Smart loop cut: the run sends the flag the node's mode names.
    expect(trim({ trimMode: "smart-loop-cut" })).toBe(6 + 1)
  })
})

describe("frame trims at the clip's real frame rate (decided 2026-11-14; the docs' worked examples)", () => {
  it("Trim: 24 + 24 frames off a 10 s clip at 24 fps is ~8 s, 2 units; 60 frames off a 12 s clip is 2 units at 24 fps, 3 at 60", () => {
    expect(trimVideoUnits({ trimStartFrames: 24, trimEndFrames: 24, upstreamDuration: 10 }, [24])).toBe(2)
    expect(trimVideoUnits({ trimEndFrames: 60, upstreamDuration: 12 }, [24])).toBe(2)
    expect(trimVideoUnits({ trimEndFrames: 60, upstreamDuration: 12 }, [60])).toBe(3)
  })

  it("Trim: a rate that is not known cuts no frames (the uncut clip)", () => {
    expect(trimVideoUnits({ trimEndFrames: 60, upstreamDuration: 12 })).toBe(3)
    expect(trimVideoUnits({ trimEndFrames: 60, upstreamDuration: 12 }, [undefined])).toBe(3)
  })

  const fiveClips = (fps: number | undefined) =>
    combineVideosUnits(
      { videoUrls: ["a", "b", "c", "d", "e"], upstreamDurations: [8, 8, 8, 8, 8], transition: "dissolve", transitionDuration: 0.5, trimStartFrames: 24, trimEndFrames: 24 },
      fps === undefined ? [] : [fps, fps, fps, fps, fps],
    )

  // The trims come off at the 4 joins only (decided 2026-11-14, "charge what is cut"):
  // 40 s less the grace on each clip (39.25 s), − 2 s of dissolves, − 4 × 2 s at 24 fps = 29.25 s; − 4 × 0.8 s at 60 fps = 34.05 s.
  it("Combine: 5 clips × 8 s, dissolve 0.5 s, 24 + 24 frames at each join — 6 base units + 3 at 24 fps, 7 + 3 at 60 fps", () => {
    expect(fiveClips(24)).toBe(9)
    expect(fiveClips(60)).toBe(10)
  })

  it("Combine: the trims are cut at the one rate the join conforms its clips to (most clips' rate, a tie to the higher)", () => {
    // Two clips meet once: 60 frames off the first one's end, 60 off the second one's start.
    const two = (rates: number[]) => combineVideosUnits({ videoUrls: ["a", "b"], upstreamDurations: [10, 10], trimStartFrames: 60, trimEndFrames: 60 }, rates)
    expect(two([24, 24])).toBe(3) // 19.8 − 120 / 24 = 14.8 s
    expect(two([24, 60])).toBe(two([60, 60])) // a tie: 60 fps, 17.8 s
    expect(two([60, 60])).toBe(4)
  })

  it("Combine: only the joins are trimmed — never the first clip's start or the last clip's end (decided 2026-11-14)", () => {
    const clips = (n: number) =>
      combineVideosUnits({ videoUrls: Array.from({ length: n }, (_, i) => `c${i}`), upstreamDurations: Array(n).fill(5), trimStartFrames: 12, trimEndFrames: 12 }, Array(n).fill(24))
    // 2 clips: 9.8 s less one join of 1 s = 8.8 s, 2 units.
    expect(clips(2)).toBe(2)
    // 5 clips: 24.5 s less 4 joins of 1 s = 20.5 s, 5 units + 3 inputs (all 5 clips' trims, 19.5 s, would be 4 + 3).
    expect(clips(5)).toBe(8)
    // A single clip has no join: nothing is trimmed.
    expect(combineVideosUnits({ videoUrls: ["a"], upstreamDurations: [10], trimStartFrames: 60, trimEndFrames: 60 }, [24])).toBe(2)
  })

  it("Combine: a clip whose rate is not known leaves the join's rate unknown — no frames cut", () => {
    expect(combineVideosUnits({ videoUrls: ["a", "b"], upstreamDurations: [10, 10], trimStartFrames: 60, trimEndFrames: 60 }, [24, undefined])).toBe(4)
  })
})

describe("Combine Videos: each join takes off what it renders (decided 2026-11-14, \"charge what is cut\")", () => {
  // Two 10.5 s clips, priced 10.4 s each (20.8 s): a 1 s fade at the join is 19.8 s, 4 units; a cut there, 5.
  const two = (fields: Record<string, unknown>) => combineVideosUnits({ videoUrls: ["a", "b"], upstreamDurations: [10.5, 10.5], ...fields })

  it("a join's own transition replaces the global one there", () => {
    expect(two({ transition: "fade", transitionDuration: 1 })).toBe(4)
    expect(two({ transition: "fade", transitionDuration: 1, transitions: [{ index: 0, transition: "cut", duration: 0 }] })).toBe(5)
    expect(two({ transition: "fade", transitionDuration: 1, transitions: [{ index: 0, transition: "fade", duration: 0 }] })).toBe(5)
    expect(two({ transition: "cut", transitions: [{ index: 0, transition: "fade", duration: 1 }] })).toBe(4)
  })

  it("an entry for a join that does not exist is ignored, and a later entry for the same join wins", () => {
    expect(two({ transition: "fade", transitionDuration: 1, transitions: [{ index: 1, transition: "cut", duration: 0 }] })).toBe(4)
    expect(two({ transition: "cut", transitions: [{ index: 0, transition: "fade", duration: 1 }, { index: 0, transition: "cut", duration: 0 }] })).toBe(5)
  })

  it("the Combine page's worked examples: 3 clips (12 s, 12 s, 7.5 s), a 1 s fade, no frame trims — 6 + 1 units; both joins set to a cut — 7 + 1", () => {
    const three = (extra: Record<string, unknown>) =>
      combineVideosUnits({ videoUrls: ["a", "b", "c"], upstreamDurations: [12, 12, 7.5], transition: "fade", transitionDuration: 1, trimStartFrames: 0, trimEndFrames: 0, ...extra })
    // 11.9 + 11.9 + 7.4 − 2 × 1 = 29.2 s: 6 units + 1 input (77 credits on the page).
    expect(three({})).toBe(7)
    // 31.2 s: 7 units + 1 input (88 credits).
    expect(three({ transitions: [{ index: 0, transition: "cut", duration: 0 }, { index: 1, transition: "cut", duration: 0 }] })).toBe(8)
  })

  it("a join overlaps at most 90 % of the shortest clip, as the render clamps it", () => {
    // 10.4 + 10.4 + 0.9 s = 21.7 s; two 2 s fades clamped to 0.81 s each: 20.08 s, 5 units + 1 input (unclamped, 17.7 s: 4 + 1).
    expect(combineVideosUnits({ videoUrls: ["a", "b", "c"], upstreamDurations: [10.5, 10.5, 1], transition: "fade", transitionDuration: 2 })).toBe(6)
  })

  it("Smart cut is priced at the fixed trims: they are found during the render", () => {
    const fields = { videoUrls: ["a", "b"], upstreamDurations: [10, 10], trimStartFrames: 60, trimEndFrames: 60 }
    expect(combineVideosUnits({ ...fields, smartCutEnabled: true }, [24, 24])).toBe(combineVideosUnits(fields, [24, 24]))
  })
})
