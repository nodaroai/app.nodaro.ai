import { describe, it, expect, vi } from "vitest"
import {
  pickLatestCompletedJobPerNode,
  buildCompletedResultPatch,
  computeCompletedJobPatches,
  reconcileCompletedSingleNodeJobs,
} from "../reconcile-completed-jobs"
import type { WorkflowNode } from "@/types/nodes"

const NOW = "2026-07-14T12:00:00.000Z"

/** A completed single-node job as the executions list returns it (nodeState
 *  keyed by canvas node_id; no output_data inline — that's fetched per job). */
function completedItem(jobId: string, nodeId: string | null) {
  return {
    id: jobId,
    triggerType: "single-node",
    nodeStates: { [nodeId ?? jobId]: { nodeId, jobId, status: "completed" } },
  }
}

function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
}

describe("pickLatestCompletedJobPerNode", () => {
  it("keeps the newest job per node (items are newest-first)", () => {
    const refs = pickLatestCompletedJobPerNode([
      completedItem("job-new", "n1"),
      completedItem("job-old", "n1"),
      completedItem("job-b", "n2"),
    ])
    expect(refs).toEqual([
      { nodeId: "n1", jobId: "job-new" },
      { nodeId: "n2", jobId: "job-b" },
    ])
  })

  it("skips items with no canvas node_id and non-single-node items", () => {
    const refs = pickLatestCompletedJobPerNode([
      completedItem("j1", null),
      { id: "orch", triggerType: "manual", nodeStates: { n9: { nodeId: "n9", jobId: "x" } } },
    ])
    expect(refs).toEqual([])
  })
})

describe("buildCompletedResultPatch", () => {
  it("writes a single video result (generate-video-pro)", () => {
    const patch = buildCompletedResultPatch("generate-video-pro", { videoUrl: "https://r2/v.mp4", thumbnailUrl: "https://r2/t.jpg" }, "job-1", NOW)
    expect(patch).toEqual({
      executionStatus: "completed",
      generatedVideoUrl: "https://r2/v.mp4",
      generatedResults: [{ url: "https://r2/v.mp4", thumbnailUrl: "https://r2/t.jpg", timestamp: NOW, jobId: "job-1" }],
      activeResultIndex: 0,
    })
  })

  it("routes an entity node's image to sourceImageUrl", () => {
    const patch = buildCompletedResultPatch("character", { imageUrl: "https://r2/c.png" }, "job-2", NOW)
    expect(patch?.sourceImageUrl).toBe("https://r2/c.png")
    expect(patch?.generatedImageUrl).toBeUndefined()
  })

  it("returns null when the job produced no media URL", () => {
    expect(buildCompletedResultPatch("generate-video-pro", { foo: "bar" }, "j", NOW)).toBeNull()
    expect(buildCompletedResultPatch("generate-video-pro", null, "j", NOW)).toBeNull()
  })
})

describe("computeCompletedJobPatches", () => {
  const fetchOk = (url: string) => vi.fn(async () => ({ status: "completed", output_data: { videoUrl: url } }))

  it("recovers a result onto an empty node", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "j1" }],
      [node("n1", "generate-video-pro")],
      fetchOk("https://r2/v.mp4"),
      NOW,
    )
    expect(patches).toEqual([{ nodeId: "n1", updates: expect.objectContaining({ generatedVideoUrl: "https://r2/v.mp4" }) }])
  })

  it("skips a node that already has a result", async () => {
    const fetch = fetchOk("https://r2/v.mp4")
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "j1" }],
      [node("n1", "generate-video-pro", { generatedVideoUrl: "https://r2/existing.mp4" })],
      fetch,
      NOW,
    )
    expect(patches).toEqual([])
    expect(fetch).not.toHaveBeenCalled() // guard short-circuits before the fetch
  })

  it("skips a node already marked completed (respects user edits)", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "j1" }],
      [node("n1", "generate-video-pro", { executionStatus: "completed" })],
      fetchOk("https://r2/v.mp4"),
      NOW,
    )
    expect(patches).toEqual([])
  })

  it("skips a job that isn't actually completed yet", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "j1" }],
      [node("n1", "generate-video-pro")],
      vi.fn(async () => ({ status: "processing", output_data: {} })),
      NOW,
    )
    expect(patches).toEqual([])
  })

  it("swallows a fetch error and continues", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "j1" }, { nodeId: "n2", jobId: "j2" }],
      [node("n1", "generate-video-pro"), node("n2", "generate-video-pro")],
      vi.fn(async (jobId: string) => {
        if (jobId === "j1") throw new Error("boom")
        return { status: "completed", output_data: { videoUrl: "https://r2/ok.mp4" } }
      }),
      NOW,
    )
    expect(patches).toEqual([{ nodeId: "n2", updates: expect.objectContaining({ generatedVideoUrl: "https://r2/ok.mp4" }) }])
  })

  it("skips a node that's not on the canvas", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "ghost", jobId: "j1" }],
      [node("n1", "generate-video-pro")],
      fetchOk("https://r2/v.mp4"),
      NOW,
    )
    expect(patches).toEqual([])
  })
})

