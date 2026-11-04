/**
 * Split into Chunks on the canvas: the part-length run sends what it always
 * sent; at the shots it sends the video and `mode: "shots"` only, refuses a
 * missing video or a separate audio with a toast before any request, and keeps
 * each part's shot on the node (`generatedShots`) beside its parts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

const m = vi.hoisted(() => ({
  splitMediaApi: vi.fn(() => Promise.resolve({ jobId: "c0ffee00-0000-4000-8000-0000000000aa" })),
  row: undefined as unknown,
  toastError: vi.fn(),
}))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: m.toastError, info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  splitMediaApi: m.splitMediaApi,
}))
vi.mock("../poll-job", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../poll-job")>()),
  getJobStatusLeanForNode: vi.fn(() => Promise.resolve({ status: "completed", output_data: m.row })),
}))
const wired = vi.hoisted(() => ({ inputs: {} as Record<string, unknown> }))
vi.mock("../node-input-resolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../node-input-resolver")>()),
  resolveNodeInputs: vi.fn(() => ({ ...wired.inputs })),
}))

import type { WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { executeNode } from "../execute-node"

const VIDEO = "https://media.example.test/ad.mp4"
const AUDIO = "https://media.example.test/a.mp3"
const ctx = () => ({
  userId: "u1", projectId: "p1",
  trackInterval: (i: unknown) => i,
  untrackInterval: (i: unknown) => clearInterval(i as ReturnType<typeof setInterval>),
  save: vi.fn(), setIsRunning: vi.fn(), isWorkflowStale: () => false, isStorageError: () => false,
  setShowStorageExceeded: vi.fn(), setStorageExceededData: vi.fn(), setShowInsufficientCredits: vi.fn(),
}) as never

async function run(data: Record<string, unknown>, inputs: Record<string, unknown>) {
  const node = { id: "split", type: "split-media", position: { x: 0, y: 0 }, data: { label: "Split", fieldMappings: {}, chunkDuration: 10, ...data } } as unknown as WorkflowNode
  act(() => useWorkflowStore.setState({ nodes: [node], edges: [] } as never))
  wired.inputs = inputs
  const p = executeNode(node, ctx()).catch(() => undefined)
  await vi.advanceTimersByTimeAsync(2_100)
  await p
  return useWorkflowStore.getState().nodes.find((n) => n.id === "split")!.data as Record<string, unknown>
}

beforeEach(() => {
  vi.useFakeTimers()
  m.splitMediaApi.mockClear()
  m.toastError.mockClear()
})
afterEach(() => vi.useRealTimers())

describe("Split into Chunks on the canvas", () => {
  it("part length: the request is what it always was", async () => {
    m.row = { videoUrls: ["https://r2.test/p0.mp4"], chunkCount: 1 }
    await run({ minPartDuration: 4 }, { videoUrl: VIDEO })
    expect(m.splitMediaApi).toHaveBeenCalledWith({ videoUrl: VIDEO, audioUrl: undefined, chunkDuration: 10, minPartDuration: 4, audioFormat: "mp3", userId: "u1" })
  })

  it("at the shots: sends the video and the mode only, and keeps each part's shot on the node", async () => {
    const shots = [{ index: 0, startSec: 0, endSec: 1, durationSec: 1 }, { index: 1, startSec: 1, endSec: 2.5, durationSec: 1.5 }]
    m.row = { videoUrls: ["https://r2.test/p0.mp4", "https://r2.test/p1.mp4"], chunkCount: 2, partDurationsSec: [1, 1.5], shotCount: 2, shots }
    const data = await run({ mode: "shots" }, { videoUrl: VIDEO })
    expect(m.splitMediaApi).toHaveBeenCalledWith({ videoUrl: VIDEO, mode: "shots", userId: "u1" })
    expect(data.executionStatus).toBe("completed")
    expect(data.generatedVideoUrls).toEqual(["https://r2.test/p0.mp4", "https://r2.test/p1.mp4"])
    expect(data.generatedShots).toEqual(shots)
  })

  it("at the shots: no video, or a separate audio, is refused with a toast before any request", async () => {
    await run({ mode: "shots" }, { audioUrl: AUDIO })
    await run({ mode: "shots" }, { videoUrl: VIDEO, audioUrl: AUDIO })
    expect(m.splitMediaApi).not.toHaveBeenCalled()
    expect(m.toastError).toHaveBeenCalledTimes(2)
  })
})
