/**
 * Payload-builder tests for the `video-audit` node type ("AI Audit").
 *
 * Sibling of `payload-builder-video-analysis.test.ts`. Without a
 * `case "video-audit"` in payload-builder, buildPayload throws "Unknown node
 * type" and EVERY non-canvas execution path (webhook triggers, schedules,
 * published apps, MCP run_workflow, sub-workflows) creates a stale `pending`
 * jobs row and then kills the whole workflow — the parameter-picker outage
 * class. The registry-walk CI guard pairs with these behavioural assertions.
 *
 * The node prices off TWO axes, and both are derived here rather than trusted
 * from the panel:
 *
 *   FAMILY   — `video-audit:*` when an analysis was PROVIDED (the audit only
 *              re-watches against it) vs `video-audit:auto:*` when none was
 *              (the node runs its own fast analysis first, hence the pricier
 *              family). The frontend picks the family from the EDGES
 *              (`videoAuditAnalysisWired`); the server picks it from whether
 *              the analysis actually RESOLVED, and refuses to run when those
 *              two disagree — otherwise a server run would silently bill a
 *              family the canvas never quoted.
 *   DURATION — the same bucket ladder as video-analysis (60/180/360/600s),
 *              resolved from trusted upstream metadata, else the node's
 *              URL-BOUND probe, else the 600s ceiling (over-reserves, never
 *              under).
 */
import { describe, it, expect } from "vitest"
import { buildPayload, videoAuditAnalysisWired } from "../payload-builder.js"
import { VIDEO_AUDIT_BUCKET_CREDITS } from "@nodaro/shared"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"

const jobId = "job-vaud-1"
const usageLogId = "usage-vaud-1"

const CLIP = "https://cdn.example.com/clip.mp4"

/** A minimal stand-in for the wired analysis — buildPayload never inspects its
 *  shape (it forwards it verbatim to the plugin, which parses it), so the test
 *  only needs an identifiable object to assert pass-through on. */
const ANALYSIS = { meta: { durationSec: 12 }, slots: [], scenes: [{ sceneNumber: 1 }] }

function node(data: Record<string, unknown> = {}): SimpleNode {
  return { id: "vaud-node", type: "video-audit", data: { videoUrl: CLIP, ...data } }
}

/** An edge into the node's `analysis` target — what the canvas prices from. */
const ANALYSIS_EDGE: SimpleEdge[] = [
  { id: "e1", source: "va", target: "vaud-node", sourceHandle: "json", targetHandle: "analysis" } as SimpleEdge,
]
/** A video-only wiring — no analysis edge, so the auto family is correct. */
const VIDEO_EDGE: SimpleEdge[] = [
  { id: "e2", source: "up", target: "vaud-node", sourceHandle: "video", targetHandle: "video" } as SimpleEdge,
]

