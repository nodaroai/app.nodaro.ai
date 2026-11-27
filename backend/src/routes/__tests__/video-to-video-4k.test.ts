import { describe, it, expect } from "vitest"
import { videoToVideoBody } from "../video-to-video.js"

/**
 * Video to Video at 4K (decided 2026-11-25): a Seedance 2.5 edit (also the
 * default when no model is named) takes 4K; every other model refuses it.
 */
const base = { videoUrl: "https://example.com/clip.mp4", prompt: "make it night" }

describe("POST /v1/video-to-video — 4K", () => {
  it("takes 4K on Seedance 2.5 and on a body that names no model", () => {
    expect(videoToVideoBody.safeParse({ ...base, provider: "seedance-2-5", resolution: "4k" }).success).toBe(true)
    expect(videoToVideoBody.safeParse({ ...base, resolution: "4k" }).success).toBe(true)
  })

  it("refuses 4K on every other model, Seedance 2.5 Flash included", () => {
    for (const provider of ["seedance-2-5-flash", "wan", "happyhorse-edit"]) {
      const parsed = videoToVideoBody.safeParse({ ...base, provider, resolution: "4k" })
      expect(parsed.success, provider).toBe(false)
      expect(JSON.stringify(parsed.error?.issues), provider).toContain("4K is available on Seedance 2.5 only")
    }
  })

  it("leaves the other sizes as they were", () => {
    expect(videoToVideoBody.safeParse({ ...base, provider: "seedance-2-5", resolution: "1080p" }).success).toBe(true)
    expect(videoToVideoBody.safeParse({ ...base, provider: "wan", resolution: "1080p" }).success).toBe(true)
  })
})

describe("POST /v1/video-to-video — 2160p and UHD are read as 4K on Seedance 2.5", () => {
  it("rewrites the body to 4k before anything checks or prices it; another model is left as it came", async () => {
    const { fourKSpellingPreHandler } = await import("../../lib/four-k-spelling.js")
    const { videoToVideoProviderOf } = await import("@nodaro/shared/models")
    const step = fourKSpellingPreHandler((b) => videoToVideoProviderOf(b.provider))
    for (const [body, want] of [
      [{ ...base, resolution: "2160p" }, "4k"],
      [{ ...base, provider: "seedance-2-5", resolution: "UHD" }, "4k"],
      [{ ...base, provider: "wan", resolution: "2160p" }, "2160p"],
      [{ ...base, provider: "seedance-2-5", resolution: "2k" }, "2k"],
    ] as const) {
      const req = { body } as { body: Record<string, unknown> }
      await step(req as never)
      expect(req.body.resolution, JSON.stringify(body)).toBe(want)
    }
    expect(videoToVideoBody.safeParse({ ...base, resolution: "4k" }).success).toBe(true)
  })
})
