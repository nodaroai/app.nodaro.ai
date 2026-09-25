import { describe, it, expect, vi } from "vitest"
import {
  pickLatestTerminalJobPerNode,
  buildCompletedResultPatch,
  computeCompletedJobPatches,
  reconcileCompletedSingleNodeJobs,
} from "../reconcile-completed-jobs"
import type { WorkflowNode } from "@/types/nodes"

const NOW = "2026-07-14T12:00:00.000Z"

/** A terminal single-node job as the executions list returns it (nodeState
 *  keyed by canvas node_id; no output_data inline — that's fetched per job). */
function terminalItem(jobId: string, nodeId: string | null, status = "completed") {
  return {
    id: jobId,
    triggerType: "single-node",
    nodeStates: { [nodeId ?? jobId]: { nodeId, jobId, status } },
  }
}

const completedItem = (jobId: string, nodeId: string | null) => terminalItem(jobId, nodeId)
const failedItem = (jobId: string, nodeId: string | null) => terminalItem(jobId, nodeId, "failed")

function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
}

describe("pickLatestTerminalJobPerNode", () => {
  it("keeps the newest job per node (items are newest-first)", () => {
    const refs = pickLatestTerminalJobPerNode([
      completedItem("job-new", "n1"),
      completedItem("job-old", "n1"),
      completedItem("job-b", "n2"),
    ])
    expect(refs).toEqual([
      { nodeId: "n1", jobId: "job-new", status: "completed" },
      { nodeId: "n2", jobId: "job-b", status: "completed" },
    ])
  })

  it("skips items with no canvas node_id and non-single-node items", () => {
    const refs = pickLatestTerminalJobPerNode([
      completedItem("j1", null),
      { id: "orch", triggerType: "manual", nodeStates: { n9: { nodeId: "n9", jobId: "x" } } },
    ])
    expect(refs).toEqual([])
  })

  /**
   * The non-regression that makes the widening safe. A media node's newest run
   * failing must NOT shadow the older completed run this module exists to
   * recover — otherwise the node claims a job with no media on it and stays
   * empty, which is the exact bug in reverse.
   */
  it("a failed job is ignored unless the node accepts one", () => {
    const items = [failedItem("job-newer", "n1"), completedItem("job-older", "n1")]
    expect(pickLatestTerminalJobPerNode(items)).toEqual([
      { nodeId: "n1", jobId: "job-older", status: "completed" },
    ])
  })

  it("claims the newest FAILED job for a node that accepts one", () => {
    const items = [failedItem("job-newer", "s1"), completedItem("job-older", "s1")]
    expect(pickLatestTerminalJobPerNode(items, { acceptsFailed: () => true })).toEqual([
      { nodeId: "s1", jobId: "job-newer", status: "failed" },
    ])
  })

  it("ignores a non-terminal job entirely", () => {
    expect(
      pickLatestTerminalJobPerNode([terminalItem("j1", "n1", "running")], { acceptsFailed: () => true }),
    ).toEqual([])
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
      [{ nodeId: "n1", jobId: "j1", status: "completed" }],
      [node("n1", "generate-video-pro")],
      fetchOk("https://r2/v.mp4"),
      NOW,
    )
    expect(patches).toEqual([{ nodeId: "n1", updates: expect.objectContaining({ generatedVideoUrl: "https://r2/v.mp4" }) }])
  })

  it("skips a node that already has a result", async () => {
    const fetch = fetchOk("https://r2/v.mp4")
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "j1", status: "completed" }],
      [node("n1", "generate-video-pro", { generatedVideoUrl: "https://r2/existing.mp4" })],
      fetch,
      NOW,
    )
    expect(patches).toEqual([])
    expect(fetch).not.toHaveBeenCalled() // guard short-circuits before the fetch
  })

  it("skips a node already marked completed (respects user edits)", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "j1", status: "completed" }],
      [node("n1", "generate-video-pro", { executionStatus: "completed" })],
      fetchOk("https://r2/v.mp4"),
      NOW,
    )
    expect(patches).toEqual([])
  })

  it("skips a job that isn't actually completed yet", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "j1", status: "completed" }],
      [node("n1", "generate-video-pro")],
      vi.fn(async () => ({ status: "processing", output_data: {} })),
      NOW,
    )
    expect(patches).toEqual([])
  })

  it("swallows a fetch error and continues", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "j1", status: "completed" }, { nodeId: "n2", jobId: "j2", status: "completed" }],
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
      [{ nodeId: "ghost", jobId: "j1", status: "completed" }],
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
      [{ nodeId: "va", jobId: "j1", status: "completed" }],
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
      [{ nodeId: "va", jobId: "j1", status: "completed" }],
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
      [{ nodeId: "aud", jobId: "j1", status: "completed" }],
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
      [{ nodeId: "n1", jobId: "j1", status: "completed" }],
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
      [{ nodeId: "n1", jobId: "job-1", status: "completed" }],
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
      [{ nodeId: "n1", jobId: "job-1", status: "completed" }],
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
      [{ nodeId: "n1", jobId: "job-1", status: "completed" }],
      [node("n1", "edit-3d-scene", { scenePlan: plan(REV_B), sceneJobBaseRevisionId: REV_B })],
      sceneJob(REV_C, REV_B),
      NOW,
    )
    expect((patches[0].updates.scenePlan as Record<string, unknown>).revisionId).toBe(REV_C)
  })

  it("is IDEMPOTENT across reloads — a revision already in history is not re-parked", async () => {
    const history = [{ revisionId: REV_A, scenePlan: plan(REV_A), source: "generate", createdAt: NOW }]
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "job-1", status: "completed" }],
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
      [{ nodeId: "n1", jobId: "job-1", status: "completed" }],
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
      [{ nodeId: "n1", jobId: "job-1", status: "completed" }],
      [node("n1", "generate-3d-scene", {})],
      async () => ({ status: "completed", output_data: { videoUrl: "https://r2/v.mp4" } }),
      NOW,
    )
    expect(patches).toEqual([])
  })
})

