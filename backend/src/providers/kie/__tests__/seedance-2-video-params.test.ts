import { describe, it, expect } from "vitest"
import { applySeedance2Params } from "../video.js"

describe("applySeedance2Params", () => {
  it("first frame only → keeps first_frame_url, no reference arrays, no suffix", () => {
    const input: Record<string, unknown> = { prompt: "a cat", first_frame_url: "https://a/f.png" }
    applySeedance2Params(input, { resolution: "720p" } as any)
    expect(input.first_frame_url).toBe("https://a/f.png")
    expect(input.reference_image_urls).toBeUndefined()
    expect(input.prompt).toBe("a cat")
  })

  it("first frame + reference image → reference mode: frame moved into reference_image_urls + suffix appended", () => {
    const input: Record<string, unknown> = { prompt: "a cat", first_frame_url: "https://a/f.png" }
    applySeedance2Params(input, { referenceImageUrls: ["https://a/r.png"] } as any)
    expect(input.first_frame_url).toBeUndefined()
    expect(input.reference_image_urls).toEqual(["https://a/r.png", "https://a/f.png"])
    expect(input.prompt).toBe("a cat\n\nUse @image_2 as the opening (first) frame of the video.")
  })

  it("reference video present → no throw, first/last frame moved into references", () => {
    const input: Record<string, unknown> = { prompt: "p", first_frame_url: "https://a/f.png", last_frame_url: "https://a/l.png" }
    expect(() => applySeedance2Params(input, { referenceVideoUrls: ["https://a/v.mp4"] } as any)).not.toThrow()
    expect(input.first_frame_url).toBeUndefined()
    expect(input.last_frame_url).toBeUndefined()
    expect(input.reference_video_urls).toEqual(["https://a/v.mp4"])
    expect(input.reference_image_urls).toEqual(["https://a/f.png", "https://a/l.png"])
  })

  it("passes through aspect_ratio + resolution verbatim (4k / adaptive)", () => {
    const input: Record<string, unknown> = { prompt: "p" }
    applySeedance2Params(input, { resolution: "4k", aspectRatio: "adaptive" } as any)
    expect(input.resolution).toBe("4k")
    expect(input.aspect_ratio).toBe("adaptive")
    expect(input.web_search).toBe(false)
  })
})

describe("applySeedance2Params — Seedance Draft", () => {
  it("sets the provider's draft flag and pins 480p on Seedance 2.5", () => {
    const input: Record<string, unknown> = { prompt: "p" }
    applySeedance2Params(input, { resolution: "720p", draft: true } as any, "seedance-2-5")
    expect(input.draft).toBe(true)
    expect(input.resolution).toBe("480p")
  })

  it("sends no draft field when the run is not a draft (byte-identical payload)", () => {
    const input: Record<string, unknown> = { prompt: "p" }
    applySeedance2Params(input, { resolution: "720p" } as any, "seedance-2-5")
    expect("draft" in input).toBe(false)
    expect(input.resolution).toBe("720p")
  })

  it("ignores draft on a model without draft mode", () => {
    const input: Record<string, unknown> = { prompt: "p" }
    applySeedance2Params(input, { resolution: "720p", draft: true } as any, "seedance-2")
    expect("draft" in input).toBe(false)
    expect(input.resolution).toBe("720p")
  })
})
