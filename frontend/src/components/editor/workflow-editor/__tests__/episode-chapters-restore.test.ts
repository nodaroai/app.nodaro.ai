/**
 * A Chapters run whose poll died (a reload mid-run — its runs last up to
 * hours) is landed by the restore lane when its job completes: the show notes
 * and chapter list, no URL needed, and no empty take.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import type { WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyRestoredJobCompletion, paintRunStates } from "../run-handlers"

const NOTES = "0:00 Intro\n12:34 Main"
const ROWS = [{ startMs: 0, title: "Intro" }, { startMs: 754_000, title: "Main" }]
const JOB = "00000000-0000-4000-8000-0000000000c1"

const dataOf = () => useWorkflowStore.getState().nodes[0]!.data as Record<string, unknown>

afterEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})

describe("the restore lane lands a Chapters run", () => {
  it("completed, with its show notes, list, transcript and wrapper — and no take", () => {
    const node = { id: "c1", type: "episode-chapters", position: { x: 0, y: 0 }, data: { label: "Chapters", fieldMappings: {}, executionStatus: "running", currentJobId: JOB } } as unknown as WorkflowNode
    act(() => useWorkflowStore.setState({ nodes: [node], edges: [] }))
    act(() => applyRestoredJobCompletion("c1", "episode-chapters", { output_data: { text: NOTES, json: ROWS, transcript: { words: [] } } }, JOB))
    expect(dataOf()).toMatchObject({
      executionStatus: "completed",
      generatedText: NOTES,
      generatedJson: ROWS,
      generatedTranscript: { words: [] },
      useCaseJobId: JOB,
      currentJobId: undefined,
    })
    expect(dataOf().generatedResults).toBeUndefined()
  })
})

describe("the live server-run lane lands a Chapters run the canvas's way", () => {
  it("its show notes and list on the node, and no text history in its results", () => {
    const node = { id: "c1", type: "episode-chapters", position: { x: 0, y: 0 }, data: { label: "Chapters", fieldMappings: {} } } as unknown as WorkflowNode
    act(() => useWorkflowStore.setState({ nodes: [node], edges: [] }))
    const state = { status: "completed", startedAt: "2026-10-17T10:00:00.000Z", completedAt: "2026-10-17T10:05:00.000Z", jobId: JOB, output: { text: NOTES, json: ROWS } }
    act(() => paintRunStates({ c1: state } as never))
    expect(dataOf()).toMatchObject({ executionStatus: "completed", generatedText: NOTES, generatedJson: ROWS, useCaseJobId: JOB })
    expect(dataOf().generatedResults).toBeUndefined()
  })
})
