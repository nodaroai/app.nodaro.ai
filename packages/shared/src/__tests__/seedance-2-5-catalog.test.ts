import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import {
  FRAME_MODE_ADAPTIVE_ONLY_ASPECT,
  MAX_VIDEO_PROMPT_CHARS_BY_PROVIDER,
  NATIVE_ADAPTIVE_ASPECT,
  PRICING_DEFAULT_RESOLUTION,
  PROMPT_HARD_CEILING,
  SEEDANCE_2_5_REF_LIMITS,
  SEEDANCE_2_PROVIDERS,
  VIDEO_DURATION_TIERS,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  getMaxVideoPromptChars,
  isSeedance2Provider,
  seedance2AudioLimitSec,
} from "../model-constants.js"
import { buildVideoCreditModelIdentifier } from "../credit-identifiers.js"

const ID = "seedance-2-5"

/**
 * Seedance 2.5's shape was established by a live capability probe against
 * api.kie.ai on 2026-08-08, NOT by the published schema — KIE's docs advertise
 * a wider surface than the proxy actually accepts. These tests pin the probed
 * reality so a future "the spec sheet says 4K/180s" edit has to re-probe first.
 *
 * Re-probed 2026-08-17 (KIE "Seedance 2.5 now supports 1080P" release):
 * 1080p passes resolution validation and duration 31 is still refused.
 * Re-probed 2026-11-22: native 4K renders (3840x2160 HEVC Main 10); 2k and
 * 1440p are not offered.
 */
describe("seedance-2-5 catalog (probe-verified 2026-08-08, re-probed 2026-08-17 and 2026-11-22)", () => {
  it("is 480p/720p/1080p/4k — native 4K since 2026-11-25, no 2k or 1440p", () => {
    expect(MODEL_CATALOG[ID].resolutions).toEqual(["480p", "720p", "1080p", "4k"])
  })

  it("no other Seedance model gains 4K: only the full Seedance 2 had it before", () => {
    for (const p of ["seedance-2-fast", "seedance-2-mini", "seedance-2-5-flash", "seedance-2-5-flash-extend", "seedance-2-0-extend"]) {
      expect(MODEL_CATALOG[p]?.resolutions ?? [], p).not.toContain("4k")
    }
    expect(MODEL_CATALOG["seedance-2"].resolutions).toContain("4k")
    expect(MODEL_CATALOG["seedance-2-5-extend"].resolutions).toEqual(["480p", "720p", "1080p", "4k"])
  })

  it("runs 4-30s contiguously — 30 is the probed ceiling (31 was rejected)", () => {
    const durations = MODEL_CATALOG[ID].durations
    expect(durations?.[0]).toBe(4)
    expect(durations?.[durations.length - 1]).toBe(30)
    expect(durations).toHaveLength(27)
  })

  it("carries the wider 30/10/10 reference caps, NOT the 2.0 family's 9/3/3", () => {
    expect(VIDEO_REF_LIMITS_BY_PROVIDER[ID]).toEqual({ images: 30, videos: 10, audio: 10 })
    expect(SEEDANCE_2_5_REF_LIMITS.images).toBeGreaterThan(
      VIDEO_REF_LIMITS_BY_PROVIDER["seedance-2"]!.images!,
    )
  })

  it("joins the Seedance 2 capability family (adaptive aspect, audio, refs)", () => {
    expect(isSeedance2Provider(ID)).toBe(true)
    expect(SEEDANCE_2_PROVIDERS.has(ID)).toBe(true)
    expect(NATIVE_ADAPTIVE_ASPECT[ID]).toBe("adaptive")
    expect(MODEL_CATALOG[ID].aspectRatios).toContain("adaptive")
    expect(MODEL_CATALOG[ID].aspectRatios).toContain("21:9")
  })

  it("forces adaptive aspect in frame mode — the 2.0 SKUs deliberately do NOT", () => {
    expect(FRAME_MODE_ADAPTIVE_ONLY_ASPECT.has(ID)).toBe(true)
    for (const p of ["seedance-2", "seedance-2-fast", "seedance-2-mini"]) {
      expect(FRAME_MODE_ADAPTIVE_ONLY_ASPECT.has(p)).toBe(false)
    }
  })

  it("accepts a 30000-char prompt, and the route ceiling is wide enough to pass it through", () => {
    expect(getMaxVideoPromptChars(ID)).toBe(30000)
    // The generous route ceiling must never sit BELOW a real per-model cap, or
    // Zod hard-rejects a prompt the model would have accepted.
    const caps = Object.values(MAX_VIDEO_PROMPT_CHARS_BY_PROVIDER)
    expect(PROMPT_HARD_CEILING).toBeGreaterThanOrEqual(Math.max(...caps))
  })

  it("enforces the documented 30s reference-audio cap", () => {
    expect(seedance2AudioLimitSec(ID)).toBe(30)
  })
})

