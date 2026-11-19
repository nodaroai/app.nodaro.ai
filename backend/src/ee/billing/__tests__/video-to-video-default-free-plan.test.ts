/**
 * A /v1/video-to-video request that names no model is a Seedance 2.5 edit, so
 * on an account that has never paid it meets the rule every Seedance 2.5 run
 * meets: the model is not available on free credits. No new rule, and no
 * fallback to another model: the body the route's first pre-check names the
 * default in is judged exactly as one that names `seedance-2-5` itself.
 */
import { describe, it, expect, vi } from "vitest"
import type { FastifyRequest } from "fastify"

vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { nameDefaultVideoToVideoModel, seedanceEditRunBody } from "../../../routes/video-to-video.js"
import { FREE_VIDEO_LIMITS_DEFAULTS, freeVideoModelRefusal, freeVideoRefusal, freeVideoRequestOf } from "../free-video-limits.js"

const CLIP = "https://cdn.example.com/clip.mp4"

/** The body the credit guard reads: the default named, then the Seedance rewrite. */
async function guardBody(sent: Record<string, unknown>): Promise<Record<string, unknown>> {
  const req = { body: { ...sent } } as unknown as FastifyRequest
  await nameDefaultVideoToVideoModel(req)
  return seedanceEditRunBody(req.body as Record<string, unknown>)
}

describe("a Video to Video request with no model, on free credits", () => {
  it("is refused as Seedance 2.5 is: the existing message, by name", async () => {
    const body = await guardBody({ videoUrl: CLIP, prompt: "make it night" })
    expect(body.provider).toBe("seedance-2-5")
    const refusal = freeVideoRefusal(freeVideoRequestOf(body)!, FREE_VIDEO_LIMITS_DEFAULTS)
    expect(refusal?.error).toContain("Seedance 2.5 is not available on free credits.")
    // The same answer the model's own id gives, and an explicit request gives.
    expect(freeVideoModelRefusal("seedance-2-5", FREE_VIDEO_LIMITS_DEFAULTS)?.error).toBe(refusal?.error)
    const named = await guardBody({ videoUrl: CLIP, prompt: "make it night", provider: "seedance-2-5" })
    expect(freeVideoRefusal(freeVideoRequestOf(named)!, FREE_VIDEO_LIMITS_DEFAULTS)?.error).toBe(refusal?.error)
  })

  it("is not limited where the free limits are switched off", async () => {
    const body = await guardBody({ videoUrl: CLIP, prompt: "make it night" })
    expect(freeVideoRefusal(freeVideoRequestOf(body)!, { ...FREE_VIDEO_LIMITS_DEFAULTS, enabled: false })).toBeNull()
  })
})
