/**
 * The canvas Run of an Edit Plan node sends the mode AS SAVED (decided
 * 2026-10-06). It used to coerce an unknown mode to `tighten`, so a node
 * written with a mode this app does not know was planned and charged as a
 * tighten cut. Now `POST /v1/edit-plan` sees the real mode and refuses an
 * unknown or undeclared one before anything is charged, with the message
 * every lane uses. An absent mode is the node default, tighten.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

const api = vi.hoisted(() => ({ editPlan: vi.fn() }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  editPlan: api.editPlan,
}))
vi.mock("../poll-job", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../poll-job")>()),
  getJobStatusLeanForNode: vi.fn(() => Promise.resolve({ status: "completed", output_data: { version: 1, sources: [], segments: [] } })),
}))
vi.mock("../node-input-resolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../node-input-resolver")>()),
  resolveNodeInputs: vi.fn(() => ({
    transcript: JSON.stringify({ version: 1, words: [{ text: "hi", startMs: 0, endMs: 500 }] }),
    editPlanSources: [{ nodeId: "rec", url: "https://media.example.test/rec.m4a", kind: "audio", label: "Recording" }],
  })),
}))

import type { WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { executeNode } from "../execute-node"

const ctx = {
  userId: "u1",
  projectId: "p1",
  trackInterval: (i: unknown) => i,
  untrackInterval: (i: unknown) => clearInterval(i as ReturnType<typeof setInterval>),
  save: vi.fn(),
  setIsRunning: vi.fn(),
  isWorkflowStale: () => false,
  isStorageError: () => false,
  setShowStorageExceeded: vi.fn(),
  setStorageExceededData: vi.fn(),
  setShowInsufficientCredits: vi.fn(),
} as never

async function run(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const node = { id: "ep", type: "edit-plan", position: { x: 0, y: 0 }, data: { label: "Edit Plan", ...data } } as unknown as WorkflowNode
  act(() => useWorkflowStore.setState({ nodes: [node], edges: [] } as never))
  const p = executeNode(useWorkflowStore.getState().nodes[0]!, ctx).catch(() => undefined)
  await vi.advanceTimersByTimeAsync(2_100)
  await p
  expect(api.editPlan).toHaveBeenCalledTimes(1)
  return api.editPlan.mock.calls[0]![0] as Record<string, unknown>
}

beforeEach(() => {
  vi.useFakeTimers()
  api.editPlan.mockReset()
  api.editPlan.mockResolvedValue({ jobId: "c0ffee00-0000-4000-8000-0000000000ee" })
})
afterEach(() => {
  vi.useRealTimers()
})

describe("Edit Plan canvas Run — the mode it sends", () => {
  it("sends an unknown mode as saved, for the server to refuse — never tighten", async () => {
    const sent = await run({ mode: "montage", count: 5 })
    expect(sent.mode).toBe("montage")
    expect(sent.count).toBeUndefined()
  })

  it("sends trailer as saved", async () => {
    expect((await run({ mode: "trailer" })).mode).toBe("trailer")
  })

  it("an absent mode is the node default, tighten", async () => {
    expect((await run({ mode: undefined })).mode).toBe("tighten")
  })

  it("clips still carries its count", async () => {
    const sent = await run({ mode: "clips", count: 5 })
    expect(sent.mode).toBe("clips")
    expect(sent.count).toBe(5)
  })
})