describe("reconcileCompletedSingleNodeJobs", () => {
  it("applies recovered results via updateNodeData", async () => {
    const updateNodeData = vi.fn()
    await reconcileCompletedSingleNodeJobs(
      "wf-1",
      [node("n1", "generate-video-pro")],
      updateNodeData,
      {
        listCompleted: async () => ({ data: [completedItem("j1", "n1")] }),
        fetchOutput: async () => ({ status: "completed", output_data: { videoUrl: "https://r2/v.mp4" } }),
        nowIso: NOW,
      },
    )
    expect(updateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ generatedVideoUrl: "https://r2/v.mp4" }))
  })

  it("never throws when the list call fails", async () => {
    const updateNodeData = vi.fn()
    await expect(
      reconcileCompletedSingleNodeJobs("wf-1", [node("n1", "generate-video-pro")], updateNodeData, {
        listCompleted: async () => { throw new Error("network") },
      }),
    ).resolves.toBeUndefined()
    expect(updateNodeData).not.toHaveBeenCalled()
  })
})

describe("video-analysis result recovery", () => {
  /** A completed analysis lands in `output_data.json` — NOT a media URL — so it
   *  used to fall through every recovery layer: the node stayed empty after any
   *  reload whose live poll died, even though the run billed and completed
   *  (reported 2026-08-03: mixed run billed 149, node showed nothing). */
  const ANALYSIS = {
    meta: { durationSec: 72 },
    slots: [{ slotId: "man-1", role: "person", label: "Protagonist" }],
    scenes: [{ sceneNumber: 1, startSec: 0, endSec: 2.1, label: "establishing" }],
  }

  it("buildCompletedResultPatch maps output_data.json onto generatedJson", () => {
    const patch = buildCompletedResultPatch("video-analysis", { json: ANALYSIS }, "j", NOW)
    expect(patch).toEqual({ executionStatus: "completed", generatedJson: ANALYSIS })
  })

  it("still returns null for a video-analysis job with no json payload", () => {
    expect(buildCompletedResultPatch("video-analysis", { foo: "bar" }, "j", NOW)).toBeNull()
    expect(buildCompletedResultPatch("video-analysis", null, "j", NOW)).toBeNull()
  })

  it("does not treat a stray json field as a result for other node types", () => {
    expect(buildCompletedResultPatch("generate-video-pro", { json: ANALYSIS }, "j", NOW)).toBeNull()
  })

  it("computeCompletedJobPatches recovers an analysis onto an empty node", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "va", jobId: "j1" }],
      [node("va", "video-analysis", { llmModel: "mixed" })],
      vi.fn(async () => ({ status: "completed", output_data: { json: ANALYSIS } })),
      NOW,
    )
    expect(patches).toEqual([
      { nodeId: "va", updates: { executionStatus: "completed", generatedJson: ANALYSIS } },
    ])
  })

  it("skips a node that already carries a saved analysis (guard short-circuits the fetch)", async () => {
    const fetch = vi.fn(async () => ({ status: "completed", output_data: { json: ANALYSIS } }))
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "va", jobId: "j1" }],
      [node("va", "video-analysis", { generatedJson: { scenes: [] } })],
      fetch,
      NOW,
    )
    expect(patches).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  /** video-audit is the second analysis emitter and carries a SECOND result
   *  surface: the fix-and-disclose report. Recovering only the JSON leaves the
   *  node's primary reading surface (the report strip) blank — same billed-
   *  but-invisible class as the analysis bug above. */
  const REPORT = {
    autoAnalysis: false,
    summary: "Two scene labels corrected against the footage.",
    findings: [
      { kind: "corrected", sceneNumber: 1, field: "label", reason: "no such action in frame" },
      { kind: "watch", sceneNumber: 4, reason: "speaker identity uncertain" },
    ],
  }

  it("recovers a video-audit's corrected analysis AND its report", () => {
    expect(buildCompletedResultPatch("video-audit", { json: ANALYSIS, report: REPORT }, "j", NOW)).toEqual({
      executionStatus: "completed",
      generatedJson: ANALYSIS,
      lastAuditReport: REPORT,
    })
  })

  it("recovers a video-audit with no report payload (json only, no blank strip key)", () => {
    expect(buildCompletedResultPatch("video-audit", { json: ANALYSIS }, "j", NOW)).toEqual({
      executionStatus: "completed",
      generatedJson: ANALYSIS,
    })
  })

  it("still returns null for a video-audit job with no json payload", () => {
    expect(buildCompletedResultPatch("video-audit", { report: REPORT }, "j", NOW)).toBeNull()
    expect(buildCompletedResultPatch("video-audit", null, "j", NOW)).toBeNull()
  })

  it("never writes lastAuditReport onto a plain video-analysis node", () => {
    expect(buildCompletedResultPatch("video-analysis", { json: ANALYSIS, report: REPORT }, "j", NOW)).toEqual({
      executionStatus: "completed",
      generatedJson: ANALYSIS,
    })
  })

  it("computeCompletedJobPatches recovers an audit onto an empty node", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "aud", jobId: "j1" }],
      [node("aud", "video-audit")],
      vi.fn(async () => ({ status: "completed", output_data: { json: ANALYSIS, report: REPORT } })),
      NOW,
    )
    expect(patches).toEqual([
      { nodeId: "aud", updates: { executionStatus: "completed", generatedJson: ANALYSIS, lastAuditReport: REPORT } },
    ])
  })
})

