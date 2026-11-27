import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import { EXPLICIT_4K_ONLY_VIDEO_MODELS, explicitFourKOf, isFourKResolution, resolutionsALooseRequestMayLandOn } from "../model-constants.js"
import { referenceAudioLipSyncCreditId, seedanceLipSyncCreditId, seedanceLipSyncResolution } from "../seedance-lip-sync.js"
import { SEEDANCE_EXTEND_RATE_CREDIT_IDS, SEEDANCE_EXTEND_RATE_CREDIT_IDS_BY_PROVIDER } from "../seedance-extend-rate.js"
import { seedanceExtendRateCreditId, tailExtendResolution } from "../credit-identifiers.js"
import { normalizeModelInput } from "../model-catalog.js"

/**
 * Seedance 2.5 at 4K (decided 2026-11-22, offered from 2026-11-25): only an
 * explicit 4K renders 4K on it. A size it does not list lands where it landed
 * before it listed 4K; every other model keeps its own rule.
 */
describe("Seedance 2.5: only an explicit 4K is 4K", () => {
  it("is Seedance 2.5 and its Extend, and nothing else", () => {
    expect([...EXPLICIT_4K_ONLY_VIDEO_MODELS]).toEqual(["seedance-2-5", "seedance-2-5-extend"])
    expect(explicitFourKOf("seedance-2-5", "UHD")).toBe("4k")
    expect(explicitFourKOf("seedance-2", "2160p")).toBeUndefined()
    expect(explicitFourKOf("veo3", "2160p")).toBeUndefined()
  })

  it("reads 4k in any case as the 4K spelling, and nothing else", () => {
    for (const v of ["4k", "4K", " 4k ", "2160p", "2160P", "uhd", "UHD"]) expect(isFourKResolution(v), v).toBe(true)
    for (const v of ["2k", "8K", "1440p", "1080p", undefined, 4]) expect(isFourKResolution(v), String(v)).toBe(false)
  })

  it("a loose value may not land on 4K on Seedance 2.5; an explicit one, and any other model, keep the full list", () => {
    const all = MODEL_CATALOG["seedance-2-5"].resolutions!
    expect(resolutionsALooseRequestMayLandOn("seedance-2-5", "2k", all)).toEqual(["480p", "720p", "1080p"])
    expect(resolutionsALooseRequestMayLandOn("seedance-2-5", "4K", all)).toEqual(all)
    const s2 = MODEL_CATALOG["seedance-2"].resolutions!
    expect(resolutionsALooseRequestMayLandOn("seedance-2", "2k", s2)).toEqual(s2)
  })
})

describe("Seedance 2.5 Lip Sync at 4K", () => {
  it("prices and sends 4K on the plain 8 s 4K row", () => {
    expect(seedanceLipSyncResolution("seedance-2-5", "4k")).toBe("4k")
    expect(seedanceLipSyncResolution("seedance-2-5", "4K")).toBe("4k")
    expect(seedanceLipSyncCreditId("seedance-2-5", "4k")).toBe("seedance-2-5:8s:4k")
    expect(referenceAudioLipSyncCreditId("seedance-2-5", "4k")).toBe("seedance-2-5:8s:4k")
  })

  it("a size the model does not list (1440p) still lands on 1080p, never 4K", () => {
    expect(seedanceLipSyncResolution("seedance-2-5", "1440p")).toBe("1080p")
    expect(seedanceLipSyncCreditId("seedance-2-5", "1440p")).toBe("seedance-2-5:8s:1080p")
  })

  it("Seedance 2 keeps its own rule (its top tier, 4K) and Flash its 720p", () => {
    expect(seedanceLipSyncResolution("seedance-2", "1440p")).toBe("4k")
    expect(seedanceLipSyncResolution("seedance-2-5-flash", "4k")).toBe("720p")
  })
})

