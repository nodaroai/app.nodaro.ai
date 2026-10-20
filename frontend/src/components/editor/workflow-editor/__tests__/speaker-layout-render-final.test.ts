// @test-units-by-name checks only the speaker-layout entries it names
/**
 * Speaker Layout's Preview → Render final on the canvas (decided 2026-10-17):
 * a layout frames the whole recording, so its run has no plan and nothing to
 * review. The Preview take its run made offers Render final (the node's bar),
 * the review inspector is never offered, and the continuation is sent with no
 * edit — the server refuses one (`use_case_no_plan`) — even when the node holds
 * a stray edit (one written as workflow JSON or by an agent). Chosen by the
 * type's result kind, never by its id.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

/* eslint-disable @typescript-eslint/no-explicit-any */
const api = vi.hoisted(() => ({
  runUseCase: vi.fn(),
  continueUseCase: vi.fn(),
  getJobStatus: vi.fn(),
}))
const store = vi.hoisted(() => ({
  nodes: [] as any[],
  edges: [] as any[],
  updateNodeData: vi.fn(),
}))
const poll = vi.hoisted(() => ({
  calls: [] as Array<{ keys: unknown; label: string; landed: Record<string, unknown>; take: Record<string, unknown> }>,
  output: {} as Record<string, unknown>,
}))

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("@/lib/api", () => api)
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ nodes: store.nodes, edges: store.edges, updateNodeData: store.updateNodeData }) },
}))
vi.mock("../poll-job", () => ({
  pollJobWithNodeUpdate: async (_nodeId: string, apiCall: () => Promise<{ jobId: string }>, keys: unknown, label: string, _ctx: unknown, extra: any, _est: unknown, opts: any) => {
    await apiCall()
    poll.calls.push({ keys, label, landed: extra?.(poll.output) ?? {}, take: opts?.resultFields?.(poll.output) ?? {} })
    return String(poll.output.videoUrl ?? "")
  },
}))

import { executeUseCase } from "../use-case-executor"
import { usecaseRenderFinalOffered } from "../use-case-render-final-set"
import { usecaseReviewable } from "@/lib/edl-review/use-case-review-source"
import { usecaseFailedRunFields, usecaseRunResultFields, usecaseTakeResultFields } from "@/lib/use-case-run-result"

const JOB = "00000000-0000-4000-8000-000000000001"
const DRAWN = { version: 1, segments: [{ start: 0, end: 60 }], dropped: [], layout: { type: "stacked" } }
const STRAY_EDIT = { v: 1, kind: "edl", basis: "0000000000000000", edl: { segments: [{ start: 20, end: 30 }], dropped: [] } }

const ctx = (): any => ({
  userId: "00000000-0000-4000-8000-0000000000aa",
  isWorkflowStale: () => false,
  trackInterval: (i: unknown) => i,
  untrackInterval: () => {},
})

/** A review-on Speaker Layout holding the Preview its run made. */
function previewNode(over: Record<string, unknown> = {}): any {
  const node = {
    id: "sl1",
    type: "speaker-layout",
    position: { x: 0, y: 0 },
    data: {
      label: "Speaker Layout",
      fieldMappings: {},
      reviewBeforeRender: true,
      executionStatus: "completed",
      generatedVideoUrl: "https://r2/p.mp4",
      generatedJson: DRAWN,
      generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", jobId: JOB }],
      activeResultIndex: 0,
      useCaseJobId: JOB,
      ...over,
    },
  }
  store.nodes = [node]
  return node
}

beforeEach(() => {
  api.runUseCase.mockReset()
  api.continueUseCase.mockReset()
  store.updateNodeData.mockReset()
  store.nodes = []
  store.edges = []
  poll.calls = []
  poll.output = {}
})

