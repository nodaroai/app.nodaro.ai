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