describe("content-policy rewrite disclosure recovery (Task A4 follow-up)", () => {
  /** A long GVP run (10-40+ min — this whole file's motivating scenario) that
   *  disclosed a rewritten segment must still show the notice after a
   *  dead-poll reload, not just on a live run (execute-node.ts's
   *  gvpProExtractor covers that path — see generate-video-pro-node.tsx). */
  const REWRITES = [{ segment: 2, original: "a busy city street", rewritten: "a busy urban street" }]

  it("buildCompletedResultPatch carries contentPolicyRewrites through for generate-video-pro", () => {
    const patch = buildCompletedResultPatch(
      "generate-video-pro",
      { videoUrl: "https://r2/v.mp4", contentPolicyRewrites: REWRITES },
      "job-1",
      NOW,
    )
    expect(patch?.contentPolicyRewrites).toEqual(REWRITES)
  })

  it("omits contentPolicyRewrites when the job disclosed none (the common case)", () => {
    const patch = buildCompletedResultPatch("generate-video-pro", { videoUrl: "https://r2/v.mp4" }, "job-1", NOW)
    expect(patch).not.toHaveProperty("contentPolicyRewrites")
  })

  it("does not attach a stray contentPolicyRewrites field for a different node type", () => {
    const patch = buildCompletedResultPatch(
      "generate-video",
      { videoUrl: "https://r2/v.mp4", contentPolicyRewrites: REWRITES },
      "job-1",
      NOW,
    )
    expect(patch).not.toHaveProperty("contentPolicyRewrites")
  })

  it("computeCompletedJobPatches recovers the disclosure onto an empty GVP node after a dead-poll reload", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "j1" }],
      [node("n1", "generate-video-pro")],
      vi.fn(async () => ({
        status: "completed",
        output_data: { videoUrl: "https://r2/v.mp4", contentPolicyRewrites: REWRITES },
      })),
      NOW,
    )
    expect(patches).toEqual([
      { nodeId: "n1", updates: expect.objectContaining({ contentPolicyRewrites: REWRITES }) },
    ])
  })
})