describe("Seedance 2.5 Extend at 4K", () => {
  it("has a 4K rate row; Flash Extend has none", () => {
    expect(SEEDANCE_EXTEND_RATE_CREDIT_IDS["4k"]).toBe("seedance-2-5-extend:4k:per-2s")
    expect(SEEDANCE_EXTEND_RATE_CREDIT_IDS_BY_PROVIDER["seedance-2-5-extend"]["4k"]).toBe("seedance-2-5-extend:4k:per-2s")
    expect(SEEDANCE_EXTEND_RATE_CREDIT_IDS_BY_PROVIDER["seedance-2-5-flash-extend"]["4k"]).toBeUndefined()
  })

  it("reads 4K in any case as 4K, and nothing else: priced and sent as 4K", () => {
    for (const v of ["4k", "4K", " 4k "]) {
      expect(tailExtendResolution("seedance-2-5-extend", v), v).toBe("4k")
      expect(seedanceExtendRateCreditId(v), v).toBe("seedance-2-5-extend:4k:per-2s")
    }
    // 2160p and UHD are 4K spellings (decided 2026-11-27).
    expect(tailExtendResolution("seedance-2-5-extend", "2160p")).toBe("4k")
    expect(tailExtendResolution("seedance-2-5-extend", "UHD")).toBe("4k")
    expect(tailExtendResolution("seedance-2-5-extend", "2k")).toBe("720p")
    // Flash renders no 4K; another provider matches as written.
    expect(tailExtendResolution("seedance-2-5-flash-extend", "4K")).toBe("720p")
    expect(tailExtendResolution("seedance-2-0-extend", "4K")).toBe("720p")
  })
})

describe("normalizeModelInput on Seedance 2.5", () => {
  it("keeps 4k (either case) and moves an unlisted size to the default, never 4K", () => {
    expect(normalizeModelInput("seedance-2-5", { resolution: "4k" }).resolution).toBe("4k")
    expect(normalizeModelInput("seedance-2-5", { resolution: "4K" }).resolution).toBe("4k")
    for (const v of ["2k", "1440p", "8K"]) expect(normalizeModelInput("seedance-2-5", { resolution: v }).resolution, v).not.toBe("4k")
    // 2160p and UHD are read as 4K, with an adjustment that says so.
    for (const v of ["2160p", "UHD", "uhd"]) {
      const n = normalizeModelInput("seedance-2-5", { resolution: v })
      expect(n.resolution, v).toBe("4k")
      expect(n.adjustments, v).toEqual([expect.objectContaining({ field: "resolution", from: v, to: "4k", reason: expect.stringContaining("as 4K") })])
    }
    // Seedance 2 and Veo 3 keep their own rule.
    expect(normalizeModelInput("seedance-2", { resolution: "2160p" }).adjustments[0]?.reason ?? "").not.toContain("as 4K")
  })
})

// Decided 2026-11-27: on Seedance 2.5, 2160p and UHD (any case) mean 4K on every path.
describe("Seedance 2.5: 2160p and UHD are 4K", () => {
  it("the route normalizer reads them as 4k, with an adjustment; loose values stay below 4K", async () => {
    const { normalizeVideoRequestParams } = await import("../model-catalog.js")
    for (const v of ["2160p", "2160P", "UHD", "uhd"]) {
      const n = normalizeVideoRequestParams("seedance-2-5", { resolution: v })
      expect(n.resolution, v).toBe("4k")
      expect(n.adjustments[0], v).toMatchObject({ field: "resolution", from: v, to: "4k" })
      expect(n.adjustments[0]?.reason, v).toContain("as 4K")
    }
    expect(normalizeVideoRequestParams("seedance-2-5", { resolution: "4k" }).adjustments).toEqual([])
    for (const v of ["2k", "1K", "8K", "1440p"]) expect(normalizeVideoRequestParams("seedance-2-5", { resolution: v }).resolution, v).toBe("1080p")
    // Seedance 2 and Veo 3 are unchanged: no 4K spelling of their own beyond 4k.
    expect(normalizeVideoRequestParams("seedance-2", { resolution: "uhd" }).adjustments[0]?.reason ?? "").not.toContain("as 4K")
    expect(normalizeVideoRequestParams("veo3", { resolution: "2160p" }).adjustments[0]?.reason ?? "").not.toContain("as 4K")
  })

  it("Lip Sync sends and prices them as 4K; 1440p still lands at 1080p; Seedance 2 is unchanged", () => {
    for (const v of ["2160p", "UHD"]) {
      expect(seedanceLipSyncResolution("seedance-2-5", v), v).toBe("4k")
      expect(seedanceLipSyncCreditId("seedance-2-5", v), v).toBe("seedance-2-5:8s:4k")
    }
    expect(seedanceLipSyncResolution("seedance-2-5", "1440p")).toBe("1080p")
    // Seedance 2's own rule: an unlisted size lands on its top tier, as before.
    expect(seedanceLipSyncResolution("seedance-2", "2160p")).toBe("4k")
    expect(seedanceLipSyncResolution("seedance-2-5-flash", "2160p")).toBe("720p")
  })
})
