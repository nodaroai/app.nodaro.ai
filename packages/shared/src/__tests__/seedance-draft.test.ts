import { describe, it, expect } from "vitest"
import {
  SEEDANCE_DRAFT_MODELS,
  isSeedanceDraftCapable,
  seedanceDraftFinalizeBillableSec,
  seedanceDraftFinalizeCreditId,
} from "../seedance-draft.js"
import { MODEL_CATALOG, normalizeVideoRequestParams } from "../model-catalog.js"
import { VIDEO_UPSCALE_PROVIDERS } from "../model-constants.js"

describe("Seedance Draft — the one capability gate", () => {
  it("only Seedance 2.5 offers a draft", () => {
    expect([...SEEDANCE_DRAFT_MODELS]).toEqual(["seedance-2-5"])
    expect(isSeedanceDraftCapable("seedance-2-5")).toBe(true)
    for (const other of ["seedance-2", "seedance-2-fast", "kling-3.0", "seedance-2-5-hd", undefined]) {
      expect(isSeedanceDraftCapable(other)).toBe(false)
    }
  })

  it("every draft-capable model is a real 480p-capable catalog model", () => {
    for (const id of SEEDANCE_DRAFT_MODELS) {
      expect(MODEL_CATALOG[id]?.resolutions).toContain("480p")
    }
  })

  it("the finalize is a Video Upscale provider with a catalog entry", () => {
    expect(VIDEO_UPSCALE_PROVIDERS).toContain("seedance-2-5-hd")
    expect(MODEL_CATALOG["seedance-2-5-hd"]?.modes).toEqual(["video-upscale"])
  })
})

describe("normalizeVideoRequestParams — draft forces 480p", () => {
  it("coerces a stale 720p to 480p and discloses it", () => {
    const out = normalizeVideoRequestParams("seedance-2-5", { resolution: "720p", draft: true })
    expect(out.resolution).toBe("480p")
    expect(out.adjustments).toEqual([expect.objectContaining({ field: "resolution", from: "720p", to: "480p" })])
  })

  it("fills an omitted resolution with 480p silently", () => {
    const out = normalizeVideoRequestParams("seedance-2-5", { draft: true })
    expect(out.resolution).toBe("480p")
    expect(out.adjustments).toEqual([])
  })

  it("leaves 480p alone", () => {
    expect(normalizeVideoRequestParams("seedance-2-5", { resolution: "480p", draft: true }).adjustments).toEqual([])
  })

  it("is ignored by a model that has no draft, and when draft is off", () => {
    expect(normalizeVideoRequestParams("seedance-2", { resolution: "720p", draft: true }).resolution).toBe("720p")
    expect(normalizeVideoRequestParams("seedance-2-5", { resolution: "1080p", draft: false }).resolution).toBe("1080p")
    expect(normalizeVideoRequestParams("seedance-2-5", { resolution: "1080p" }).resolution).toBe("1080p")
  })
})

describe("finalize credit ids", () => {
  it("bills whole seconds: a container's 4.04 s is 4 s, 4.3 s is 5 s", () => {
    expect(seedanceDraftFinalizeBillableSec(4.04)).toBe(4)
    expect(seedanceDraftFinalizeBillableSec(4.25)).toBe(4)
    expect(seedanceDraftFinalizeBillableSec(4.3)).toBe(5)
    expect(seedanceDraftFinalizeBillableSec(12)).toBe(12)
  })

  it("clamps onto the seeded 4-30 s ladder", () => {
    expect(seedanceDraftFinalizeBillableSec(2)).toBe(4)
    expect(seedanceDraftFinalizeBillableSec(31.5)).toBe(30)
  })

  it("encodes output seconds plus a -ref twin, like the generation ladder", () => {
    expect(seedanceDraftFinalizeCreditId(4.04, false)).toBe("seedance-2-5-hd:4s")
    expect(seedanceDraftFinalizeCreditId(8, true)).toBe("seedance-2-5-hd:8s-ref")
    expect(seedanceDraftFinalizeCreditId(30, false)).toBe("seedance-2-5-hd:30s")
  })
})
