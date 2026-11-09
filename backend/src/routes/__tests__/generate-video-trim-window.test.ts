import { describe, it, expect } from "vitest"
import { generateVideoBody } from "../generate-video.js"

const body = (provider: string, videoTrimStart: number, videoTrimEnd: number) => ({
  provider,
  prompt: "change the weather",
  referenceVideoUrls: ["https://example.com/clip.mp4"],
  videoTrimStart,
  videoTrimEnd,
})

describe("the source-clip trim window", () => {
  it("is 15 s on Gemini Omni Flash 1.2", () => {
    expect(generateVideoBody.safeParse(body("gemini-omni-flash-1-2", 0, 15)).success).toBe(true)
    const over = generateVideoBody.safeParse(body("gemini-omni-flash-1-2", 0, 16))
    expect(over.success).toBe(false)
    if (!over.success) expect(over.error.issues[0]?.message).toContain("15")
  })

  it("stays 10 s on the per-clip Omni models", () => {
    expect(generateVideoBody.safeParse(body("gemini-omni-flash", 0, 10)).success).toBe(true)
    expect(generateVideoBody.safeParse(body("gemini-omni-flash", 0, 11)).success).toBe(false)
  })
})
