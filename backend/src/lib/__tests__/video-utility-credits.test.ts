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
})
