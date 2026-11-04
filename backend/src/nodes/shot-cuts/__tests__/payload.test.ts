import { describe, it, expect, vi } from "vitest"
import { payload } from "../payload.js"
import type { UnitPayloadKit } from "../../kit.js"

function kit(over: Partial<UnitPayloadKit> = {}): UnitPayloadKit {
  return {
    node: { id: "n1", type: "shot-cuts", data: {} } as UnitPayloadKit["node"],
    data: {},
    resolvedInputs: {} as UnitPayloadKit["resolvedInputs"],
    jobId: "job-1",
    usageLogId: "ul-1",
    ffmpegResult: vi.fn((jobName: string, p: Record<string, unknown>) => ({ jobName, payload: p }) as unknown as ReturnType<UnitPayloadKit["ffmpegResult"]>),
    ...over,
  }
}

describe("shot-cuts payload", () => {
  it("a shot-cuts video-queue job on the wired video, frames off unless the node turns them on", () => {
    const k = kit({ resolvedInputs: { videoUrl: "https://media.test/wired.mp4" } as UnitPayloadKit["resolvedInputs"], data: { videoUrl: "https://media.test/own.mp4" } })
    payload(k)
    expect(k.ffmpegResult).toHaveBeenCalledWith("shot-cuts", { jobId: "job-1", videoUrl: "https://media.test/wired.mp4", frames: false, usageLogId: "ul-1" })
  })

  it("the node's frames toggle rides the job; the node's own videoUrl when nothing is wired", () => {
    const k = kit({ data: { videoUrl: "https://media.test/own.mp4", frames: true } })
    payload(k)
    expect(k.ffmpegResult).toHaveBeenCalledWith("shot-cuts", { jobId: "job-1", videoUrl: "https://media.test/own.mp4", frames: true, usageLogId: "ul-1" })
  })

  it("only a true frames turns them on (a string or a number does not)", () => {
    for (const frames of ["true", 1, null]) {
      const k = kit({ data: { videoUrl: "https://media.test/own.mp4", frames } })
      payload(k)
      expect(k.ffmpegResult).toHaveBeenCalledWith("shot-cuts", expect.objectContaining({ frames: false }))
    }
  })
})
