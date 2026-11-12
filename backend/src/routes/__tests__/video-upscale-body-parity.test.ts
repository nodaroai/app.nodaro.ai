import { describe, it, expect, vi } from "vitest"
import { z } from "zod"

/**
 * /v1/video-upscale's body for every provider but Nodaro Video Upscale is the
 * schema it had before that provider was added: the same 400 body (message
 * and issues, in order, as `formatZodError` writes them) for every request.
 * The schema below is that earlier one, verbatim; only its provider list
 * differs, by the one new provider, so a request naming an unknown provider is
 * the one body that changes (its list names the new provider too).
 */

vi.mock("@/lib/url-validator.js", async () => ({ safeUrlSchema: (await import("zod")).z.string().url() }))

import { videoUpscaleBody } from "../video-upscale.js"
import { formatZodError } from "@/lib/zod-error.js"
import { safeUrlSchema } from "@/lib/url-validator.js"
import { SEEDANCE_DRAFT_FINALIZE_PROVIDER } from "@nodaro/shared/model-catalog"
import { NODARO_VIDEO_UPSCALE_PROVIDER, TOPAZ_VIDEO_FPS_MAX, TOPAZ_VIDEO_FPS_MIN, TOPAZ_VIDEO_RESOLUTIONS, VIDEO_UPSCALE_PROVIDERS } from "@nodaro/shared/models"

const EARLIER_PROVIDERS = VIDEO_UPSCALE_PROVIDERS.filter((p) => p !== NODARO_VIDEO_UPSCALE_PROVIDER) as unknown as [string, ...string[]]

/** The body schema before Nodaro Video Upscale, verbatim. */
const earlierBody = z.object({
  videoUrl: safeUrlSchema.optional(),
  upscaleFactor: z.enum(["1", "2", "4"]).optional(),
  targetResolution: z.enum(TOPAZ_VIDEO_RESOLUTIONS).optional(),
  targetFps: z.number().int().min(TOPAZ_VIDEO_FPS_MIN).max(TOPAZ_VIDEO_FPS_MAX).optional(),
  provider: z.enum(EARLIER_PROVIDERS).default("topaz"),
  taskId: z.string().optional(),
  kieTaskId: z.string().optional(),
  sourceJobId: z.string().optional(),
}).refine(
  (data) => {
    if (data.provider === "veo-1080p" || data.provider === "veo-4k") return !!(data.taskId ?? data.kieTaskId)
    if (data.provider === SEEDANCE_DRAFT_FINALIZE_PROVIDER) return !!(data.taskId ?? data.kieTaskId ?? data.sourceJobId)
    return !!data.videoUrl
  },
  { message: "VEO upscale requires taskId (the source generation's providerTaskId); Seedance 2.5 HD requires the draft's taskId or sourceJobId; Topaz requires videoUrl" },
)

/** What a 400 states for a body (`formatZodError`), or "accepted". */
const bodyOf = (schema: z.ZodTypeAny, body: unknown): unknown => {
  const parsed = schema.safeParse(body)
  return parsed.success ? { accepted: parsed.data } : formatZodError(parsed.error)
}

const V = "https://cdn.example.com/a.mp4"

describe("/v1/video-upscale: every provider but Nodaro Video Upscale answers exactly as before", () => {
  it.each([
    ["Topaz with no link", { provider: "topaz" }],
    ["VEO 4K with no task id", { provider: "veo-4k" }],
    ["VEO 1080p with a link but no task id", { provider: "veo-1080p", videoUrl: V }],
    ["Seedance 2.5 HD with no draft", { provider: SEEDANCE_DRAFT_FINALIZE_PROVIDER }],
    ["an empty body", {}],
    ["Topaz asked for another provider's 2k and an out-of-range frame rate", { provider: "topaz", videoUrl: V, targetResolution: "2k", targetFps: 5 }],
    ["Topaz asked for 2k", { provider: "topaz", videoUrl: V, targetResolution: "2k" }],
    ["VEO asked for 2k", { provider: "veo-4k", taskId: "t", targetResolution: "2k" }],
    ["every field wrong at once", { provider: "topaz", videoUrl: V, targetResolution: "2k", targetFps: 5, upscaleFactor: "3" }],
    ["a link that is not one", { provider: "topaz", videoUrl: "nope" }],
    ["a frame rate past the top", { provider: "topaz", videoUrl: V, targetFps: 100 }],
    ["an upper-case 4K", { videoUrl: V, targetResolution: "4K" }],
    ["null", null],
    ["a string", "str"],
    ["a list", []],
    ["nothing at all", undefined],
    ["a valid Topaz body", { provider: "topaz", videoUrl: V, targetResolution: "4k", targetFps: 60 }],
    ["a valid VEO body", { provider: "veo-4k", taskId: "t" }],
  ])("%s", (_name, body) => {
    expect(bodyOf(videoUpscaleBody, body)).toEqual(bodyOf(earlierBody, body))
  })

  it("an unknown provider: the one body that changes, by listing the new provider too", () => {
    const now = bodyOf(videoUpscaleBody, { provider: "bogus", videoUrl: V }) as { message: string }
    const before = bodyOf(earlierBody, { provider: "bogus", videoUrl: V }) as { message: string }
    expect(now.message).toContain(NODARO_VIDEO_UPSCALE_PROVIDER)
    expect(now.message.replace(`|"${NODARO_VIDEO_UPSCALE_PROVIDER}"`, "")).toBe(before.message)
  })

  it("Nodaro Video Upscale names only its own missing link, and takes any provider's target", () => {
    expect(bodyOf(videoUpscaleBody, { provider: NODARO_VIDEO_UPSCALE_PROVIDER })).toEqual({
      message: "Nodaro Video Upscale requires videoUrl",
      issues: [{ path: "(root)", message: "Nodaro Video Upscale requires videoUrl" }],
    })
    for (const targetResolution of ["720p", "1080p", "2k", "4k"]) {
      expect(bodyOf(videoUpscaleBody, { provider: NODARO_VIDEO_UPSCALE_PROVIDER, videoUrl: V, targetResolution })).toHaveProperty("accepted")
    }
  })
})
