// @test-always pure request builder and poll sizing — reads no files
import { describe, it, expect } from "vitest"
import { buildKling4Request, kling4PollAttempts, KLING_4_SLOW_RENDER_MARGIN, KLING_4_SLOW_RENDER_SEC_PER_OUTPUT_SEC, type Kling4RequestArgs } from "../kling4.js"
import { KIE_CREDIT_USD, KLING_4_KEYFRAME_MODEL, KLING_4_REFERENCE_MODEL } from "../models.js"
import { MAX_POLL_ATTEMPTS_VIDEO, pollDelay } from "../client.js"
import { kling4CostUsd } from "../kling4-cost.js"

/**
 * Kling 4.0 at 4K, HDR and 4:3 (decided 2026-11-22), on both endpoints. The
 * request bodies are allow-lists (`additionalProperties: false`): an SDR body
 * stays what it always was, and `dynamic_range` rides only on an HDR run.
 */
const ref = (over: Partial<Kling4RequestArgs> = {}): Kling4RequestArgs => ({ provider: "kling-4", prompt: "a quiet street at dawn", durationSec: 5, ...over })
const kf = (over: Partial<Kling4RequestArgs> = {}): Kling4RequestArgs => ({ provider: "kling-4-keyframes", prompt: "the girl walks out", durationSec: 5, ...over })

describe("the request body per endpoint", () => {
  it("4K SDR: resolution 4k, no dynamic_range (reference and keyframe)", () => {
    for (const [args, model] of [[ref({ resolution: "4k" }), KLING_4_REFERENCE_MODEL], [kf({ resolution: "4K" }), KLING_4_KEYFRAME_MODEL]] as const) {
      const r = buildKling4Request(args)
      expect(r.model).toBe(model)
      expect(r.input.resolution).toBe("4k")
      expect(r.input).not.toHaveProperty("dynamic_range")
    }
  })

  it("HDR at 1080p: dynamic_range hdr beside the 1080p resolution", () => {
    expect(buildKling4Request(ref({ resolution: "1080p", dynamicRange: "hdr" })).input).toEqual({
      prompt: "a quiet street at dawn", duration: 5, resolution: "1080p", dynamic_range: "hdr",
    })
    expect(buildKling4Request(kf({ resolution: "1080p", dynamicRange: "hdr" })).input).toEqual({
      prompt: "the girl walks out", duration: 5, resolution: "1080p", dynamic_range: "hdr",
    })
  })

  it("4K + HDR on both endpoints", () => {
    for (const args of [ref({ resolution: "4k", dynamicRange: "hdr" }), kf({ resolution: "4k", dynamicRange: "HDR" })]) {
      const { input } = buildKling4Request(args)
      expect(input.resolution).toBe("4k")
      expect(input.dynamic_range).toBe("hdr")
    }
  })

  it("SDR named or unset sends no dynamic_range: the body is what it always was", () => {
    expect(buildKling4Request(ref({ resolution: "1080p", dynamicRange: "sdr" })).input).toEqual({ prompt: "a quiet street at dawn", duration: 5, resolution: "1080p" })
    expect(buildKling4Request(ref({ resolution: "1080p" })).input).not.toHaveProperty("dynamic_range")
  })

  it("HDR at 720p (or no size: 720p) never reaches the provider: the builder throws the refusal", () => {
    expect(() => buildKling4Request(ref({ resolution: "720p", dynamicRange: "hdr" }))).toThrow(/renders HDR at 1080p or 4k only/)
    expect(() => buildKling4Request(kf({ dynamicRange: "hdr" }))).toThrow(/not 720p/)
  })

  it("4:3 on a text-only run of both endpoints; the keyframe endpoint still drops it once a frame is attached", () => {
    expect(buildKling4Request(ref({ aspectRatio: "4:3" })).input.aspect_ratio).toBe("4:3")
    expect(buildKling4Request(kf({ aspectRatio: "4:3" })).input.aspect_ratio).toBe("4:3")
    expect(buildKling4Request(kf({ aspectRatio: "4:3", startFrameUrl: "https://cdn.example/f.png" })).input).not.toHaveProperty("aspect_ratio")
  })

  it("Kling 4.0 Flash is unchanged: 720p, no dynamic_range, no 4:3", () => {
    const { input } = buildKling4Request({ provider: "kling-4-flash", prompt: "p", durationSec: 5, resolution: "4k", dynamicRange: "hdr", aspectRatio: "4:3" })
    expect(input.resolution).toBe("720p")
    expect(input).not.toHaveProperty("dynamic_range")
    expect(input).not.toHaveProperty("aspect_ratio")
  })
})

