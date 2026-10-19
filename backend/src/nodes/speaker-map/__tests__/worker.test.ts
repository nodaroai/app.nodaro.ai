/**
 * The unit's video-queue handler: compute the map (providers/audio/speaker-map.ts),
 * complete the job with the published result on `json` and the edit on its own
 * `edl` key (so each lands on its own output), then commit. A cancelled job or
 * a lost completion race commits nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"

const m = vi.hoisted(() => ({
  calls: [] as string[],
  compute: vi.fn(),
  progress: vi.fn(),
  shouldSave: vi.fn(),
  markCompleted: vi.fn(),
  commit: vi.fn(),
}))

vi.mock("@/providers/audio/speaker-map.js", () => ({ computeSpeakerMap: m.compute }))
vi.mock("@/workers/shared.js", () => ({
  setJobProgress: m.progress,
  shouldSaveJobResult: m.shouldSave,
  markJobCompleted: m.markCompleted,
  commitJobCredits: m.commit,
}))

import { worker } from "../worker.js"

const sources = [{ id: "cam1", url: "https://media.test/cam1.mp4", kind: "video" }, { id: "cam2", url: "https://media.test/cam2.mp4", kind: "video" }]
const jobData = { jobId: "job-1", sources, transcript: { words: [] }, usageLogId: "ul-1" }
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "ul-1" } as Parameters<typeof worker>[1]
const EDL = { version: 1, clock: "master", sources: [], segments: [{ id: "whole", inMs: 0, outMs: 1000, video: "cam1" }] }
const COMPUTED = { speakerMap: { A: "cam1", B: "" }, confidence: { A: { camera: "cam1", marginDb: 9.1 }, B: { camera: "", marginDb: 0.4 } }, notes: ['"B": no clear camera'], edl: EDL }
const track = (name: string, value?: unknown) => async () => { m.calls.push(name); return value }

beforeEach(() => {
  m.calls = []
  vi.spyOn(console, "log").mockImplementation(() => {})
  m.compute.mockReset().mockImplementation(track("compute", COMPUTED))
  m.progress.mockReset().mockImplementation(async (_j: unknown, _id: string, p: number) => { m.calls.push(`progress ${p}`) })
  m.shouldSave.mockReset().mockImplementation(track("shouldSave", true))
  m.markCompleted.mockReset().mockImplementation(track("markCompleted", true))
  m.commit.mockReset().mockImplementation(track("commit"))
})

describe("speaker-map worker", () => {
  it("computes at the lead it was sent (3 dB when none), completes with the versioned result and the edit on its own key, then commits", async () => {
    await worker({ data: jobData } as unknown as Job, ctx)
    expect(m.compute).toHaveBeenCalledWith({ ...jobData, marginDb: 3 })
    expect(m.markCompleted).toHaveBeenCalledWith("job-1", { output_data: { json: { version: 1, ...COMPUTED }, edl: EDL } })
    expect(m.commit).toHaveBeenCalledWith("ul-1", "job-1")
    expect(m.calls).toEqual(["compute", "progress 100", "shouldSave", "markCompleted", "commit"])
    await worker({ data: { ...jobData, marginDb: 6 } } as unknown as Job, ctx)
    expect(m.compute).toHaveBeenLastCalledWith({ ...jobData, marginDb: 6 })
  })

  it("a result with no edit leaves the edl key out (its output is emptied, never stale)", async () => {
    const { edl: _e, ...noEdl } = COMPUTED
    m.compute.mockResolvedValue(noEdl)
    await worker({ data: jobData } as unknown as Job, ctx)
    const written = (m.markCompleted.mock.calls[0]![1] as { output_data: Record<string, unknown> }).output_data
    expect(written).toEqual({ json: { version: 1, ...noEdl } })
    expect("edl" in written).toBe(false)
  })

  it("writes no status of its own: completion goes through markJobCompleted alone", async () => {
    await worker({ data: jobData } as unknown as Job, ctx)
    const written = m.markCompleted.mock.calls[0]![1] as Record<string, unknown>
    expect(Object.keys(written)).toEqual(["output_data"])
  })

  it("a cancelled job saves and commits nothing; a lost completion race commits nothing", async () => {
    m.shouldSave.mockResolvedValue(false)
    await worker({ data: jobData } as unknown as Job, ctx)
    expect(m.markCompleted).not.toHaveBeenCalled()
    expect(m.commit).not.toHaveBeenCalled()
    m.shouldSave.mockResolvedValue(true)
    m.markCompleted.mockResolvedValue(false)
    await worker({ data: jobData } as unknown as Job, ctx)
    expect(m.commit).not.toHaveBeenCalled()
  })

  it("a failed computation rethrows (the dispatch fails and refunds the job), saving nothing", async () => {
    m.compute.mockRejectedValue(new Error("boom"))
    await expect(worker({ data: jobData } as unknown as Job, ctx)).rejects.toThrow("boom")
    expect(m.markCompleted).not.toHaveBeenCalled()
    expect(m.commit).not.toHaveBeenCalled()
  })
})
