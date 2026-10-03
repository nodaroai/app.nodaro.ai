/**
 * How long a video the nodes after a Video URL can read — what the part
 * chooser and the run's "choose a part" message quote.
 */
import { describe, it, expect } from "vitest"
import { VIDEO_ANALYSIS_DURATION_BUCKETS, VIDEO_ANALYSIS_MAX_DURATION_SEC } from "@nodaro/shared"
import { VIDEO_LENGTH_LIMITS, videoLinkLengthLimit } from "../video-link-length-limits"
import { validateRange } from "../video-link"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data }) as unknown as WorkflowNode
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target }) as unknown as WorkflowEdge

describe("videoLinkLengthLimit", () => {
  it("quotes the consumers' own published limits", () => {
    expect(VIDEO_LENGTH_LIMITS["video-analysis"]).toEqual({
      maxSec: VIDEO_ANALYSIS_MAX_DURATION_SEC,
      cheapestSec: VIDEO_ANALYSIS_DURATION_BUCKETS[0],
    })
    expect(VIDEO_LENGTH_LIMITS["video-audit"]).toEqual(VIDEO_LENGTH_LIMITS["video-analysis"])
  })

  it("is the limit of the node the link feeds", () => {
    const nodes = [node("v", "youtube-video"), node("va", "video-analysis"), node("r", "content-recipe")]
    const edges = [edge("v", "va"), edge("v", "r")]
    expect(videoLinkLengthLimit("v", nodes, edges)).toEqual({ maxSec: 600, cheapestSec: 60, consumerType: "video-analysis" })
  })

  it("is null when nothing after it limits length", () => {
    const nodes = [node("v", "youtube-video"), node("r", "content-recipe"), node("t", "trim-video")]
    expect(videoLinkLengthLimit("v", nodes, [edge("v", "r"), edge("v", "t")])).toBeNull()
  })

  it("ignores a skipped consumer and another link's consumer", () => {
    const nodes = [node("v", "youtube-video"), node("w", "youtube-video"), node("va", "video-analysis", { skipped: true }), node("vb", "video-analysis")]
    expect(videoLinkLengthLimit("v", nodes, [edge("v", "va"), edge("w", "vb")])).toBeNull()
  })
})

describe("validateRange — the longest part the next node reads", () => {
  it("refuses a part longer than the limit, and accepts one that fits", () => {
    expect(validateRange("0:00", "12:00", 1159, 600)).toEqual({ ok: false, reason: "tooLong" })
    expect(validateRange("2:00", "12:00", 1159, 600)).toEqual({ ok: true, startSec: 120, endSec: 720 })
    expect(validateRange("0:00", "12:00", 1159)).toEqual({ ok: true, startSec: 0, endSec: 720 })
  })
})
