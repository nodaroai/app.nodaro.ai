/**
 * The workflow run's Motion Transfer stamp (`stampMotionTransferInput`) prices
 * a driving video exactly as the route's measuring step does
 * (`measureMotionTransferInput`, the one rule both call), on the length the
 * server reads — never the `videoDuration` a node carries (decided
 * 2026-11-18) — at the row the floor rule picks. The probe and the price rows
 * are stood in for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({ video: 10 as number | "unreadable" }))

vi.mock("../video-utility-probe.js", () => ({
  probeClipLengthSec: vi.fn(async () => {
    if (state.video === "unreadable") throw new Error("ffprobe: Invalid data found when processing input")
    return state.video
  }),
}))
/** The rows as seeded (migrations 668 and 670, and the flat Wan Animate rows); `state.rows` overrides one, `null` prices it nowhere. */
const ROWS: Record<string, number> = {
  "motion-transfer:720p:per-4s": 126,
  "motion-transfer:1080p:per-4s": 203,
  "kling-3.0-motion:720p:per-4s": 228,
  "kling-3.0-motion:1080p:per-4s": 302,
  "wan-animate-replace:480p:per-4s": 60,
  "wan-animate-replace:580p:per-4s": 95,
  "wan-animate-replace:720p:per-4s": 125,
  "wan-animate-move:720p:per-4s": 125,
  "wan-animate-move": 255,
  "wan-animate-move:580p": 330,
  "wan-animate-move:720p": 410,
  "wan-animate-replace": 255,
  "wan-animate-replace:580p": 330,
  "wan-animate-replace:720p": 410,
}
const rows = vi.hoisted(() => ({ override: {} as Record<string, number | null> }))
const rowOf = (id: string): number => {
  const v = id in rows.override ? rows.override[id] : ROWS[id]
  if (v === undefined || v === null) throw Object.assign(new Error(`Pricing is not configured for "${id}".`), { name: "PriceNotConfiguredError" })
  if (Number.isNaN(v)) throw new Error("the price table could not be read")
  return v
}
vi.mock("../credit-base-cost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../credit-base-cost.js")>()),
  baseCreditCostFor: async (id: string) => rowOf(id),
  unitRateBaseCredits: async (rateId: string, units: number) => Math.ceil(rowOf(rateId) * units),
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
  rows.override = {}
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
      { provider: "wan-animate-move", resolution: "480p" },
      { provider: "wan-animate-move", resolution: "580p" },
      { provider: "wan-animate-replace", resolution: "480p" },
      { provider: "wan-animate-replace", resolution: "720p" },
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
          expect(payload.motionTransferUnits, label).toBe(route.units)
          const routeBase = route.units === undefined ? undefined : Math.ceil(ROWS[route.creditId]! * route.units)
          expect(await motionTransferStampedBaseCredits("motion-transfer", payload), label).toBe(routeBase)
          // Every run is charged per second, or (Wan Animate) a floor row: never a length tier.
          expect(route.creditId, label).toMatch(/:per-4s$|^wan-animate-(move|replace)(:580p|:720p)?$/)
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
    expect(payload).toMatchObject({ provider: "kling", characterOrientation: "image", resolution: "720p", bucketKey: "motion-transfer:720p:per-4s", motionTransferUnits: 2 })
  })

  it("drops a billed-seconds value, units or row the payload carried before the video is read", async () => {
    state.video = "unreadable"
    const payload: Record<string, unknown> = { provider: "kling-3.0", videoUrl: VIDEO, motionTransferBilledSeconds: 1, motionTransferUnits: 0.25, bucketKey: "kling-3.0-motion:5s" }
    await stampMotionTransferInput("motion-transfer", payload)
    expect(payload.motionTransferBilledSeconds).toBeUndefined()
    expect(payload.motionTransferUnits).toBeUndefined()
    expect(payload.bucketKey).toBeUndefined()
  })

  it("leaves every other job untouched", async () => {
    const payload = { videoUrl: VIDEO, bucketKey: "x" }
    expect(await stampMotionTransferInput("video-sfx", payload)).toBeUndefined()
    expect(payload).toEqual({ videoUrl: VIDEO, bucketKey: "x" })
    expect(motionTransferReserveId("video-sfx", payload)).toBeUndefined()
    expect(await motionTransferStampedBaseCredits("video-sfx", payload)).toBeUndefined()
  })

  it("a run that reached its reservation without its stamp is refused, never priced at a guess", async () => {
    await expect(motionTransferStampedBaseCredits("motion-transfer", { provider: "kling-3.0", resolution: "720p" })).rejects.toThrow(/without its driving video's length/)
    await expect(motionTransferStampedBaseCredits("motion-transfer", {
      provider: "kling-3.0", resolution: "720p", motionTransferBilledSeconds: 10, bucketKey: "kling-3.0-motion:720p:per-4s",
    })).rejects.toThrow(/without its units/)
  })

  it("Kling 2.6 and Kling 3.0 at 1080p are charged per second at their rows", async () => {
    state.video = 10
    const k26 = await measureMotionTransferInput({ provider: "kling", resolution: "720p", characterOrientation: "image" }, VIDEO)
    expect(k26).toMatchObject({ ok: true, billedSeconds: 10, creditId: "motion-transfer:720p:per-4s", units: 2.5 })
    const k30 = await measureMotionTransferInput({ provider: "kling-3.0", resolution: "1080p", characterOrientation: "image" }, VIDEO)
    expect(k30).toMatchObject({ ok: true, creditId: "kling-3.0-motion:1080p:per-4s", units: 2.5 })
  })

  describe("Wan Animate: never below today's flat row for the size", () => {
    it("a price table that cannot be read refuses the run, never charges it below its floor", async () => {
      state.video = 3
      rows.override = { "wan-animate-replace:720p": Number.NaN }
      await expect(measureMotionTransferInput({ provider: "wan-animate-replace", resolution: "720p" }, VIDEO)).rejects.toThrow(/could not be read/)
    })

    it("Replace 720p: 3 s and 13 s are its flat row, charged once; 14 s and 30 s per second", async () => {
      for (const [sec, creditId, base] of [
        [3, "wan-animate-replace:720p", undefined],
        [13, "wan-animate-replace:720p", undefined],
        [14, "wan-animate-replace:720p:per-4s", 438],
        [30, "wan-animate-replace:720p:per-4s", 938],
      ] as const) {
        state.video = sec
        const payload: Record<string, unknown> = { provider: "wan-animate-replace", resolution: "720p", videoUrl: VIDEO }
        expect(await stampMotionTransferInput("motion-transfer", payload)).toBeUndefined()
        expect(payload.bucketKey, `${sec}s`).toBe(creditId)
        expect(payload.motionTransferUnits, `${sec}s`).toBe(base === undefined ? undefined : sec / 4)
        expect(await motionTransferStampedBaseCredits("motion-transfer", payload), `${sec}s`).toBe(base)
      }
    })

    it.each(["480p", "580p"])("Move at %s runs, and is charged, as 720p: its 720p rate, floored at its 720p row", async (size) => {
      state.video = 13
      const short: Record<string, unknown> = { provider: "wan-animate-move", resolution: size, videoUrl: VIDEO }
      await stampMotionTransferInput("motion-transfer", short)
      expect(short).toMatchObject({ resolution: "720p", bucketKey: "wan-animate-move:720p" })
      state.video = 14
      const long: Record<string, unknown> = { provider: "wan-animate-move", resolution: size, videoUrl: VIDEO }
      await stampMotionTransferInput("motion-transfer", long)
      expect(long).toMatchObject({ resolution: "720p", bucketKey: "wan-animate-move:720p:per-4s", motionTransferUnits: 3.5 })
      expect(await motionTransferStampedBaseCredits("motion-transfer", long)).toBe(438)
    })

    it("Replace keeps the size it names", async () => {
      state.video = 20
      const payload: Record<string, unknown> = { provider: "wan-animate-replace", resolution: "480p", videoUrl: VIDEO }
      await stampMotionTransferInput("motion-transfer", payload)
      expect(payload).toMatchObject({ resolution: "480p", bucketKey: "wan-animate-replace:480p:per-4s", motionTransferUnits: 5 })
      expect(await motionTransferStampedBaseCredits("motion-transfer", payload)).toBe(300)
    })

    it("follows the rows as an administrator prices them, never a constant", async () => {
      state.video = 20
      rows.override = { "wan-animate-replace:720p": 700 }
      expect(await measureMotionTransferInput({ provider: "wan-animate-replace", resolution: "720p" }, VIDEO)).toMatchObject({ creditId: "wan-animate-replace:720p" })
      rows.override = { "wan-animate-replace:720p:per-4s": 10 }
      expect(await measureMotionTransferInput({ provider: "wan-animate-replace", resolution: "720p" }, VIDEO)).toMatchObject({ creditId: "wan-animate-replace:720p" })
    })

    it("a floor row priced nowhere leaves the rate; a rate priced nowhere is left for its own lookup to refuse", async () => {
      state.video = 3
      rows.override = { "wan-animate-replace:720p": null }
      expect(await measureMotionTransferInput({ provider: "wan-animate-replace", resolution: "720p" }, VIDEO)).toMatchObject({ creditId: "wan-animate-replace:720p:per-4s", units: 0.75 })
      rows.override = { "wan-animate-replace:720p:per-4s": null }
      expect(await measureMotionTransferInput({ provider: "wan-animate-replace", resolution: "720p" }, VIDEO)).toMatchObject({ creditId: "wan-animate-replace:720p:per-4s", units: 0.75 })
    })
  })
})
