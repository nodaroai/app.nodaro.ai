import { describe, it, expect } from "vitest"
import { buildGeminiOmni12Request } from "../gemini-omni-12.js"

const base = { prompt: "a cat plays piano", durationSec: 8, resolution: "720p", aspectRatio: "16:9" }

describe("buildGeminiOmni12Request", () => {
  it("text only: an integer duration and no images", () => {
    const { mode, input } = buildGeminiOmni12Request(base)
    expect(mode).toBe("reference")
    expect(input).toEqual({ prompt: base.prompt, resolution: "720p", aspect_ratio: "16:9", duration: 8 })
  })

  it("references ride image_urls, capped at 6", () => {
    const urls = Array.from({ length: 8 }, (_, i) => `https://x/${i}.png`)
    const { mode, input, droppedRefImages } = buildGeminiOmni12Request({ ...base, referenceImageUrls: urls })
    expect(mode).toBe("reference")
    expect(input.image_urls).toEqual(urls.slice(0, 6))
    expect(droppedRefImages).toBe(2)
    expect(input.duration).toBe(8)
  })

  it("a start frame alone is a real first frame", () => {
    const { mode, input } = buildGeminiOmni12Request({ ...base, startFrameUrl: "https://x/a.png" })
    expect(mode).toBe("first-frame")
    expect(input.first_frame_url).toBe("https://x/a.png")
    expect(input).not.toHaveProperty("image_urls")
    expect(input.prompt).toBe(base.prompt)
  })

  it("start and end frames up to 10 s are real frames", () => {
    const { mode, input } = buildGeminiOmni12Request({ ...base, durationSec: 10, startFrameUrl: "s", endFrameUrl: "e" })
    expect(mode).toBe("first-last-frame")
    expect(input.first_frame_url).toBe("s")
    expect(input.last_frame_url).toBe("e")
    expect(input).not.toHaveProperty("image_urls")
  })

  it("start and end frames past 10 s go through the list, named in the prompt", () => {
    const { mode, input } = buildGeminiOmni12Request({ ...base, durationSec: 12, startFrameUrl: "s", endFrameUrl: "e" })
    expect(mode).toBe("reference")
    expect(input).not.toHaveProperty("first_frame_url")
    expect(input).not.toHaveProperty("last_frame_url")
    expect(input.image_urls).toEqual(["s", "e"])
    expect(input.duration).toBe(12)
    expect(input.prompt).toContain("@image_1")
    expect(input.prompt).toContain("@image_2")
  })

  it("a lone end frame never goes out as last_frame_url", () => {
    const { input } = buildGeminiOmni12Request({ ...base, endFrameUrl: "e" })
    expect(input).not.toHaveProperty("last_frame_url")
    expect(input.image_urls).toEqual(["e"])
    expect(input.prompt).toContain("closing")
  })

  it("frames beside references join the list after them, named in the prompt", () => {
    const { mode, input } = buildGeminiOmni12Request({ ...base, startFrameUrl: "s", endFrameUrl: "e", referenceImageUrls: ["r1", "r2"] })
    expect(mode).toBe("reference")
    expect(input).not.toHaveProperty("first_frame_url")
    expect(input.image_urls).toEqual(["r1", "r2", "s", "e"])
    expect(input.prompt).toContain("@image_3")
    expect(input.prompt).toContain("@image_4")
  })

  it("at the cap the frames stay and trailing references go", () => {
    const urls = Array.from({ length: 6 }, (_, i) => `r${i}`)
    const { input, droppedRefImages } = buildGeminiOmni12Request({ ...base, startFrameUrl: "s", referenceImageUrls: urls })
    expect(input.image_urls).toEqual([...urls.slice(0, 5), "s"])
    expect(droppedRefImages).toBe(1)
  })

  it("a video edit sends a plain URL and no duration, with room for 5 images", () => {
    const urls = Array.from({ length: 6 }, (_, i) => `r${i}`)
    const { mode, input, droppedRefImages } = buildGeminiOmni12Request({ ...base, sourceVideoUrl: "https://x/v.mp4", referenceImageUrls: urls })
    expect(mode).toBe("video-edit")
    expect(input.video_list).toEqual(["https://x/v.mp4"])
    expect(input).not.toHaveProperty("duration")
    expect(input.image_urls).toEqual(urls.slice(0, 5))
    expect(droppedRefImages).toBe(1)
  })

  it("a start frame beside a source video never goes out as a real frame", () => {
    const { input } = buildGeminiOmni12Request({ ...base, sourceVideoUrl: "v", startFrameUrl: "s" })
    expect(input).not.toHaveProperty("first_frame_url")
    expect(input.image_urls).toEqual(["s"])
  })

  it("sends `seeds` only when it is in KIE's range", () => {
    expect(buildGeminiOmni12Request({ ...base, seed: 12345 }).input.seeds).toBe(12345)
    for (const seed of [-1, 0, 9999, 100000, 12.5]) {
      expect(buildGeminiOmni12Request({ ...base, seed }).input).not.toHaveProperty("seeds")
    }
    expect(buildGeminiOmni12Request({ ...base, seed: 12345 }).input).not.toHaveProperty("seed")
  })

  it("never sends a field the schema does not have", () => {
    const allowed = new Set(["prompt", "duration", "aspect_ratio", "resolution", "seeds", "image_urls", "first_frame_url", "last_frame_url", "video_list"])
    const cases = [
      base,
      { ...base, seed: 12345, startFrameUrl: "s", endFrameUrl: "e" },
      { ...base, seed: 12345, referenceImageUrls: ["r"], startFrameUrl: "s" },
      { ...base, seed: 12345, sourceVideoUrl: "v", referenceImageUrls: ["r"] },
    ]
    for (const args of cases) {
      for (const key of Object.keys(buildGeminiOmni12Request(args).input)) expect(allowed.has(key), key).toBe(true)
    }
  })
})