describe("seedance-2-5 pricing identifiers", () => {
  const build = (duration?: number, resolution?: string, hasVideoRef?: boolean) =>
    buildVideoCreditModelIdentifier(ID, duration, undefined, undefined, undefined, resolution, hasVideoRef)

  it("gives every allowed second its OWN tier — no round-up to a coarser rung", () => {
    // The 2.0 family's 4/8/12/15 ladder would price a 23s render at the 15s
    // rung; commit_credits only refunds a surplus, so that gap is permanent.
    expect(VIDEO_DURATION_TIERS[ID]).toHaveLength(27)
    expect(build(23, "720p")).toBe("seedance-2-5:23s:720p")
    expect(build(17, "480p")).toBe("seedance-2-5:17s:480p")
    expect(build(30, "720p")).toBe("seedance-2-5:30s:720p")
  })

  it("prices an OMITTED resolution at the model's real KIE default (720p), not the cheapest tier", () => {
    // KIE renders 720p when resolution is absent. Falling back to 480p here
    // would reserve the cheap tier against an expensive render.
    expect(PRICING_DEFAULT_RESOLUTION[ID]).toBe("720p")
    expect(build(8)).toBe("seedance-2-5:8s:720p")
  })

  it("leaves the 2.0 family's omitted-resolution behaviour untouched", () => {
    // Adding PRICING_DEFAULT_RESOLUTION must not silently reprice live models.
    for (const p of ["seedance-2", "seedance-2-fast", "seedance-2-mini"]) {
      expect(PRICING_DEFAULT_RESOLUTION[p]).toBeUndefined()
      expect(
        buildVideoCreditModelIdentifier(p, 8, undefined, undefined, undefined, undefined, false),
      ).toBe(`${p}:8s:480p`)
    }
  })

  it("prices 1080p at its own tier — a supported resolution must never clamp away", () => {
    expect(build(8, "1080p")).toBe("seedance-2-5:8s:1080p")
    expect(build(30, "1080p")).toBe("seedance-2-5:30s:1080p")
  })

  it("prices 4k at its own tier, with its -ref twin, at every length", () => {
    expect(build(4, "4k")).toBe("seedance-2-5:4s:4k")
    expect(build(8, "4k")).toBe("seedance-2-5:8s:4k")
    expect(build(30, "4k")).toBe("seedance-2-5:30s:4k")
    expect(build(10, "4k", true)).toBe("seedance-2-5:10s:4k-ref")
  })

  it("prices a size the model does not list at a seeded tier, never 4k", () => {
    for (const res of ["2k", "1440p", "8K"]) expect(build(8, res)).not.toContain(":4k")
    // 2160p and UHD are 4K spellings (decided 2026-11-27), priced on the 4K row.
    for (const res of ["2160p", "UHD"]) expect(build(8, res)).toBe("seedance-2-5:8s:4k")
    expect(buildVideoCreditModelIdentifier("seedance-2", 8, undefined, undefined, undefined, "2160p", false)).toBe("seedance-2:8s:480p")
  })

  it("selects the cheaper -ref ladder when a reference video is wired", () => {
    expect(build(8, "720p", true)).toBe("seedance-2-5:8s:720p-ref")
    expect(build(8, "480p", true)).toBe("seedance-2-5:8s:480p-ref")
  })

  it("resolves every catalog duration x resolution x ref-mode to a distinct tier", () => {
    const seen = new Set<string>()
    for (const d of MODEL_CATALOG[ID].durations!) {
      for (const res of ["480p", "720p", "1080p", "4k"]) {
        for (const ref of [false, true]) {
          const identifier = build(d, res, ref)
          expect(identifier).toBe(`${ID}:${d}s:${res}${ref ? "-ref" : ""}`)
          seen.add(identifier)
        }
      }
    }
    // 27 durations x 4 resolutions x 2 ref-modes, none collapsing onto another.
    expect(seen.size).toBe(216)
  })
})