/**
 * A REFUSED 3D-scene run that RETAINED its draft, across a reload.
 *
 * `SCENE_QUALITY_FAILED` after an exhausted repair budget is the refusal that
 * already published a real, renderable revision — billed, addressable by the
 * artifact routes, and until now unreachable from here: this lane asked the
 * executions list for `status: "completed"` only.
 *
 * Two distinct losses, and the second is the one that surprises: the draft
 * itself when the refusal settled with the tab closed, and — even when the
 * draft DID arrive live — the VERDICT, because `executionStatus` is a transient
 * key stripped from every save. A refused scene came back from a reload looking
 * like a clean success.
 */
describe("Scene3D retained-draft recovery (a FAILED job)", () => {
  const REV_A = "11111111-1111-4111-8111-111111111111"
  const REV_B = "22222222-2222-4222-8222-222222222222"
  const REV_C = "33333333-3333-4333-8333-333333333333"

  const plan = (revisionId: string, parentRevisionId?: string) => ({
    planType: "3d-scene",
    revisionId,
    ...(parentRevisionId ? { parentRevisionId } : {}),
  })

  const REFUSAL = "SCENE_QUALITY_FAILED: the reviewer refused the scene after 3 repair passes"

  function refusedJob(revisionId: string, parentRevisionId?: string) {
    return async () => ({
      status: "failed",
      error_message: REFUSAL,
      output_data: {
        kind: "draft",
        scenePlan: plan(revisionId, parentRevisionId),
        sceneRevisionId: revisionId,
        deliveryId: "del-1",
        posterAssetId: "asset-1",
        validation: { status: "failed", sourceRetained: true },
        metadata: { review: { refused: true } },
      },
    })
  }

  const failedRef = [{ nodeId: "n1", jobId: "job-1", status: "failed" as const }]

  it("puts the retained draft on an empty node, with the verdict", async () => {
    const patches = await computeCompletedJobPatches(
      failedRef,
      [node("n1", "generate-3d-scene", {})],
      refusedJob(REV_A),
      NOW,
    )
    expect(patches).toHaveLength(1)
    const updates = patches[0].updates
    expect((updates.scenePlan as Record<string, unknown>).revisionId).toBe(REV_A)
    expect((updates.sceneHistory as Array<{ revisionId: string }>).map((e) => e.revisionId)).toEqual([REV_A])
    expect(updates.executionStatus).toBe("failed")
    expect(updates.errorMessage).toBe(REFUSAL)
  })

  it("re-asserts the verdict alone when the draft already reached the canvas live", async () => {
    // The live lane adopted it; `executionStatus` did not survive the save.
    const held = {
      scenePlan: plan(REV_A),
      sceneHistory: [{ revisionId: REV_A, source: "generate", plan: plan(REV_A) }],
      errorMessage: REFUSAL,
    }
    const patches = await computeCompletedJobPatches(
      failedRef,
      [node("n1", "generate-3d-scene", held)],
      refusedJob(REV_A),
      NOW,
    )
    expect(patches).toEqual([{ nodeId: "n1", updates: { executionStatus: "failed" } }])
  })

  it("PARKS the retained draft when the node moved on, and still fails", async () => {
    const moved = {
      scenePlan: plan(REV_C, REV_A),
      sceneJobBaseRevisionId: REV_A,
    }
    const patches = await computeCompletedJobPatches(
      failedRef,
      [node("n1", "edit-3d-scene", moved)],
      refusedJob(REV_B, REV_A),
      NOW,
    )
    const updates = patches[0].updates
    expect(updates.scenePlan).toBeUndefined()
    expect((updates.scenePendingPlan as Record<string, unknown>).revisionId).toBe(REV_B)
    expect(updates.executionStatus).toBe("failed")
  })

  it("never writes the MEDIA half of a failed run", async () => {
    const patches = await computeCompletedJobPatches(
      failedRef,
      [node("n1", "pro-3d-render", {})],
      async () => ({
        status: "failed",
        error_message: REFUSAL,
        // A producer should never put one here; if one ever does, the node must
        // not paint a video for a run that failed.
        output_data: { scenePlan: plan(REV_A), videoUrl: "https://r2/should-not-be-used.mp4" },
      }),
      NOW,
    )
    expect(patches[0].updates.generatedVideoUrl).toBeUndefined()
    expect(patches[0].updates.generatedResults).toBeUndefined()
    expect(patches[0].updates.executionStatus).toBe("failed")
  })

  it("writes nothing for a failure that retained no scene", async () => {
    const patches = await computeCompletedJobPatches(
      failedRef,
      [node("n1", "generate-3d-scene", { scenePlan: plan(REV_A) })],
      async () => ({ status: "failed", error_message: "Compiler refused every recipe", output_data: null }),
      NOW,
    )
    expect(patches).toEqual([])
  })

  it("refuses to stamp a stale verdict over a node the user just re-ran", async () => {
    const live = { scenePlan: plan(REV_A), executionStatus: "running" }
    const patches = await computeCompletedJobPatches(
      failedRef,
      [node("n1", "generate-3d-scene", { scenePlan: plan(REV_A) })],
      refusedJob(REV_B, REV_A),
      NOW,
      () => live,
    )
    expect(patches).toEqual([])
  })

  it("ignores a failed ref aimed at a node type that retains nothing", async () => {
    const patches = await computeCompletedJobPatches(
      failedRef,
      [node("n1", "generate-video-pro", {})],
      async () => ({ status: "failed", error_message: "boom", output_data: { videoUrl: "https://r2/v.mp4" } }),
      NOW,
    )
    expect(patches).toEqual([])
  })

  it("end to end: the reconcile lists failures and applies the draft", async () => {
    const updateNodeData = vi.fn()
    await reconcileCompletedSingleNodeJobs(
      "wf-1",
      [node("s1", "generate-3d-scene", {})],
      updateNodeData,
      {
        listCompleted: async () => ({
          data: [
            {
              id: "job-1",
              triggerType: "single-node",
              nodeStates: { s1: { nodeId: "s1", jobId: "job-1", status: "failed" } },
            },
          ],
        }),
        fetchOutput: refusedJob(REV_A),
        nowIso: NOW,
      },
    )
    expect(updateNodeData).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ executionStatus: "failed", errorMessage: REFUSAL }),
    )
    const written = updateNodeData.mock.calls[0][1] as Record<string, unknown>
    expect((written.scenePlan as Record<string, unknown>).revisionId).toBe(REV_A)
  })
})

