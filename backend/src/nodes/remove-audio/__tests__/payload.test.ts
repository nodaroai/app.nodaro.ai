import { describe, it, expect, vi } from "vitest"
import { payload } from "../payload.js"
import type { UnitPayloadKit } from "../../kit.js"

function kit(over: Partial<UnitPayloadKit> = {}): UnitPayloadKit {
  return {
    node: { id: "n1", type: "remove-audio", data: {} } as UnitPayloadKit["node"],
    data: {},
    resolvedInputs: {} as UnitPayloadKit["resolvedInputs"],
    jobId: "job-1",
    usageLogId: "ul-1",
    ffmpegResult: vi.fn((jobName: string, p: Record<string, unknown>) => ({ jobName, payload: p }) as unknown as ReturnType<UnitPayloadKit["ffmpegResult"]>),
    ...over,
  }
}

describe("remove-audio payload", () => {
  it("a remove-audio video-queue job on the wired video", () => {
    const k = kit({ resolvedInputs: { videoUrl: "https://media.test/wired.mp4" } as UnitPayloadKit["resolvedInputs"], data: { videoUrl: "https://media.test/own.mp4" } })
    payload(k)
    expect(k.ffmpegResult).toHaveBeenCalledWith("remove-audio", { jobId: "job-1", videoUrl: "https://media.test/wired.mp4", usageLogId: "ul-1" })
  })

  it("falls back to the node's own videoUrl when nothing is wired", () => {
    const k = kit({ data: { videoUrl: "https://media.test/own.mp4" } })
    payload(k)
    expect(k.ffmpegResult).toHaveBeenCalledWith("remove-audio", { jobId: "job-1", videoUrl: "https://media.test/own.mp4", usageLogId: "ul-1" })
  })
})
