// @vitest-environment node
import { describe, it, expect } from "vitest"
import type { LibraryAsset } from "@/lib/api"
import {
  assetMatcher,
  jobLinkState,
  jobOutputUrls,
  readDeepLinkTarget,
  withoutDeepLinkParams,
} from "../library-deep-link"

describe("library deep-link helpers", () => {
  it("reads the target; asset names the file exactly, so it wins", () => {
    expect(readDeepLinkTarget(new URLSearchParams("job=j1"))).toEqual({ kind: "job", id: "j1" })
    expect(readDeepLinkTarget(new URLSearchParams("asset=a1&job=j1"))).toEqual({ kind: "asset", id: "a1" })
    expect(readDeepLinkTarget(new URLSearchParams("job=%20"))).toBeNull()
    expect(readDeepLinkTarget(new URLSearchParams("ref=app"))).toBeNull()
  })

  it("strips only the deep-link parameters", () => {
    const next = withoutDeepLinkParams(new URLSearchParams("job=j1&asset=a1&ref=app"))
    expect(next.toString()).toBe("ref=app")
  })

  it("a job is ready, still on its way (review included), or has no file", () => {
    expect(jobLinkState("completed")).toBe("ready")
    for (const s of ["pending", "queued", "processing", "pending_review"]) expect(jobLinkState(s)).toBe("processing")
    expect(jobLinkState("failed")).toBe("no-result")
    expect(jobLinkState("cancelled")).toBe("no-result")
  })

  it("a job's file is matched by the row's jobId, by its address only when the row has none", () => {
    const matches = assetMatcher({ kind: "job", id: "j1" }, ["https://m/a.png"])
    const row = (over: Partial<LibraryAsset>): LibraryAsset => ({
      id: "x", type: "image", filename: "a.png", mimeType: "image/png", sizeBytes: 1,
      url: "https://m/other.png", thumbnailUrl: null, metadata: {}, isLibraryItem: false,
      uploadSource: "generated", createdAt: "2026-10-01T00:00:00Z", ...over,
    })
    expect(matches(row({ jobId: "j1" }))).toBe(true)
    expect(matches(row({ jobId: "j2", url: "https://m/a.png" }))).toBe(false)
    expect(matches(row({ jobId: null, url: "https://m/a.png" }))).toBe(true)
    expect(matches(row({ url: "https://m/a.png" }))).toBe(true)
    expect(matches(row({ jobId: null }))).toBe(false)
  })

  it("reads the media addresses a job's output names", () => {
    expect(jobOutputUrls({ output_data: { imageUrl: "i", videoUrl: "", audioUrl: "a", script: "x" } })).toEqual(["i", "a"])
    expect(jobOutputUrls({})).toEqual([])
  })
})
