import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  getJobStatusLean: vi.fn(),
}))

vi.mock("../api", () => ({
  getJobStatusLean: mocks.getJobStatusLean,
}))

// `buildVariantResults` is pure logic in @nodaro/shared-adjacent code — no
// mock needed. The test relies on its real behavior.

import { computeReconciledNodeResults } from "../reconcile-node-results"
import type { WorkflowNode } from "@/types/nodes"

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown>,
): WorkflowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  } as unknown as WorkflowNode
}

const baseJobId = "5542fce6-61e8-44b2-a6e2-f4184eafe734"

describe("computeReconciledNodeResults", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rebuilds generatedResults when output_data.audioUrls has more variants than node knows about", async () => {
    // The user's actual case: Suno returned 2 tracks, backend reconcile wrote
    // both into output_data, but the frontend's stale poll only ever wrote 1.
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: baseJobId,
      status: "completed",
      output_data: {
        audioUrl: `https://cdn/${baseJobId}.wav`,
        audioUrls: [
          `https://cdn/${baseJobId}.wav`,
          `https://cdn/${baseJobId}-v1.wav`,
        ],
        sunoTrackId: "track-1",
        sunoTaskId: "kie-task-1",
      },
    })

    const node = makeNode("node_8", "suno-generate", {
      executionStatus: "completed",
      generatedResults: [
        { url: `https://cdn/${baseJobId}.wav`, jobId: baseJobId, timestamp: "2026-05-20T20:00:05Z" },
      ],
    })

    const updates = await computeReconciledNodeResults([node])
    expect(updates).toHaveLength(1)
    expect(updates[0].nodeId).toBe("node_8")
    expect(updates[0].generatedResults).toHaveLength(2)
    expect(updates[0].generatedResults[0].url).toBe(`https://cdn/${baseJobId}.wav`)
    expect(updates[0].generatedResults[0].jobId).toBe(baseJobId)
    expect(updates[0].generatedResults[1].url).toBe(`https://cdn/${baseJobId}-v1.wav`)
    expect(updates[0].generatedResults[1].jobId).toBe(`${baseJobId}-v1`)
    // Suno extras propagated. `extraFields` spread isn't part of the
    // GeneratedResult type signature, so widen for the assertion.
    const first = updates[0].generatedResults[0] as unknown as Record<string, unknown>
    expect(first.sunoTrackId).toBe("track-1")
    expect(first.sunoTaskId).toBe("kie-task-1")
  })

  it("falls back to sunoTracks[].audioUrl when audioUrls array is missing", async () => {
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: baseJobId,
      status: "completed",
      output_data: {
        audioUrl: `https://cdn/${baseJobId}.wav`,
        sunoTracks: [
          { id: "1", audioUrl: `https://cdn/${baseJobId}.wav` },
          { id: "2", audioUrl: `https://cdn/${baseJobId}-v1.wav` },
        ],
      },
    })

    const node = makeNode("node_8", "suno-generate", {
      executionStatus: "completed",
      generatedResults: [
        { url: `https://cdn/${baseJobId}.wav`, jobId: baseJobId, timestamp: "2026-05-20T20:00:05Z" },
      ],
    })

    const updates = await computeReconciledNodeResults([node])
    expect(updates).toHaveLength(1)
    expect(updates[0].generatedResults).toHaveLength(2)
  })

  it("handles image variants (imageUrls)", async () => {
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: "img-base",
      status: "completed",
      output_data: {
        imageUrl: "https://cdn/img.png",
        imageUrls: [
          "https://cdn/img.png",
          "https://cdn/img-v1.png",
          "https://cdn/img-v2.png",
          "https://cdn/img-v3.png",
        ],
      },
    })

    const node = makeNode("node_5", "generate-image", {
      executionStatus: "completed",
      generatedResults: [
        { url: "https://cdn/img.png", jobId: "img-base", timestamp: "2026-05-20T20:00:05Z" },
      ],
    })

    const updates = await computeReconciledNodeResults([node])
    expect(updates).toHaveLength(1)
    expect(updates[0].generatedResults).toHaveLength(4)
  })

  it("strips -v<n> suffix when looking up the canonical job", async () => {
    // The node could already have a partial multi-variant result whose first
    // entry has a `-v1` suffix; we still want to look up the BASE job.
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: baseJobId,
      status: "completed",
      output_data: {
        audioUrl: `https://cdn/${baseJobId}.wav`,
        audioUrls: [`https://cdn/${baseJobId}.wav`, `https://cdn/${baseJobId}-v1.wav`],
      },
    })

    const node = makeNode("node_8", "suno-generate", {
      executionStatus: "completed",
      generatedResults: [
        // Note: first entry's jobId includes -v1 — should still resolve.
        { url: `https://cdn/${baseJobId}-v1.wav`, jobId: `${baseJobId}-v1`, timestamp: "2026-05-20T20:00:05Z" },
      ],
    })

    await computeReconciledNodeResults([node])
    expect(mocks.getJobStatusLean).toHaveBeenCalledWith(baseJobId)
  })

  it("no-op when generatedResults already matches output_data length", async () => {
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: baseJobId,
      status: "completed",
      output_data: {
        audioUrl: `https://cdn/${baseJobId}.wav`,
        audioUrls: [`https://cdn/${baseJobId}.wav`, `https://cdn/${baseJobId}-v1.wav`],
      },
    })

    const node = makeNode("node_8", "suno-generate", {
      executionStatus: "completed",
      generatedResults: [
        { url: `https://cdn/${baseJobId}.wav`, jobId: baseJobId, timestamp: "x" },
        { url: `https://cdn/${baseJobId}-v1.wav`, jobId: `${baseJobId}-v1`, timestamp: "x" },
      ],
    })

    const updates = await computeReconciledNodeResults([node])
    expect(updates).toHaveLength(0)
  })

  it("skips nodes that aren't executionStatus=completed", async () => {
    const node = makeNode("node_8", "suno-generate", {
      executionStatus: "running",
      generatedResults: [
        { url: "x", jobId: baseJobId, timestamp: "x" },
      ],
    })

    const updates = await computeReconciledNodeResults([node])
    expect(updates).toHaveLength(0)
    expect(mocks.getJobStatusLean).not.toHaveBeenCalled()
  })

  it("skips nodes with no generatedResults to anchor a jobId lookup", async () => {
    const node = makeNode("node_8", "suno-generate", {
      executionStatus: "completed",
      generatedResults: [],
    })

    const updates = await computeReconciledNodeResults([node])
    expect(updates).toHaveLength(0)
    expect(mocks.getJobStatusLean).not.toHaveBeenCalled()
  })

  it("silently swallows getJobStatusLean failures (best-effort)", async () => {
    mocks.getJobStatusLean.mockRejectedValueOnce(new Error("network blip"))

    const node = makeNode("node_8", "suno-generate", {
      executionStatus: "completed",
      generatedResults: [{ url: "x", jobId: baseJobId, timestamp: "x" }],
    })

    const updates = await computeReconciledNodeResults([node])
    expect(updates).toHaveLength(0)
  })

  it("skips jobs that aren't completed yet", async () => {
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: baseJobId,
      status: "processing",
      output_data: null,
    })

    const node = makeNode("node_8", "suno-generate", {
      executionStatus: "completed",
      generatedResults: [{ url: "x", jobId: baseJobId, timestamp: "x" }],
    })

    const updates = await computeReconciledNodeResults([node])
    expect(updates).toHaveLength(0)
  })
})