/**
 * A scrape runs for minutes, so the tab that started it is often not the one
 * open when it lands. Measured: a 20-page site crawl took 252 s, the held
 * request died at the edge ~100 s in, the node said "Web scrape failed" — and
 * the job completed and was charged. Reopening the workflow painted nothing,
 * because this lane knew media URLs and three JSON emitters, and no scraper.
 */
describe("scrape result recovery", () => {
  const T = Date.parse("2026-09-19T18:25:59.000Z")
  const iso = (offsetMs: number) => new Date(T + offsetMs).toISOString()
  const crawl = { pages: [{ url: "https://owalalife.com/", markdown: "# Owala" }] }
  const scrapeItem = (jobId: string, nodeId: string, status: string, createdAt: string) => ({
    ...terminalItem(jobId, nodeId, status),
    createdAt,
  })
  const cutOff = {
    lastRunStartedAt: T - 1_000,
    lastRunOutcome: "failed",
    lastRunAt: T + 100_000,
    errorMessage: "Web scrape failed",
  }
  const completedWith = (json: unknown) => async () => ({ status: "completed", output_data: { json } })

  it("buildCompletedResultPatch writes a scrape's json through the live run's own patch", () => {
    expect(buildCompletedResultPatch("web-scrape", { json: crawl }, "j1", NOW)).toMatchObject({
      executionStatus: "completed",
      lastRunOutcome: "success",
      lastRunCount: 1,
      generatedJson: crawl,
      lastAppliedJobId: "j1",
    })
  })

  it.each(["web-scrape", "meta-ads-scrape", "instagram-scrape"])("recovers a %s node whose run was cut off while its job finished", async (type) => {
    const refs = pickLatestTerminalJobPerNode([scrapeItem("j1", "n1", "completed", iso(0))], { acceptsFailed: () => true })
    const json = type === "web-scrape" ? crawl : [{ caption: "post" }]
    const patches = await computeCompletedJobPatches(refs, [node("n1", type, cutOff)], completedWith(json), NOW)
    expect(patches).toHaveLength(1)
    expect(patches[0].updates).toMatchObject({ lastRunOutcome: "success", generatedJson: json, lastAppliedJobId: "j1" })
  })

  it("recovers over a PREVIOUS good payload — a scrape node keeps one through every failed rerun", async () => {
    const holdsOldResult = { ...cutOff, generatedJson: { pages: [{ url: "old" }] }, lastGoodAt: T - 3_600_000 }
    const refs = pickLatestTerminalJobPerNode([scrapeItem("j1", "n1", "completed", iso(0))])
    const patches = await computeCompletedJobPatches(refs, [node("n1", "web-scrape", holdsOldResult)], completedWith(crawl), NOW)
    expect(patches[0]?.updates).toMatchObject({ generatedJson: crawl })
  })

  it("is idempotent — a second reload does not re-apply the same job", async () => {
    const applied = { ...cutOff, lastRunOutcome: "success", lastAppliedJobId: "j1", generatedJson: crawl }
    const fetchOutput = vi.fn(completedWith(crawl))
    const refs = pickLatestTerminalJobPerNode([scrapeItem("j1", "n1", "completed", iso(0))])
    expect(await computeCompletedJobPatches(refs, [node("n1", "web-scrape", applied)], fetchOutput, NOW)).toEqual([])
    expect(fetchOutput).not.toHaveBeenCalled() // the guard short-circuits before the job lookup
  })

  it("a newer FAILED job shadows the older completed one — a real failure is never papered over", async () => {
    const items = [scrapeItem("j2", "n1", "failed", iso(0)), scrapeItem("j1", "n1", "completed", iso(-600_000))]
    const refs = pickLatestTerminalJobPerNode(items, { acceptsFailed: () => true })
    expect(refs).toEqual([expect.objectContaining({ jobId: "j2", status: "failed" })])
    const fetchOutput = vi.fn(async () => ({ status: "failed", output_data: { error: "Actor run timed out" } }))
    expect(await computeCompletedJobPatches(refs, [node("n1", "web-scrape", cutOff)], fetchOutput, NOW)).toEqual([])
  })

  it("never resurrects a job older than the node's last run", async () => {
    const refs = pickLatestTerminalJobPerNode([scrapeItem("j0", "n1", "completed", iso(-600_000))])
    expect(await computeCompletedJobPatches(refs, [node("n1", "web-scrape", cutOff)], completedWith(crawl), NOW)).toEqual([])
  })

  it("respects a rerun started DURING recovery, not the pre-fetch snapshot", async () => {
    const refs = pickLatestTerminalJobPerNode([scrapeItem("j1", "n1", "completed", iso(0))])
    const patches = await computeCompletedJobPatches(
      refs, [node("n1", "web-scrape", cutOff)], completedWith(crawl), NOW,
      () => ({ ...cutOff, executionStatus: "running" }),
    )
    expect(patches).toEqual([])
  })

  it("reconcileCompletedSingleNodeJobs asks for failed scrape jobs too, so they can shadow", async () => {
    const updateNodeData = vi.fn()
    await reconcileCompletedSingleNodeJobs("wf-1", [node("n1", "web-scrape", cutOff)], updateNodeData, {
      listCompleted: async () => ({
        // j1 is recent enough to pass every OTHER guard — only the newer failed job
        // shadowing it keeps the stale result off the node.
        data: [scrapeItem("j2", "n1", "failed", iso(0)), scrapeItem("j1", "n1", "completed", iso(-30_000))],
      }),
      // Each job answers for itself: j1 really did complete, with a payload. If
      // the failed j2 stopped shadowing it, this is what would land on the node.
      fetchOutput: async (jobId: string) =>
        jobId === "j1" ? { status: "completed", output_data: { json: crawl } } : { status: "failed", output_data: null },
      nowIso: NOW,
    })
    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it("with two completed runs for one node, the NEWER one is what lands — run, 'failed', run again, 'failed' again", async () => {
    // Both runs were cut off at the edge and both jobs completed and were
    // charged. The node records only its latest attempt; that is the job whose
    // pages belong on it.
    const secondRun = { pages: [{ url: "https://owalalife.com/" }, { url: "https://owalalife.com/pages/about" }] }
    const afterSecondFailure = { lastRunStartedAt: T + 1_063_000, lastRunOutcome: "failed", lastRunAt: T + 1_165_000, errorMessage: "Web scrape failed" }
    const fetchOutput = vi.fn(async (jobId: string) => ({
      status: "completed",
      output_data: { json: jobId === "j2" ? secondRun : crawl },
    }))
    const updateNodeData = vi.fn()
    await reconcileCompletedSingleNodeJobs("wf-1", [node("n1", "web-scrape", afterSecondFailure)], updateNodeData, {
      listCompleted: async () => ({
        data: [scrapeItem("j2", "n1", "completed", iso(1_064_000)), scrapeItem("j1", "n1", "completed", iso(0))],
      }),
      fetchOutput,
      nowIso: NOW,
    })
    expect(fetchOutput).toHaveBeenCalledTimes(1)
    expect(fetchOutput).toHaveBeenCalledWith("j2")
    expect(updateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ generatedJson: secondRun, lastAppliedJobId: "j2" }))
  })

  it("reconcileCompletedSingleNodeJobs paints the paid result onto the node that said it failed", async () => {
    const updateNodeData = vi.fn()
    await reconcileCompletedSingleNodeJobs("wf-1", [node("n1", "web-scrape", cutOff)], updateNodeData, {
      listCompleted: async () => ({ data: [scrapeItem("j1", "n1", "completed", iso(0))] }),
      fetchOutput: completedWith(crawl),
      nowIso: NOW,
    })
    expect(updateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ lastRunOutcome: "success", generatedJson: crawl }))
  })
})

