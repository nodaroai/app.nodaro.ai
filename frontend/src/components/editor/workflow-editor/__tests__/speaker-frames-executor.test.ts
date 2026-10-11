/**
 * The canvas's own run of a Speaker Frames node (P3.6), on what the canvas
 * wires into it — the same answers the server's payload builder gives:
 *  - an edit AND a bare video wired together is refused (P3.4), never silently
 *    run on the edit alone;
 *  - a camera left unticked from an earlier wiring is dropped from the untick
 *    list, not sent (the panel cannot show or re-tick it).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { toastError, flag, api, updateNodeData } = vi.hoisted(() => ({
  toastError: vi.fn(),
  flag: { priced: false },
  api: vi.fn(async (_p: unknown) => ({ jobId: "job-1" })),
  updateNodeData: vi.fn(),
}))

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn(), info: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))
vi.mock("@nodaro/render-rules", async (orig) => {
  const actual = await orig<typeof import("@nodaro/render-rules")>()
  return {
    ...actual,
    get SPEAKER_FRAMES_PRICED() {
      return flag.priced
    },
  }
})
vi.mock("@/lib/api", () => ({ speakerFrames: (p: unknown) => api(p) }))
vi.mock("../poll-job", () => ({
  RUN_START_RESET: {},
  getJobStatusLeanForNode: vi.fn(),
  guardedToast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}))
vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: { getState: () => ({ updateNodeData }) } }))

import { executeSpeakerFrames } from "../speaker-frames-executor"
import type { WorkflowNode } from "@/types/nodes"

const EDL = {
  version: 1,
  clock: "master",
  sources: [
    { id: "mic", url: "https://x/mic.wav", kind: "audio", role: "master-audio" },
    { id: "camA", url: "https://x/cam-a.mp4", kind: "video" },
    { id: "camB", url: "https://x/cam-b.mp4", kind: "video" },
  ],
  segments: [{ id: "s0", inMs: 0, outMs: 30_000, video: "camA" }],
}
const ONE_CAM = { ...EDL, sources: EDL.sources.filter((s) => s.id !== "camB") }
const node = (data: Record<string, unknown> = {}) =>
  ({ id: "sf", type: "speaker-frames", position: { x: 0, y: 0 }, data: { label: "Speaker Frames", ...data } }) as unknown as WorkflowNode
const ctx = {
  userId: "user-1",
  // The poll loop is not under test: stop it as soon as it starts.
  trackInterval: (id: ReturnType<typeof setInterval>) => {
    clearInterval(id)
    return id
  },
  untrackInterval: () => {},
  isWorkflowStale: () => false,
} as never

beforeEach(() => {
  vi.clearAllMocks()
  flag.priced = false
})

const sent = async () => {
  await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  return api.mock.calls[0]![0] as Record<string, unknown>
}

describe("executeSpeakerFrames", () => {
  it("refuses an edit and a bare video wired together, in the scope's words, and sends nothing", async () => {
    await expect(
      executeSpeakerFrames(node(), { inputs: [JSON.stringify(EDL)], videoUrl: "https://x/v.mp4" }, ctx),
    ).rejects.toThrow(/wire exactly one of an edit/)
    expect(toastError).toHaveBeenCalled()
    expect(api).not.toHaveBeenCalled()
  })

  it("a stale untick does not refuse the run (unpriced, it reaches the price refusal)", async () => {
    await expect(executeSpeakerFrames(node({ excludeSourceIds: ["camB"] }), { inputs: [JSON.stringify(ONE_CAM)] }, ctx)).rejects.toThrow(
      "Speaker Frames is not priced yet",
    )
  })

  it("with a price, sends only the untick ids the current edit samples", async () => {
    flag.priced = true
    void executeSpeakerFrames(node({ excludeSourceIds: ["camB", "gone"] }), { inputs: [JSON.stringify(EDL)] }, ctx)
    expect((await sent()).excludeSourceIds).toEqual(["camB"])
  })

  it("with a price, a stale untick on a rewired edit is dropped", async () => {
    flag.priced = true
    void executeSpeakerFrames(node({ excludeSourceIds: ["camB"] }), { inputs: [JSON.stringify(ONE_CAM)] }, ctx)
    const body = await sent()
    expect(body.excludeSourceIds).toEqual([])
    expect(body.videoUrl).toBeUndefined()
  })
})
