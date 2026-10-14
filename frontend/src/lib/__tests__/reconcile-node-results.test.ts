// @vitest-environment node
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
        { url: "https://cdn/img.png", jobId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", timestamp: "2026-05-20T20:00:05Z" },
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

  it("skips synthetic non-UUID jobIds (exec-node_*, upload-url-*) instead of polling them as backend jobs", async () => {
    // The production "404 storm": reconcile sent local placeholder ids to
    // GET /v1/jobs/:id/status, which 404 on every workflow load. A real backend
    // job id is always a UUID; these synthetic ids must be skipped entirely.
    const synthNode = makeNode("node_4", "generate-video", {
      executionStatus: "completed",
      generatedResults: [
        { url: "https://cdn/x.mp4", jobId: "exec-node_4", timestamp: "x" },
      ],
    })
    const uploadNode = makeNode("node_9", "upload-image", {
      executionStatus: "completed",
      generatedResults: [
        { url: "https://cdn/y.png", jobId: "upload-url-1780778224300", timestamp: "x" },
      ],
    })

    const updates = await computeReconciledNodeResults([synthNode, uploadNode])

    expect(updates).toHaveLength(0)
    expect(mocks.getJobStatusLean).not.toHaveBeenCalled()
  })

  it("still reconciles real UUID jobIds, including -v<n> variants (guard strips suffix first)", async () => {
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: baseJobId,
      status: "completed",
      output_data: {
        audioUrls: [`https://cdn/${baseJobId}.wav`, `https://cdn/${baseJobId}-v1.wav`],
      },
    })

    const node = makeNode("node_8", "suno-generate", {
      executionStatus: "completed",
      generatedResults: [
        { url: `https://cdn/${baseJobId}-v1.wav`, jobId: `${baseJobId}-v1`, timestamp: "x" },
      ],
    })

    const updates = await computeReconciledNodeResults([node])
    expect(mocks.getJobStatusLean).toHaveBeenCalledWith(baseJobId)
    expect(updates).toHaveLength(1)
  })
})

describe("computeReconciledNodeResults — per-track Suno ids (#819)", () => {
  it("rebuilt variants each carry their OWN sunoTrackId from output_data.sunoTracks", async () => {
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: baseJobId,
      status: "completed",
      output_data: {
        audioUrl: `https://cdn/${baseJobId}.wav`,
        audioUrls: [`https://cdn/${baseJobId}.wav`, `https://cdn/${baseJobId}-v1.wav`],
        sunoTrackId: "track-1",
        sunoTaskId: "task-9",
        sunoTracks: [
          { id: "track-1", audioUrl: `https://cdn/${baseJobId}.wav` },
          { id: "track-2", audioUrl: `https://cdn/${baseJobId}-v1.wav` },
        ],
      },
    })
    const node = makeNode("node_9", "suno-generate", {
      executionStatus: "completed",
      generatedResults: [{ url: `https://cdn/${baseJobId}.wav`, jobId: baseJobId, timestamp: "t" }],
    })
    const updates = await computeReconciledNodeResults([node])
    expect(updates).toHaveLength(1)
    const [first, second] = updates[0]!.generatedResults
    expect(first!.sunoTrackId).toBe("track-1")
    expect(second!.sunoTrackId).toBe("track-2")
    expect(second!.sunoTaskId).toBe("task-9")
  })
})

describe("computeReconciledNodeResults — transcribe transcript backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // A UUID job whose transcribe result predates the structured `transcript`
  // field (the real prod shape: { text, jobId, timestamp } — no transcript, no
  // language). The worker of record still holds output_data.json.
  const tJob = "df53f6e8-9d7f-4a4c-8162-b0c41cfea0be"
  const transcript = {
    language: "en",
    segments: [{ start: 0, end: 1.2, text: "Hello there" }],
    words: [
      { start: 0, end: 0.5, text: "Hello" },
      { start: 0.6, end: 1.2, text: "there" },
    ],
  }

  it("backfills a completed transcribe result missing its structured transcript from output_data.json", async () => {
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: tJob,
      status: "completed",
      output_data: { text: "Hello there", language: "en", json: transcript },
    })

    const node = makeNode("transcribe-1", "transcribe", {
      executionStatus: "completed",
      activeResultIndex: 0,
      generatedResults: [{ text: "Hello there", jobId: tJob, timestamp: "2026-09-18T00:00:00Z" }],
    })

    const updates = await computeReconciledNodeResults([node])
    expect(updates).toHaveLength(1)
    expect(updates[0]!.nodeId).toBe("transcribe-1")
    // The `json` handle reads generatedResults[i].transcript ?? generatedJson —
    // both are written for parity with a live run.
    expect((updates[0]!.generatedResults[0] as { transcript?: unknown }).transcript).toEqual(transcript)
    expect(updates[0]!.generatedJson).toEqual(transcript)
    expect(updates[0]!.activeResultIndex).toBe(0)
  })

  it("is idempotent when the active transcribe result already carries a transcript", async () => {
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: tJob,
      status: "completed",
      output_data: { text: "Hello there", json: transcript },
    })

    const node = makeNode("transcribe-1", "transcribe", {
      executionStatus: "completed",
      activeResultIndex: 0,
      generatedResults: [{ text: "Hello there", jobId: tJob, timestamp: "t", transcript }],
    })

    const updates = await computeReconciledNodeResults([node])
    expect(updates).toHaveLength(0)
  })

  it("is idempotent when the node already has a bare generatedJson", async () => {
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: tJob,
      status: "completed",
      output_data: { text: "Hello there", json: transcript },
    })

    const node = makeNode("transcribe-1", "transcribe", {
      executionStatus: "completed",
      activeResultIndex: 0,
      generatedJson: transcript,
      generatedResults: [{ text: "Hello there", jobId: tJob, timestamp: "t" }],
    })

    const updates = await computeReconciledNodeResults([node])
    expect(updates).toHaveLength(0)
  })

  it("preserves a non-zero active index and only patches the active row", async () => {
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: tJob,
      status: "completed",
      output_data: { text: "second", json: transcript },
    })

    const node = makeNode("transcribe-1", "transcribe", {
      executionStatus: "completed",
      activeResultIndex: 1,
      generatedResults: [
        { text: "first", jobId: tJob, timestamp: "t0" },
        { text: "second", jobId: tJob, timestamp: "t1" },
      ],
    })

    const updates = await computeReconciledNodeResults([node])
    expect(updates).toHaveLength(1)
    expect(updates[0]!.activeResultIndex).toBe(1)
    expect((updates[0]!.generatedResults[1] as { transcript?: unknown }).transcript).toEqual(transcript)
    expect((updates[0]!.generatedResults[0] as { transcript?: unknown }).transcript).toBeUndefined()
  })

  it("does not backfill when the completed job carries no output_data.json", async () => {
    mocks.getJobStatusLean.mockResolvedValueOnce({
      id: tJob,
      status: "completed",
      output_data: { text: "Hello there" },
    })

    const node = makeNode("transcribe-1", "transcribe", {
      executionStatus: "completed",
      activeResultIndex: 0,
      generatedResults: [{ text: "Hello there", jobId: tJob, timestamp: "t" }],
    })

    const updates = await computeReconciledNodeResults([node])
    expect(updates).toHaveLength(0)
  })
})