/**
 * "Clear results" empties a node ON PURPOSE, and an emptied node is exactly
 * what this lane looks for. The stamp the clear leaves (`resultsClearedAt`) is
 * the only thing that tells "cleared" from "never got its result" — without it
 * every reload brings back whatever the person just cleared.
 */
describe("a node emptied by Clear results", () => {
  const CLEARED_AT = "2026-09-20T10:00:00.000Z"
  const BEFORE = "2026-09-20T09:00:00.000Z"
  const AFTER = "2026-09-20T11:00:00.000Z"
  const videoJob = async () => ({ status: "completed", output_data: { videoUrl: "https://cdn.test/v.mp4" } })
  const timedItem = (jobId: string, nodeId: string, times: { createdAt?: string; completedAt?: string }) => ({
    ...completedItem(jobId, nodeId),
    ...times,
  })

  it("carries the job's settle time on the ref — completion first, creation as the fallback", () => {
    expect(pickLatestTerminalJobPerNode([timedItem("j1", "n1", { createdAt: BEFORE, completedAt: AFTER })])[0].settledAt).toBe(AFTER)
    expect(pickLatestTerminalJobPerNode([timedItem("j1", "n1", { createdAt: BEFORE })])[0].settledAt).toBe(BEFORE)
  })

  it("stays empty: a job that settled BEFORE the clear is not painted back (and is never even fetched)", async () => {
    const fetchOutput = vi.fn(videoJob)
    const refs = pickLatestTerminalJobPerNode([timedItem("j1", "n1", { createdAt: BEFORE, completedAt: BEFORE })])
    const nodes = [node("n1", "generate-video-pro", { prompt: "p", resultsClearedAt: CLEARED_AT })]
    expect(await computeCompletedJobPatches(refs, nodes, fetchOutput, NOW)).toEqual([])
    expect(fetchOutput).not.toHaveBeenCalled()
  })

  it("still recovers a job that settled AFTER the clear — a run started after it, finished with the tab closed", async () => {
    const refs = pickLatestTerminalJobPerNode([timedItem("j2", "n1", { createdAt: AFTER, completedAt: AFTER })])
    const nodes = [node("n1", "generate-video-pro", { prompt: "p", resultsClearedAt: CLEARED_AT })]
    const patches = await computeCompletedJobPatches(refs, nodes, videoJob, NOW)
    expect(patches).toHaveLength(1)
    expect(patches[0].updates.generatedVideoUrl).toBe("https://cdn.test/v.mp4")
  })

  it("a long job STARTED before the clear but finished after it is judged by when it finished", async () => {
    const refs = pickLatestTerminalJobPerNode([timedItem("j3", "n1", { createdAt: BEFORE, completedAt: AFTER })])
    const nodes = [node("n1", "generate-video-pro", { prompt: "p", resultsClearedAt: CLEARED_AT })]
    expect(await computeCompletedJobPatches(refs, nodes, videoJob, NOW)).toHaveLength(1)
  })

  it("an un-cleared node beside it is recovered exactly as before", async () => {
    const refs = pickLatestTerminalJobPerNode([timedItem("j1", "n1", { completedAt: BEFORE }), timedItem("j4", "n2", { completedAt: BEFORE })])
    const nodes = [
      node("n1", "generate-video-pro", { prompt: "p", resultsClearedAt: CLEARED_AT }),
      node("n2", "generate-video-pro", { prompt: "p" }),
    ]
    const patches = await computeCompletedJobPatches(refs, nodes, videoJob, NOW)
    expect(patches.map((p) => p.nodeId)).toEqual(["n2"])
  })

  it("respects a clear made WHILE the job lookup was in flight", async () => {
    const refs = pickLatestTerminalJobPerNode([timedItem("j1", "n1", { completedAt: BEFORE })])
    const nodes = [node("n1", "generate-video-pro", { prompt: "p" })]
    const live = () => ({ prompt: "p", resultsClearedAt: CLEARED_AT })
    expect(await computeCompletedJobPatches(refs, nodes, videoJob, NOW, live)).toEqual([])
  })

  it("holds for the node types that have their OWN recovery guard — the clear is asked first", async () => {
    const sceneJob = async () => ({ status: "completed", output_data: { scenePlan: { revisionId: "r9", objects: [] } } })
    const sceneRefs = pickLatestTerminalJobPerNode([timedItem("j5", "sc", { completedAt: BEFORE })])
    const scene = [node("sc", "generate-3d-scene", { resultsClearedAt: CLEARED_AT })]
    expect(await computeCompletedJobPatches(sceneRefs, scene, sceneJob, NOW)).toEqual([])

    const scrapeJob = async () => ({ status: "completed", output_data: { json: { results: [{ url: "https://a.test" }] } } })
    const scrapeRefs = pickLatestTerminalJobPerNode([timedItem("j6", "ws", { createdAt: BEFORE, completedAt: BEFORE })])
    const scraper = [node("ws", "web-scrape", { resultsClearedAt: CLEARED_AT })]
    expect(await computeCompletedJobPatches(scrapeRefs, scraper, scrapeJob, NOW)).toEqual([])
  })
})

