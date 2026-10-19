import { describe, it, expect, vi } from "vitest"
import { payload } from "../payload.js"
import type { UnitPayloadKit } from "../../kit.js"

function kit(over: Partial<UnitPayloadKit> = {}): UnitPayloadKit {
  return {
    node: { id: "n1", type: "gif-to-video", data: {} } as UnitPayloadKit["node"],
    data: {},
    resolvedInputs: {} as UnitPayloadKit["resolvedInputs"],
    jobId: "job-1",
    usageLogId: "ul-1",
    ffmpegResult: vi.fn((jobName: string, p: Record<string, unknown>) => ({ jobName, payload: p }) as unknown as ReturnType<UnitPayloadKit["ffmpegResult"]>),
    ...over,
  }
}

const DEFAULTS = { loopToMinimum: true, targetDuration: 3, interpolate: true, alphaBackground: "white" }

describe("gif-to-video payload", () => {
  it("a gif-to-video video-queue job on the wired GIF, with the default settings", () => {
    const k = kit({ resolvedInputs: { imageUrl: "https://media.test/wired.gif" } as UnitPayloadKit["resolvedInputs"], data: { gifUrl: "https://media.test/own.gif" } })
    payload(k)
    expect(k.ffmpegResult).toHaveBeenCalledWith("gif-to-video", { jobId: "job-1", gifUrl: "https://media.test/wired.gif", ...DEFAULTS, usageLogId: "ul-1" })
  })

  it("falls back to the node's own upload when nothing is wired, and carries its settings", () => {
    const k = kit({ data: { gifUrl: "https://media.test/own.gif", loopToMinimum: false, targetDuration: 6, interpolate: false, alphaBackground: "black" } })
    payload(k)
    expect(k.ffmpegResult).toHaveBeenCalledWith("gif-to-video", { jobId: "job-1", gifUrl: "https://media.test/own.gif", loopToMinimum: false, targetDuration: 6, interpolate: false, alphaBackground: "black", usageLogId: "ul-1" })
  })
})