describe("Speaker Layout: Preview → Render final", () => {
  it("its Preview take offers Render final (the node's bar), and a Final take does not", () => {
    expect(usecaseRenderFinalOffered(previewNode())).toBe(true)
    expect(usecaseRenderFinalOffered(previewNode({ generatedResults: [{ url: "https://r2/f.mp4", quality: "final", jobId: JOB }] }))).toBe(false)
  })

  it("the review inspector is never offered: a layout has no plan, even with an EDL on the node", () => {
    const node = previewNode()
    expect(usecaseReviewable(node.id, [node], [])).toBe(false)
  })

  it("Render final continues the Preview's own run with no edit — never the node's stray one, nor one handed to the run", async () => {
    api.continueUseCase.mockResolvedValue({ kind: "started", jobId: "job-final" })
    poll.output = { videoUrl: "https://r2/f.mp4", quality: "final", json: DRAWN }
    const node = previewNode({ editedEdl: STRAY_EDIT })
    await executeUseCase(node, {} as never, ctx(), { usecaseContinue: { mode: "render-final", jobId: JOB, editedEdl: STRAY_EDIT } })
    expect(api.continueUseCase).toHaveBeenCalledTimes(1)
    const sent = api.continueUseCase.mock.calls[0]![0]
    expect(sent).toEqual(expect.objectContaining({ nodeType: "speaker-layout", mode: "render-final", jobId: JOB, nodeId: "sl1" }))
    expect(sent).not.toHaveProperty("editedEdl")
  })

  it("the final lands as the node's take: the framed video, the edit its render drew as held, the transcript and the cameras report", async () => {
    api.continueUseCase.mockResolvedValue({ kind: "started", jobId: "job-final" })
    const cameras = { speakers: [{ speaker: "speaker_0", ordinal: 1, camera: 1, marginDb: 6 }], syncNotes: [], mapNotes: [] }
    poll.output = { videoUrl: "https://r2/f.mp4", quality: "final", json: DRAWN, transcript: { words: [] }, cameras, renderBasis: "0123456789abcdef", _executionId: "exec-9" }
    await executeUseCase(previewNode(), {} as never, ctx(), { usecaseContinue: { mode: "render-final", jobId: JOB } })
    const [landing] = poll.calls
    expect(landing!.keys).toContain("generatedVideoUrl")
    expect(landing!.label).toBe("Speaker Layout")
    expect(landing!.landed).toMatchObject({ generatedJson: DRAWN, generatedTranscript: { words: [] }, useCaseExecutionId: "exec-9" })
    expect(landing!.take).toMatchObject({ quality: "final", renderBasis: "0123456789abcdef", generatedJson: DRAWN })
  })
})

describe("Speaker Layout: a server run lands as the canvas's own does (every lane's one mapping)", () => {
  const cameras = { speakers: [{ speaker: "speaker_0", ordinal: 1, camera: 1, marginDb: 6 }], syncNotes: [], mapNotes: [] }
  const output = { videoUrl: "https://r2/p.mp4", quality: "proxy", json: DRAWN, transcript: { words: [] }, cameras, renderBasis: "0123456789abcdef", useCaseSettings: { targetAspect: "9:16" } }

  it("the framed video, the drawn edit as held (a stray edit cleared), the transcript, the cameras report and the wrapper job", () => {
    expect(usecaseRunResultFields("speaker-layout", output, { editedEdl: STRAY_EDIT }, JOB)).toEqual({
      generatedVideoUrl: "https://r2/p.mp4",
      generatedAudioUrl: undefined,
      generatedJson: DRAWN,
      editedEdl: undefined,
      generatedTranscript: { words: [] },
      useCaseCameras: cameras,
      useCaseJobId: JOB,
    })
  })

  it("its take is stamped like an episode's: the Preview's quality and render basis, the run's edit, transcript and settings", () => {
    expect(usecaseTakeResultFields("speaker-layout", output)).toMatchObject({
      quality: "proxy",
      renderBasis: "0123456789abcdef",
      generatedJson: DRAWN,
      generatedTranscript: { words: [] },
      useCaseSettings: { targetAspect: "9:16" },
    })
  })

  it("a failed run keeps what it finished and its wrapper, so Continue can pick it up", () => {
    expect(usecaseFailedRunFields("speaker-layout", { json: DRAWN, transcript: { words: [] } }, {}, JOB)).toMatchObject({ generatedJson: DRAWN, generatedTranscript: { words: [] }, useCaseJobId: JOB })
  })
})
