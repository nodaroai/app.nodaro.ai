import { describe, it, expect } from "vitest"
import type { UnitPayloadKit } from "../../kit.js"
import { payload } from "../payload.js"

/** The workflow payload holds the row the route holds for the same settings, and prefers the wired image. */
function kitOf(data: Record<string, unknown>, imageUrl?: string): UnitPayloadKit {
  return {
    node: { id: "n1", type: "split-into-layers", data },
    data,
    resolvedInputs: imageUrl ? { imageUrl } : {},
    jobId: "job-1",
    usageLogId: "ul-1",
    ffmpegResult: (jobName: string, p: Record<string, unknown>, modelIdentifier = jobName) => ({ jobName, queueName: "video-generation", payload: p, modelIdentifier }),
  } as unknown as UnitPayloadKit
}

describe("split-into-layers payload", () => {
  it("the wired image, the defaults, and the default hold", () => {
    const r = payload(kitOf({ imageUrl: "https://own.png" }, "https://wired.png"))
    expect(r.jobName).toBe("split-into-layers")
    expect(r.modelIdentifier).toBe("split-into-layers:1k:10")
    expect(r.payload).toEqual({ jobId: "job-1", imageUrl: "https://wired.png", maxLayers: 9, size: "1K", model: "seedream-5-5-layer-decomposition", usageLogId: "ul-1" })
  })

  it("the node's own settings: its image when none is wired, its size's tier, its description", () => {
    const r = payload(kitOf({ imageUrl: "https://own.png", maxLayers: 5, size: "2K", prompt: " the logo " }))
    expect(r.modelIdentifier).toBe("split-into-layers:2k:6")
    expect(r.payload).toMatchObject({ imageUrl: "https://own.png", maxLayers: 5, size: "2K", prompt: "the logo" })
  })
})
