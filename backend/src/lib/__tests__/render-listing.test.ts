import { describe, it, expect } from "vitest"
import { OWNER_ONLY_RENDER_JOBS, isPreviewListing, renderListingMedium } from "../render-listing.js"

const APPLY_EDL_JOB = "apply-edl"
const applyEdlMedium = (input: unknown, output: unknown) => renderListingMedium(APPLY_EDL_JOB, input, output)

describe("applyEdlMedium — which kind an Apply EDL render lists under (decided 2026-10-06)", () => {
  it("a finished render is what its output holds: a cut is a video, a mix is an audio", () => {
    expect(applyEdlMedium({ output: "video" }, { videoUrl: "https://r2/cut.mp4" })).toBe("video")
    expect(applyEdlMedium({ output: "video" }, { audioUrl: "https://r2/mix.m4a" })).toBe("audio")
    // The output wins over the order: the file is what it is.
    expect(applyEdlMedium({ output: "audio" }, { videoUrl: "https://r2/cut.mp4" })).toBe("video")
  })

  it("a render with nothing stored yet is what its order asks for, and a video when it asks for nothing", () => {
    expect(applyEdlMedium({ output: "audio" }, null)).toBe("audio")
    expect(applyEdlMedium({ output: "video" }, null)).toBe("video")
    expect(applyEdlMedium({}, null)).toBe("video")
    expect(applyEdlMedium(null, undefined)).toBe("video")
    expect(applyEdlMedium({ output: "audio" }, { videoUrl: "" })).toBe("audio")
  })
})

describe("renderListingMedium — a job that is not a render has no listing medium here", () => {
  it("answers undefined for any other job, whatever its output holds", () => {
    expect(renderListingMedium("generate-video", {}, { videoUrl: "https://r2/v.mp4" })).toBeUndefined()
    expect(renderListingMedium(null, { output: "audio" }, null)).toBeUndefined()
  })

  it("gates exactly the registry's owner-only renders on the owner", () => {
    expect([...OWNER_ONLY_RENDER_JOBS]).toEqual(["apply-edl"])
  })
})

describe("isPreviewListing — a listed render is a Preview when it was made at proxy quality", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "j1",
    job_type: APPLY_EDL_JOB,
    input_data: { quality: "proxy", output: "video" },
    output_data: { videoUrl: "https://r2/cut.mp4" },
    ...over,
  })

  it("an old render with no stored label takes it from the order", () => {
    expect(isPreviewListing(row({}))).toBe(true)
    expect(isPreviewListing(row({ input_data: { quality: "final" } }))).toBe(false)
    expect(isPreviewListing(row({ input_data: {} }))).toBe(false)
  })

  it("a stored label wins over the order", () => {
    expect(isPreviewListing(row({ input_data: { quality: "final" }, output_data: { videoUrl: "v", quality: "proxy" } }))).toBe(true)
    expect(isPreviewListing(row({ input_data: { quality: "proxy" }, output_data: { videoUrl: "v", quality: "final" } }))).toBe(false)
  })

  it("only an Apply EDL render can be one", () => {
    expect(isPreviewListing(row({ job_type: "generate-video" }))).toBe(false)
  })
})