/**
 * Scene3D reload recovery.
 *
 * The gap: a first scene generation whose in-memory poll died (reload, tab
 * close) left the node EMPTY — the result was billed and sitting in
 * `jobs.output_data`, but `buildCompletedResultPatch` only recognised media
 * URLs and analysis JSON, so nothing put it back on the canvas.
 */
describe("Scene3D recovery", () => {
  const REV_A = "11111111-1111-4111-8111-111111111111"
  const REV_B = "22222222-2222-4222-8222-222222222222"
  const REV_C = "33333333-3333-4333-8333-333333333333"

  const plan = (revisionId: string, parentRevisionId?: string) => ({
    planType: "3d-scene",
    revisionId,
    ...(parentRevisionId ? { parentRevisionId } : {}),
  })

  function sceneJob(revisionId: string, parentRevisionId?: string) {
    return async () => ({ status: "completed", output_data: { scenePlan: plan(revisionId, parentRevisionId), changeSummary: "built the set" } })
  }

  it("recovers a first generation onto an empty scene node", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "job-1" }],
      [node("n1", "generate-3d-scene", {})],
      sceneJob(REV_A),
      NOW,
    )
    expect(patches).toHaveLength(1)
    const updates = patches[0].updates
    expect((updates.scenePlan as Record<string, unknown>).revisionId).toBe(REV_A)
    expect((updates.sceneHistory as Array<{ revisionId: string }>).map((e) => e.revisionId)).toEqual([REV_A])
    expect(updates.expectedRevisionId).toBe(REV_A)
    expect(updates.sceneJobBaseRevisionId).toBeUndefined()
  })

  it("PARKS the recovered plan when the node already holds a different scene", async () => {
    // Uncertain provenance (the run's base is unknown or has moved) → keep the
    // user's scene active and offer the recovered one, never the reverse.
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "job-1" }],
      [node("n1", "generate-3d-scene", { scenePlan: plan(REV_B) })],
      sceneJob(REV_A),
      NOW,
    )
    expect(patches).toHaveLength(1)
    expect(patches[0].updates.scenePlan).toBeUndefined()
    expect((patches[0].updates.scenePendingPlan as Record<string, unknown>).revisionId).toBe(REV_A)
  })

  it("ADOPTS when the node is still on the revision the interrupted run started from", async () => {
    // `sceneJobBaseRevisionId` is not a transient runtime key, so it survives
    // the save and a mid-run reload still knows what the job was based on.
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "job-1" }],
      [node("n1", "edit-3d-scene", { scenePlan: plan(REV_B), sceneJobBaseRevisionId: REV_B })],
      sceneJob(REV_C, REV_B),
      NOW,
    )
    expect((patches[0].updates.scenePlan as Record<string, unknown>).revisionId).toBe(REV_C)
  })

  it("is IDEMPOTENT across reloads — a revision already in history is not re-parked", async () => {
    const history = [{ revisionId: REV_A, scenePlan: plan(REV_A), source: "generate", createdAt: NOW }]
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "job-1" }],
      [node("n1", "generate-3d-scene", { scenePlan: plan(REV_B), sceneHistory: history })],
      sceneJob(REV_A),
      NOW,
    )
    expect(patches).toEqual([])
  })

  it("respects an edit made DURING recovery, not the pre-fetch snapshot", async () => {
    // The job lookup is async and the canvas stays interactive: the user
    // nudges an object while it is in flight. Deciding against the snapshot
    // would overwrite exactly that edit.
    const snapshot = node("n1", "generate-3d-scene", {})
    const live: Record<string, unknown> = { scenePlan: plan(REV_B) }
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "job-1" }],
      [snapshot],
      sceneJob(REV_A),
      NOW,
      () => live,
    )
    expect(patches[0].updates.scenePlan).toBeUndefined()
    expect((patches[0].updates.scenePendingPlan as Record<string, unknown>).revisionId).toBe(REV_A)
  })

  it("skips a job that produced no scene", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "job-1" }],
      [node("n1", "generate-3d-scene", {})],
      async () => ({ status: "completed", output_data: { videoUrl: "https://r2/v.mp4" } }),
      NOW,
    )
    expect(patches).toEqual([])
  })
})
