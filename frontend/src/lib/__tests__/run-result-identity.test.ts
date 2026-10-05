import { describe, it, expect } from "vitest"
import { runResultIdentity, runResultRowIdentity } from "../run-result-identity"

describe("runResultIdentity — what a landed take carries (A1b)", () => {
  it("a render's thumbnail, quality and clip", () => {
    expect(runResultIdentity("apply-edl", { videoUrl: "v", thumbnailUrl: "t", quality: "proxy", clipKey: "0-9" })).toEqual({
      thumbnailUrl: "t", quality: "proxy", clipKey: "0-9",
    })
  })

  it("another node keeps its thumbnail and never a render quality", () => {
    expect(runResultIdentity("generate-image", { imageUrl: "i", thumbnailUrl: "t", quality: "proxy" })).toEqual({ thumbnailUrl: "t" })
    expect(runResultIdentity("apply-edl", undefined)).toEqual({})
  })
})

describe("runResultRowIdentity — a server fan-out row's own job", () => {
  const output = {
    listResults: ["a.mp4", "", "c.mp4"],
    listResultStamps: [
      { jobId: "job-a", thumbnailUrl: "a.jpg", quality: "proxy" as const, clipKey: "0-1" },
      {},
      { jobId: "job-c", quality: "proxy" as const, clipKey: "4-5" },
    ],
  }

  it("pairs by row, never by position among the URLs", () => {
    expect(runResultRowIdentity("apply-edl", output, "c.mp4")).toEqual({ jobId: "job-c", quality: "proxy", clipKey: "4-5" })
    expect(runResultRowIdentity("apply-edl", output, "a.mp4")).toEqual({ jobId: "job-a", thumbnailUrl: "a.jpg", quality: "proxy", clipKey: "0-1" })
  })

  it("a run that published no stamps (or an unknown URL) gives nothing", () => {
    expect(runResultRowIdentity("apply-edl", { listResults: ["a.mp4"] }, "a.mp4")).toEqual({})
    expect(runResultRowIdentity("apply-edl", output, "zzz")).toEqual({})
  })
})