describe("the poll budget (kling4PollAttempts)", () => {
  const waitedSec = (attempts: number): number => {
    let ms = 0
    for (let a = 1; a <= attempts; a++) ms += pollDelay(a)
    return ms / 1000
  }

  it("720p and 1080p SDR keep the video default", () => {
    expect(kling4PollAttempts({ resolution: "720p", duration: 30 }, MAX_POLL_ATTEMPTS_VIDEO, pollDelay)).toBe(MAX_POLL_ATTEMPTS_VIDEO)
    expect(kling4PollAttempts({ resolution: "1080p", duration: 30 }, MAX_POLL_ATTEMPTS_VIDEO, pollDelay)).toBe(MAX_POLL_ATTEMPTS_VIDEO)
  })

  it("4K or HDR is polled for the slow measure × the margin over the clip's seconds, never below the default", () => {
    const want = 30 * KLING_4_SLOW_RENDER_SEC_PER_OUTPUT_SEC * KLING_4_SLOW_RENDER_MARGIN
    for (const input of [{ resolution: "4k", duration: 30 }, { resolution: "1080p", dynamic_range: "hdr", duration: 30 }, { resolution: "4k", dynamic_range: "hdr", duration: 30 }]) {
      const attempts = kling4PollAttempts(input, MAX_POLL_ATTEMPTS_VIDEO, pollDelay)
      expect(attempts).toBeGreaterThan(MAX_POLL_ATTEMPTS_VIDEO)
      expect(waitedSec(attempts)).toBeGreaterThanOrEqual(want)
      expect(waitedSec(attempts - 1)).toBeLessThan(want)
    }
    // A 30 s clip: about 45 minutes, inside the 90-minute node ceiling.
    expect(waitedSec(kling4PollAttempts({ resolution: "4k", duration: 30 }, MAX_POLL_ATTEMPTS_VIDEO, pollDelay)) / 60).toBeLessThan(46)
    // A short 4K clip keeps the default, which already covers it.
    expect(kling4PollAttempts({ resolution: "4k", duration: 3 }, MAX_POLL_ATTEMPTS_VIDEO, pollDelay)).toBe(MAX_POLL_ATTEMPTS_VIDEO)
  })
})

describe("the recorded provider cost (kling4CostUsd)", () => {
  it("4K at its own rates, with and without a reference video", () => {
    expect(kling4CostUsd({ provider: "kling-4", resolution: "4k", dynamicRange: undefined, hasVideoRef: false, outputSec: 5, inputSec: 0 })).toBeCloseTo(99 * 5 * KIE_CREDIT_USD)
    expect(kling4CostUsd({ provider: "kling-4", resolution: "4k", dynamicRange: undefined, hasVideoRef: true, outputSec: 5, inputSec: 8 })).toBeCloseTo(59 * 13 * KIE_CREDIT_USD)
  })

  it("the HDR rate on the output seconds only, at each HDR size (the 2026-11-22 sample: 3 s 1080p = 3 × (42.5 + 8.5))", () => {
    expect(kling4CostUsd({ provider: "kling-4", resolution: "1080p", dynamicRange: "hdr", hasVideoRef: false, outputSec: 3, inputSec: 0 })).toBeCloseTo(153 * KIE_CREDIT_USD)
    expect(kling4CostUsd({ provider: "kling-4-keyframes", resolution: "4k", dynamicRange: "hdr", hasVideoRef: false, outputSec: 5, inputSec: 0 })).toBeCloseTo((99 + 14) * 5 * KIE_CREDIT_USD)
    // With a reference video the clips move the -ref part, never the HDR part.
    expect(kling4CostUsd({ provider: "kling-4", resolution: "1080p", dynamicRange: "hdr", hasVideoRef: true, outputSec: 5, inputSec: 20 })).toBeCloseTo((25.5 * 25 + 8.5 * 5) * KIE_CREDIT_USD)
  })
})
