import { describe, expect, it } from "vitest"
import { variantJobId } from "@nodaro/shared"
import { buildVariantResults } from "../variant-results"

const urls = ["https://cdn/j-v0.mp3", "https://cdn/j-v1.mp3"]

describe("buildVariantResults", () => {
  it("shares extraFields across variants and lets perVariantFields win per ORIGINAL index (#819)", () => {
    const results = buildVariantResults(urls, "job", {
      extraFields: { sunoTrackId: "track-1", sunoTaskId: "task-9" },
      perVariantFields: (i) => ({ sunoTrackId: `track-${i + 1}` }),
    })
    expect(results.map((r) => r.sunoTrackId)).toEqual(["track-1", "track-2"])
    expect(results.map((r) => r.sunoTaskId)).toEqual(["task-9", "task-9"])
    expect(results.map((r) => r.jobId)).toEqual([variantJobId("job", 0), variantJobId("job", 1)])
  })

  it("keeps the ORIGINAL index for a variant that survives existingUrls filtering", () => {
    const results = buildVariantResults(urls, "job", {
      existingUrls: new Set([urls[0]!]),
      perVariantFields: (i) => ({ sunoTrackId: `track-${i + 1}` }),
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.url).toBe(urls[1])
    expect(results[0]!.sunoTrackId).toBe("track-2")
    expect(results[0]!.jobId).toBe(variantJobId("job", 1))
  })

  it("is unchanged without perVariantFields — every variant gets the shared fields", () => {
    const results = buildVariantResults(urls, "job", { extraFields: { kieTaskId: "k" } })
    expect(results.map((r) => r.kieTaskId)).toEqual(["k", "k"])
  })
})
