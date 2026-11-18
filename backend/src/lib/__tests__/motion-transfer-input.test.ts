/**
 * The workflow run's Motion Transfer stamp (`stampMotionTransferInput`) prices
 * a driving video exactly as the route's measuring step does
 * (`measureMotionTransferInput`, the one rule both call), on the length the
 * server measures — never the `videoDuration` a node carries (decided
 * 2026-11-18). The probe and the price row are stood in for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({ video: 10 as number | "unreadable" }))

vi.mock("../video-utility-probe.js", () => ({
  probeClipLengthSec: vi.fn(async () => {
    if (state.video === "unreadable") throw new Error("ffprobe: Invalid data found when processing input")
    return state.video
  }),
}))
vi.mock("../credit-base-cost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../credit-base-cost.js")>()),
  unitRateBaseCredits: async (rateId: string, units: number) => (rateId === "kling-3.0-motion:720p:per-4s" ? Math.ceil(228 * units) : 0),
}))
vi.mock("../url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import {
  measureMotionTransferInput,
  motionTransferReserveId,
  motionTransferStampedBaseCredits,
  stampMotionTransferInput,
} from "../motion-transfer-input.js"

const VIDEO = "https://cdn.test/dance.mp4"

beforeEach(() => {
  state.video = 10
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("stampMotionTransferInput — the workflow run's twin of the route's measuring step", () => {
  it("a node carrying a false videoDuration is priced on the measured length", async () => {
    const payload: Record<string, unknown> = { provider: "kling-3.0", resolution: "720p", videoUrl: VIDEO, videoDuration: 1 }
    expect(await stampMotionTransferInput("motion-transfer", payload)).toBeUndefined()
    expect(payload).toMatchObject({ videoDuration: 10, motionTransferBilledSeconds: 10, bucketKey: "kling-3.0-motion:720p:per-4s" })
    expect(motionTransferReserveId("motion-transfer", payload)).toBe("kling-3.0-motion:720p:per-4s")
    expect(await motionTransferStampedBaseCredits("motion-transfer", payload)).toBe(570)
  })

  it("prices the same video as the route does, on every model, size and orientation", async () => {
    const lengths = [3, 4.2, 5, 6.01, 9.96, 10.05, 12, 15.04, 29.9, 30.05]
    const runs = [
      { provider: "kling", resolution: "720p" },
      { provider: "kling", resolution: "1080p" },
      { provider: "kling-3.0", resolution: "720p" },
      { provider: "kling-3.0", resolution: "480p" },
      { provider: "kling-3.0", resolution: "1080p" },
      { provider: "wan-animate-move", resolution: "580p" },
      { provider: "wan-animate-replace", resolution: "1080p" },
    ]
    for (const sec of lengths) {
      for (const run of runs) {
        for (const characterOrientation of ["image", "video"] as const) {
          state.video = sec
          const route = await measureMotionTransferInput({ ...run, characterOrientation }, VIDEO)
          const payload: Record<string, unknown> = { ...run, characterOrientation, videoUrl: VIDEO, videoDuration: 60 }
          const refusal = await stampMotionTransferInput("motion-transfer", payload)
          const label = `${run.provider} ${run.resolution} ${characterOrientation} ${sec}s`
          if (!route.ok) {
            expect(refusal, label).toEqual({ code: route.code, message: route.message })
            continue
          }
          expect(refusal, label).toBeUndefined()
          expect(payload.bucketKey, label).toBe(route.creditId)
          expect(payload.motionTransferBilledSeconds, label).toBe(route.billedSeconds)
          const routeBase = route.units === undefined ? undefined : Math.ceil(228 * route.units)
          expect(await motionTransferStampedBaseCredits("motion-transfer", payload), label).toBe(routeBase)
        }
      }
    }
  })

  it("refuses what the route refuses: too short, past the limit, unreadable, a link that is no URL", async () => {
    state.video = 2
    expect((await stampMotionTransferInput("motion-transfer", { provider: "kling", videoUrl: VIDEO }))?.code).toBe("video_too_short")
    state.video = 11
    expect((await stampMotionTransferInput("motion-transfer", { provider: "kling", videoUrl: VIDEO }))?.code).toBe("video_too_long")
    expect(await stampMotionTransferInput("motion-transfer", { provider: "kling", characterOrientation: "video", videoUrl: VIDEO })).toBeUndefined()
    state.video = "unreadable"
    expect((await stampMotionTransferInput("motion-transfer", { provider: "kling", videoUrl: VIDEO }))?.code).toBe("video_unreadable")
    state.video = 5
    expect((await stampMotionTransferInput("motion-transfer", { provider: "kling", videoUrl: "/etc/passwd" }))?.code).toBe("video_unreadable")
  })

  it("resolves an absent or unknown provider and orientation to what the worker runs (Kling 2.6, image orientation)", async () => {
    state.video = 8
    const payload: Record<string, unknown> = { provider: "nope", videoUrl: VIDEO }
    expect(await stampMotionTransferInput("motion-transfer", payload)).toBeUndefined()
    expect(payload).toMatchObject({ provider: "kling", characterOrientation: "image", resolution: "720p", bucketKey: "motion-transfer:10s" })
  })

  it("drops a billed-seconds value or row the payload carried before measuring", async () => {
    state.video = "unreadable"
    const payload: Record<string, unknown> = { provider: "kling-3.0", videoUrl: VIDEO, motionTransferBilledSeconds: 1, bucketKey: "kling-3.0-motion:5s" }
    await stampMotionTransferInput("motion-transfer", payload)
    expect(payload.motionTransferBilledSeconds).toBeUndefined()
    expect(payload.bucketKey).toBeUndefined()
  })

  it("leaves every other job untouched", async () => {
    const payload = { videoUrl: VIDEO, bucketKey: "x" }
    expect(await stampMotionTransferInput("video-sfx", payload)).toBeUndefined()
    expect(payload).toEqual({ videoUrl: VIDEO, bucketKey: "x" })
    expect(motionTransferReserveId("video-sfx", payload)).toBeUndefined()
    expect(await motionTransferStampedBaseCredits("video-sfx", payload)).toBeUndefined()
  })

  it("a per-second run that reached its reservation unmeasured is refused, never priced at a guess", async () => {
    await expect(motionTransferStampedBaseCredits("motion-transfer", { provider: "kling-3.0", resolution: "720p" })).rejects.toThrow(/without its measured video/)
  })
})
