// @test-units-by-name estimates only video-audit nodes
/**
 * The video-audit credit estimate — and, more importantly, the invariant that
 * the THREE surfaces which quote it can never disagree:
 *
 *   1. the node badge          (video-audit-node.tsx → buildVideoAuditCreditId)
 *   2. the canvas / run total  (getModelIdentifier → live model-cost row)
 *   3. the cold-cache fallback (estimateNodeCredits → VIDEO_AUDIT_BUCKET_CREDITS)
 *
 * All three read ONE rule (`videoAuditAnalysisWired`) for the credit FAMILY and
 * the node's url-bound `probedVideo` for the duration bucket. A disagreement
 * here is a real defect: the badge quotes one number, the run-confirm dialog
 * gates on another, and the job bills a third.
 *
 * Numbers are read from `VIDEO_AUDIT_BUCKET_CREDITS` (the published output of
 * the private pricing formula), never hand-typed — a reprice must not need a
 * test edit, only a table swap.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/ee/hooks/use-model-credits", () => ({
  getCachedCredits: vi.fn(),
}))

import { getCachedCredits } from "@/ee/hooks/use-model-credits"
import { VIDEO_AUDIT_BUCKET_CREDITS, buildVideoAuditCreditId } from "@nodaro/shared/credits"
import { estimateNodeCredits, videoAuditAnalysisWired, NODE_CREDIT_COSTS } from "../types"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const AUDIT_ID = "aud"

function auditNode(data: Record<string, unknown> = {}) {
  return { id: AUDIT_ID, type: "video-audit", data: { label: "AI Audit", ...data } }
}

/** An edge feeding the audit's `analysis` target — the wired-family signal. */
const ANALYSIS_EDGE = [{ source: "va", target: AUDIT_ID, targetHandle: "analysis" }]
/** A video edge into the SAME node — must not be mistaken for an analysis. */
const VIDEO_EDGE = [{ source: "up", target: AUDIT_ID, targetHandle: "video" }]

describe("videoAuditAnalysisWired", () => {
  it("is true only for an edge into this node's `analysis` target", () => {
    expect(videoAuditAnalysisWired(AUDIT_ID, ANALYSIS_EDGE)).toBe(true)
    expect(videoAuditAnalysisWired(AUDIT_ID, VIDEO_EDGE)).toBe(false)
    expect(videoAuditAnalysisWired(AUDIT_ID, [])).toBe(false)
    // An analysis edge into a DIFFERENT node never prices this one.
    expect(videoAuditAnalysisWired("other", ANALYSIS_EDGE)).toBe(false)
  })

  it("falls back to the pricier auto family without graph context (never under-quote)", () => {
    expect(videoAuditAnalysisWired(AUDIT_ID, undefined)).toBe(false)
    expect(videoAuditAnalysisWired(undefined, ANALYSIS_EDGE)).toBe(false)
  })
})

describe("estimateNodeCredits — video-audit", () => {
  beforeEach(() => {
    vi.mocked(getCachedCredits).mockReturnValue(undefined)
  })

  it("wired analysis + probed duration → the re-audit family at that bucket", () => {
    expect(
      estimateNodeCredits(auditNode({ probedVideo: { url: "https://r2/c.mp4", durationSec: 72 } }), ANALYSIS_EDGE),
    ).toBe(VIDEO_AUDIT_BUCKET_CREDITS["video-audit:180s"])
  })

  it("no analysis wired → the auto family at the same bucket (strictly pricier)", () => {
    const withAnalysis = estimateNodeCredits(
      auditNode({ probedVideo: { url: "https://r2/c.mp4", durationSec: 72 } }),
      ANALYSIS_EDGE,
    )
    const auto = estimateNodeCredits(
      auditNode({ probedVideo: { url: "https://r2/c.mp4", durationSec: 72 } }),
      VIDEO_EDGE,
    )
    expect(auto).toBe(VIDEO_AUDIT_BUCKET_CREDITS["video-audit:auto:180s"])
    expect(auto).toBeGreaterThan(withAnalysis)
  })

  it("unknown duration → that family's 600s ceiling, never the bare-id fallback", () => {
    expect(estimateNodeCredits(auditNode(), ANALYSIS_EDGE)).toBe(VIDEO_AUDIT_BUCKET_CREDITS["video-audit:600s"])
    expect(estimateNodeCredits(auditNode(), [])).toBe(VIDEO_AUDIT_BUCKET_CREDITS["video-audit:auto:600s"])
  })

  it("no graph context at all → the table-wide ceiling (over-quote, never under)", () => {
    const noCtx = estimateNodeCredits(auditNode())
    expect(noCtx).toBe(Math.max(...Object.values(VIDEO_AUDIT_BUCKET_CREDITS)))
    // Never the flat NODE_CREDIT_COSTS floor: that key mirrors the bare
    // `video-audit` catalog id (the re-audit family's ceiling), which would
    // UNDER-quote an auto-family run. The branch must always resolve a bucketed
    // composite, so the floor stays unreachable here.
    expect(noCtx).not.toBe(NODE_CREDIT_COSTS["video-audit"])
    expect(NODE_CREDIT_COSTS["video-audit"]).toBe(VIDEO_AUDIT_BUCKET_CREDITS["video-audit:600s"])
  })

  it("prices every bucket × family straight off the shared table", () => {
    for (const [durationSec, bucket] of [[45, 60], [72, 180], [300, 360], [9999, 600]] as const) {
      for (const wired of [true, false]) {
        expect(
          estimateNodeCredits(
            auditNode({ probedVideo: { url: "https://r2/c.mp4", durationSec } }),
            wired ? ANALYSIS_EDGE : [],
          ),
        ).toBe(VIDEO_AUDIT_BUCKET_CREDITS[`video-audit${wired ? "" : ":auto"}:${bucket}s`])
      }
    }
  })
})

describe("getModelIdentifier — video-audit (the live-cost path)", () => {
  it("requests the SAME composite id the node badge does", () => {
    const node = auditNode({ probedVideo: { url: "https://r2/c.mp4", durationSec: 72 } }) as unknown as WorkflowNode
    expect(getModelIdentifier(node, ANALYSIS_EDGE as unknown as WorkflowEdge[])).toBe(
      buildVideoAuditCreditId({ analysisProvided: true, durationSec: 72 }),
    )
    expect(getModelIdentifier(node, VIDEO_EDGE as unknown as WorkflowEdge[])).toBe(
      buildVideoAuditCreditId({ analysisProvided: false, durationSec: 72 }),
    )
  })

  it("never returns the bare `video-audit` id (which would price every run at one family's ceiling)", () => {
    const node = auditNode() as unknown as WorkflowNode
    expect(getModelIdentifier(node)).toBe("video-audit:auto:600s")
    expect(getModelIdentifier(node, [] as unknown as WorkflowEdge[])).not.toBe("video-audit")
  })

  it("agrees with estimateNodeCredits on every family × bucket (badge vs total invariant)", () => {
    vi.mocked(getCachedCredits).mockReturnValue(undefined)
    for (const durationSec of [45, 72, 300, 9999]) {
      for (const edges of [ANALYSIS_EDGE, VIDEO_EDGE]) {
        const node = auditNode({ probedVideo: { url: "https://r2/c.mp4", durationSec } })
        const liveRow = VIDEO_AUDIT_BUCKET_CREDITS[getModelIdentifier(node as unknown as WorkflowNode, edges as unknown as WorkflowEdge[])]
        expect(liveRow).toBe(estimateNodeCredits(node, edges))
      }
    }
  })
})
