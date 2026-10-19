/**
 * The canvas Run of a Camera Switch with a wired Speaker Map (decided
 * 2026-10-17), through the real `executeNode`: a Speaker Map result fills the
 * speaker table it sends, under the person's own choices; a wire that carried
 * nothing, or something that is not a Speaker Map result, is refused before
 * the request (the server's buildPayload refuses the same, camera-switch-
 * speaker-map-parity.test.ts); nothing wired sends the order default, as
 * before the input existed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock("sonner", () => ({ toast }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

const api = vi.hoisted(() => ({ cameraSwitch: vi.fn() }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  cameraSwitch: api.cameraSwitch,
}))
vi.mock("../poll-job", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../poll-job")>()),
  getJobStatusLeanForNode: vi.fn(() => Promise.resolve({ status: "completed", output_data: { json: { version: 1, sources: [], segments: [] } } })),
}))
const wired = vi.hoisted(() => ({ inputs: {} as Record<string, unknown> }))
vi.mock("../node-input-resolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../node-input-resolver")>()),
  resolveNodeInputs: vi.fn(() => ({ ...wired.inputs })),
}))

import { cameraSwitchSpeakerMapProblemText } from "@nodaro/render-rules"
import type { WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { executeNode } from "../execute-node"

const EDL = { version: 1, clock: "master", sources: [{ id: "camA", url: "https://m.test/a.mp4", kind: "video" }, { id: "camB", url: "https://m.test/b.mp4", kind: "video" }], segments: [{ id: "s", inMs: 0, outMs: 900, video: "camA" }] }
const TRANSCRIPT = { words: [{ text: "x", startMs: 0, endMs: 100, speaker: "s0" }, { text: "y", startMs: 200, endMs: 300, speaker: "s1" }, { text: "z", startMs: 400, endMs: 500, speaker: "s2" }] }
const MAP = { version: 1, speakerMap: { s0: "camB", s1: "camB", s2: "" }, confidence: {}, notes: [] }
const BASE = { edl: JSON.stringify(EDL), transcript: JSON.stringify(TRANSCRIPT) }

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

async function run(inputs: Record<string, unknown>, data: Record<string, unknown> = {}): Promise<{ error?: Error }> {
  wired.inputs = inputs
  const node = { id: "cs", type: "camera-switch", position: { x: 0, y: 0 }, data: { label: "Camera Switch", fieldMappings: {}, ...data } } as unknown as WorkflowNode
  act(() => useWorkflowStore.setState({ nodes: [node], edges: [] } as never))
  let error: Error | undefined
  const p = executeNode(useWorkflowStore.getState().nodes[0]!, ctx).catch((e: Error) => { error = e })
  await vi.advanceTimersByTimeAsync(2_100)
  await p
  return { error }
}
const sentSpeakerMap = () => (api.cameraSwitch.mock.calls[0]![0] as { speakerMap: unknown }).speakerMap

beforeEach(() => {
  vi.useFakeTimers()
  toast.error.mockReset()
  api.cameraSwitch.mockReset().mockResolvedValue({ jobId: "c0ffee00-0000-4000-8000-0000000000cc" })
})
afterEach(() => {
  vi.useRealTimers()
})

describe("Camera Switch canvas Run — a wired Speaker Map", () => {
  it("a Speaker Map result fills the speaker table it sends, under the person's own choice", async () => {
    await run({ ...BASE, speakerMapResult: JSON.stringify(MAP) }, { speakerMap: { s1: "camA" } })
    expect(api.cameraSwitch).toHaveBeenCalledTimes(1)
    expect(sentSpeakerMap()).toStrictEqual({ s0: "camB", s1: "camA", s2: "" })
  })

  it("the ordinal override is carried into the request: it beats the wired map, an explicit label beats it", async () => {
    await run({ ...BASE, speakerMapResult: JSON.stringify(MAP) }, { speakerMapByOrder: { "1": "camA", "3": "camB" }, speakerMap: { s1: "camA" } })
    expect(sentSpeakerMap()).toStrictEqual({ s0: "camA", s1: "camA", s2: "camB" })
  })

  it.each([
    ["a Speaker Map that has not run (\"\")", "", "empty-speaker-map"],
    ["something that is not a Speaker Map result", JSON.stringify({ words: [] }), "not-a-speaker-map"],
  ] as const)("%s: refused before any request, with a toast", async (_name, value, problem) => {
    const { error } = await run({ ...BASE, speakerMapResult: value })
    expect(error?.message).toBe(cameraSwitchSpeakerMapProblemText(problem))
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(api.cameraSwitch).not.toHaveBeenCalled()
  })

  it("nothing wired: the order default, as before the input existed", async () => {
    await run({ ...BASE })
    expect(api.cameraSwitch).toHaveBeenCalledTimes(1)
    expect(sentSpeakerMap()).toStrictEqual({ s0: "camA", s1: "camB" })
  })
})