describe("buildPayload — video-audit", () => {
  it("does not throw 'Unknown node type' and returns the correct queue + job name", () => {
    expect(() => buildPayload(node(), jobId, {}, usageLogId)).not.toThrow()
    const result = buildPayload(node(), jobId, {}, usageLogId)
    expect(result.queueName).toBe("video-generation")
    expect(result.jobName).toBe("video-audit")
  })

  // ── FAMILY ────────────────────────────────────────────────────────────────

  it("(a) no analysis resolved → the AUTO family (the node analyses the clip itself)", () => {
    const result = buildPayload(node(), jobId, {}, usageLogId)
    expect(result.modelIdentifier).toBe("video-audit:auto:600s")
    expect(result.payload.reservedCreditId).toBe("video-audit:auto:600s")
    // `analysis` is OMITTED from the wire, never sent as an explicit undefined —
    // the plugin's family switch keys off presence.
    expect("analysis" in result.payload).toBe(false)
  })

  it("(b) analysis resolved → the RE-AUDIT family, and the payload carries it verbatim", () => {
    const inputs: ResolvedInputs = { analysis: ANALYSIS }
    const result = buildPayload(node(), jobId, inputs, usageLogId, {
      nodes: [], edges: ANALYSIS_EDGE, nodeStates: {},
    })
    expect(result.modelIdentifier).toBe("video-audit:600s")
    expect(result.payload.reservedCreditId).toBe("video-audit:600s")
    // Same object reference — no re-serialization, no normalization, no clone.
    expect(result.payload.analysis).toBe(ANALYSIS)
  })

  it("(b') the two families are DIFFERENT prices at the same bucket (the reason the rule exists)", () => {
    const wired = buildPayload(node(), jobId, { analysis: ANALYSIS }, usageLogId, {
      nodes: [], edges: ANALYSIS_EDGE, nodeStates: {},
    })
    const auto = buildPayload(node(), jobId, {}, usageLogId, { nodes: [], edges: VIDEO_EDGE, nodeStates: {} })
    const wiredCost = VIDEO_AUDIT_BUCKET_CREDITS[wired.modelIdentifier]
    const autoCost = VIDEO_AUDIT_BUCKET_CREDITS[auto.modelIdentifier]
    // Both ids must be real rows in the shared table (a typo'd family/bucket
    // would resolve to `undefined` and reserve nothing).
    expect(wiredCost).toBeGreaterThan(0)
    expect(autoCost).toBeGreaterThan(0)
    expect(autoCost).toBeGreaterThan(wiredCost)
  })

  it("(c) an analysis from a wired edge that produced NOTHING is refused, not silently up-priced", () => {
    // The canvas badge / workflow total / run-confirm dialog all quoted the
    // cheaper wired family from this same edge. Running would bill the auto
    // family instead — so refuse, exactly like the frontend executor does.
    expect(() =>
      buildPayload(node(), jobId, {}, usageLogId, { nodes: [], edges: ANALYSIS_EDGE, nodeStates: {} }),
    ).toThrow(/analysis_not_ready/)
  })

  it("(c') the refusal is scoped to the `analysis` handle — a video-only wiring runs auto", () => {
    const result = buildPayload(node(), jobId, {}, usageLogId, {
      nodes: [], edges: VIDEO_EDGE, nodeStates: {},
    })
    expect(result.modelIdentifier).toBe("video-audit:auto:600s")
  })

  // ── DURATION BUCKET ───────────────────────────────────────────────────────

  it("(d) resolvedInputs.videoDuration buckets BOTH families identically", () => {
    const auto = buildPayload(node(), jobId, { videoDuration: 170 }, usageLogId)
    expect(auto.modelIdentifier).toBe("video-audit:auto:180s")

    const wired = buildPayload(node(), jobId, { videoDuration: 170, analysis: ANALYSIS }, usageLogId, {
      nodes: [], edges: ANALYSIS_EDGE, nodeStates: {},
    })
    expect(wired.modelIdentifier).toBe("video-audit:180s")
  })

  it("(e) URL-bound probedVideo buckets the reserve when its url matches the effective videoUrl", () => {
    const result = buildPayload(
      node({ probedVideo: { url: CLIP, durationSec: 55 } }),
      jobId,
      {},
      usageLogId,
    )
    // 55s → 60s bucket.
    expect(result.modelIdentifier).toBe("video-audit:auto:60s")
  })

  it("(f) IGNORES a probedVideo whose url does NOT match the effective videoUrl → ceiling", () => {
    // The panel's clip changed but the stale probe still carries the old url +
    // its duration. The exact-url gate must reject it (over-reserve, never under).
    const result = buildPayload(
      node({ videoUrl: "https://cdn.example.com/OTHER.mp4", probedVideo: { url: CLIP, durationSec: 55 } }),
      jobId,
      {},
      usageLogId,
    )
    expect(result.modelIdentifier).toBe("video-audit:auto:600s")
  })

  it("(f') a WIRED videoUrl re-binds the probe check — a probe bound to the config url is stale", () => {
    const inputs: ResolvedInputs = { videoUrl: "https://cdn.example.com/wired.mp4" }
    const result = buildPayload(
      node({ probedVideo: { url: CLIP, durationSec: 55 } }),
      jobId,
      inputs,
      usageLogId,
    )
    expect(result.payload.videoUrl).toBe("https://cdn.example.com/wired.mp4")
    expect(result.modelIdentifier).toBe("video-audit:auto:600s")
  })

  it("(g) trusted upstream videoDuration wins over a matching probedVideo", () => {
    const result = buildPayload(
      node({ probedVideo: { url: CLIP, durationSec: 500 } }),
      jobId,
      { videoDuration: 50 },
      usageLogId,
    )
    expect(result.modelIdentifier).toBe("video-audit:auto:60s")
  })

  it("(h) every family × bucket combination resolves to a real row in the shared table", () => {
    // 64 s: the first whole second past the 60s bucket and its 3-second pricing
    // grace (VIDEO_ANALYSIS_BUCKET_GRACE_SEC) — a 61 s clip now prices as 60s.
    for (const [durationSec, bucket] of [[10, 60], [61, 60], [64, 180], [200, 360], [500, 600], [99999, 600]] as const) {
      for (const analysis of [ANALYSIS, undefined]) {
        const result = buildPayload(
          node(),
          jobId,
          { videoDuration: durationSec, ...(analysis ? { analysis } : {}) },
          usageLogId,
          { nodes: [], edges: analysis ? ANALYSIS_EDGE : [], nodeStates: {} },
        )
        const expected = `video-audit${analysis ? "" : ":auto"}:${bucket}s`
        expect(result.modelIdentifier).toBe(expected)
        expect(VIDEO_AUDIT_BUCKET_CREDITS[expected]).toBeGreaterThan(0)
      }
    }
  })

  // ── PAYLOAD SHAPE / GUARDS ────────────────────────────────────────────────

  it("modelIdentifier IS payload.reservedCreditId (one id reserves, commits and refunds)", () => {
    const result = buildPayload(node(), jobId, { videoDuration: 170 }, usageLogId)
    expect(result.payload.reservedCreditId).toBe(result.modelIdentifier)
  })

  it("forwards jobId, videoUrl, nodeId and usageLogId in the payload", () => {
    const result = buildPayload(node(), jobId, {}, usageLogId)
    expect(result.payload.jobId).toBe(jobId)
    expect(result.payload.videoUrl).toBe(CLIP)
    expect(result.payload.nodeId).toBe("vaud-node")
    expect(result.payload.usageLogId).toBe(usageLogId)
  })

  it("a wired videoUrl wins over the config field", () => {
    const result = buildPayload(node(), jobId, { videoUrl: "https://cdn.example.com/wired.mp4" }, usageLogId)
    expect(result.payload.videoUrl).toBe("https://cdn.example.com/wired.mp4")
  })

  it("throws (deleting the pending job, reserving nothing) when no clip is resolvable", () => {
    const bare: SimpleNode = { id: "vaud-node", type: "video-audit", data: {} }
    expect(() => buildPayload(bare, jobId, {}, usageLogId)).toThrow(/video_required/)
  })
})

describe("videoAuditAnalysisWired (backend mirror of the frontend family rule)", () => {
  it("true only for an edge into THIS node's `analysis` target", () => {
    expect(videoAuditAnalysisWired("vaud-node", ANALYSIS_EDGE)).toBe(true)
    expect(videoAuditAnalysisWired("vaud-node", VIDEO_EDGE)).toBe(false)
    expect(videoAuditAnalysisWired("vaud-node", [])).toBe(false)
    // An analysis edge into a DIFFERENT node is not this node's.
    expect(videoAuditAnalysisWired("other", ANALYSIS_EDGE)).toBe(false)
  })

  it("no graph context → false (never claims an analysis it can't see)", () => {
    expect(videoAuditAnalysisWired("vaud-node", undefined)).toBe(false)
    expect(videoAuditAnalysisWired(undefined, ANALYSIS_EDGE)).toBe(false)
  })
})
