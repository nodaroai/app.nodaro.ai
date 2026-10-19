/**
 * A Trailer run whose tab closed mid-run reopens with EVERY format landed as
 * results — one row per format, each naming the run's wrapper with the run's
 * render stamps, the same rows a live run lands — on the job-restore lanes:
 * the resumed poll's restore (run-handlers) and the reconcile of a job that
 * finished while the editor was closed. A format that failed is named.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import type { WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { buildCompletedResultPatch } from "@/lib/reconcile-completed-jobs"
import { applyRestoredJobCompletion, paintRunStates } from "../run-handlers"

const JOB = "00000000-0000-4000-8000-0000000000d1"
const OUTPUT = {
  videoUrl: "https://r2/t-916.mp4",
  formats: [{ format: "9:16", url: "https://r2/t-916.mp4" }, { format: "1:1", url: "https://r2/t-11.mp4" }],
  failedFormats: ["4:5"],
  json: { version: 1, segments: [] },
  transcript: { version: 1, words: [] },
  quality: "final",
  planBasis: "0123456789abcdef",
  renderBasis: "fedcba9876543210",
  useCaseSettings: { formats: ["9:16", "1:1", "4:5"] },
}
const EARLIER = { url: "https://r2/old.mp4", jobId: "job-0", quality: "final", format: "9:16", timestamp: "t0" }

/** Every format of the run, as a live run lands it. */
function expectEveryFormat(results: ReadonlyArray<Record<string, unknown>>) {
  expect(results.slice(0, 2).map((r) => [r.url, r.format, r.jobId, r.quality, r.planBasis, r.renderBasis])).toEqual([
    ["https://r2/t-916.mp4", "9:16", JOB, "final", "0123456789abcdef", "fedcba9876543210"],
    ["https://r2/t-11.mp4", "1:1", JOB, "final", "0123456789abcdef", "fedcba9876543210"],
  ])
  // Every row keeps the run's plan and settings, so a chip's pick restores them, and names the format the run failed.
  expect(results[1]).toMatchObject({ generatedJson: OUTPUT.json, useCaseSettings: OUTPUT.useCaseSettings, failedFormats: ["4:5"] })
}

/** The node's row stamps every lane writes (the server's `listResultStamps` shape). */
const STAMP = { quality: "final", planBasis: "0123456789abcdef", renderBasis: "fedcba9876543210", jobId: JOB }

const dataOf = () => useWorkflowStore.getState().nodes[0]!.data as Record<string, unknown>

afterEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})

describe("the resumed poll's restore lands every format of a Trailer run", () => {
  it("one row per format, ahead of the earlier results; the list, the first on show, and the failed format named", () => {
    const node = { id: "tr", type: "episode-trailer", position: { x: 0, y: 0 }, data: { label: "Trailer", fieldMappings: {}, executionStatus: "running", currentJobId: JOB, generatedResults: [EARLIER] } } as unknown as WorkflowNode
    act(() => useWorkflowStore.setState({ nodes: [node], edges: [] }))
    act(() => applyRestoredJobCompletion("tr", "episode-trailer", { output_data: OUTPUT }, JOB))
    const data = dataOf()
    const results = data.generatedResults as Array<Record<string, unknown>>
    expectEveryFormat(results)
    expect(results.map((r) => r.url)).toEqual(["https://r2/t-916.mp4", "https://r2/t-11.mp4", EARLIER.url])
    expect(data).toMatchObject({
      executionStatus: "completed",
      activeResultIndex: 0,
      generatedVideoUrl: "https://r2/t-916.mp4",
      __listResults: ["https://r2/t-916.mp4", "https://r2/t-11.mp4"],
      failedFormats: ["4:5"],
      useCaseJobId: JOB,
      __listResultStamps: [STAMP, STAMP],
    })
  })
})

describe("the live server-run lane writes the same row stamps", () => {
  it("every format a row, each stamp {quality, bases, wrapper}", () => {
    const node = { id: "tr", type: "episode-trailer", position: { x: 0, y: 0 }, data: { label: "Trailer", fieldMappings: {} } } as unknown as WorkflowNode
    act(() => useWorkflowStore.setState({ nodes: [node], edges: [] }))
    const state = {
      status: "completed", startedAt: "2026-10-18T10:00:00.000Z", completedAt: "2026-10-18T10:05:00.000Z", jobId: JOB,
      output: { ...OUTPUT, listResults: OUTPUT.formats.map((f) => f.url), listResultStamps: [STAMP, STAMP] },
    }
    act(() => paintRunStates({ tr: state } as never))
    const data = dataOf()
    expectEveryFormat(data.generatedResults as Array<Record<string, unknown>>)
    expect(data.__listResultStamps).toEqual([STAMP, STAMP])
  })
})

describe("the reconcile of a Trailer job that finished while the editor was closed", () => {
  it("lands every format, and names the failed one", () => {
    const patch = buildCompletedResultPatch("episode-trailer", OUTPUT, JOB, "2026-10-18T10:00:00.000Z", {})!
    expectEveryFormat(patch.generatedResults as Array<Record<string, unknown>>)
    expect((patch.generatedResults as unknown[]).length).toBe(2)
    expect(patch).toMatchObject({ executionStatus: "completed", activeResultIndex: 0, failedFormats: ["4:5"], __listResults: ["https://r2/t-916.mp4", "https://r2/t-11.mp4"], __listResultStamps: [STAMP, STAMP] })
  })

  it("a Tighten Episode job keeps its one take", () => {
    const patch = buildCompletedResultPatch("tighten-episode", { videoUrl: "https://r2/ep.mp4", quality: "final" }, JOB, "t", {})!
    expect((patch.generatedResults as unknown[]).length).toBe(1)
  })
})