describe("buildCompletedResultPatch — Video Overlay run facts (reload recovery)", () => {
  const clipped = { layer: 0, slot: 1, code: "clipped", detail: "ends at 8 s, clipped to the video end (5.00 s)" }
  it("puts the worker's warnings, canvas and length on the node and on the recovered result", () => {
    const patch = buildCompletedResultPatch(
      "video-overlay",
      { videoUrl: "https://r2/o.mp4", warnings: [clipped], width: 1080, height: 1920, durationSec: 5 },
      "job-vo",
      NOW,
    )!
    expect(patch).toMatchObject({ generatedVideoUrl: "https://r2/o.mp4", warnings: [clipped], width: 1080, height: 1920, durationSec: 5 })
    expect((patch.generatedResults as Array<Record<string, unknown>>)[0]).toMatchObject({ jobId: "job-vo", warnings: [clipped], durationSec: 5 })
  })
  it("stamps the freshness key a backend run carried on the node and on the recovered result; none → undefined (reads old)", () => {
    const patch = buildCompletedResultPatch("video-overlay", { videoUrl: "https://r2/o.mp4", resultCompositionKey: "K1" }, "job-vo", NOW)!
    expect(patch.resultCompositionKey).toBe("K1")
    expect((patch.generatedResults as Array<Record<string, unknown>>)[0]).toMatchObject({ resultCompositionKey: "K1" })
    const plain = buildCompletedResultPatch("video-overlay", { videoUrl: "https://r2/o.mp4" }, "job-vo", NOW)!
    expect((plain.generatedResults as Array<Record<string, unknown>>)[0]!.resultCompositionKey).toBeUndefined()
  })
  it("no warnings in the output → an empty list (a stale line is overwritten)", () => {
    const patch = buildCompletedResultPatch("video-overlay", { videoUrl: "https://r2/o.mp4" }, "job-vo", NOW)!
    expect(patch.warnings).toEqual([])
  })
  it("other nodes get no such keys", () => {
    const patch = buildCompletedResultPatch("generate-video-pro", { videoUrl: "https://r2/v.mp4", warnings: [clipped] }, "j", NOW)!
    expect("warnings" in patch).toBe(false)
  })
})
