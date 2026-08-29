import { describe, it, expect } from "vitest"
import {
  VIDEO_ANALYSIS_DURATION_BUCKETS, VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC,
  VIDEO_ANALYSIS_BUCKET_CREDITS,
  pickVideoAnalysisBucket, buildVideoAnalysisCreditId, bucketSecondsFromCreditId,
  videoAnalysisNumWindows,
  VIDEO_AUDIT_BUCKET_CREDITS,
  buildVideoAuditCreditId, videoAuditCreditsForBucket, bucketSecondsFromAuditCreditId,
} from "../video-analysis-pricing.js"
import {
  VIDEO_ANALYSIS_LLM_MODELS, VIDEO_ANALYSIS_TIERS, VIDEO_ANALYSIS_TIER_ORDER,
  VIDEO_ANALYSIS_MIXED_TIERS, VIDEO_ANALYSIS_LEGACY_MODELS,
  DEFAULT_VIDEO_ANALYSIS_TIER, DEFAULT_VIDEO_ANALYSIS_MODEL, resolveVideoAnalysisModel,
} from "../llm-models.js"

// The measured-rate constants and the $-derived `videoAnalysisBucketCredits`
// formula are PRIVATE, in @nodaroai/cloud-plugins
// (in the plugin repo) — its tests (the worked-example
// bucket-credit values and the cross-check against VIDEO_ANALYSIS_BUCKET_CREDITS
// below) live in that private package's __tests__/cost.test.ts. This file
// covers only the NON-monetary duration-bucketing, window-batching, and
// credit-id-construction logic that stays in the published package.

describe("video-analysis-pricing", () => {
  it("buckets and ids", () => {
    expect(VIDEO_ANALYSIS_DURATION_BUCKETS).toEqual([60, 180, 360, 600])
    expect(pickVideoAnalysisBucket(59.6)).toBe(60)
    expect(pickVideoAnalysisBucket(60.4)).toBe(180)
    expect(buildVideoAnalysisCreditId("gemini-3-flash", 170)).toBe("video-analysis:gemini-3-flash:180s")
    expect(buildVideoAnalysisCreditId("gemini-3.1-pro")).toBe("video-analysis:gemini-3.1-pro:600s") // unknown → ceiling
    expect(bucketSecondsFromCreditId("video-analysis:gemini-3-flash:180s")).toBe(180)
  })

  it("numWindows matches the segmentation stop condition", () => {
    expect(videoAnalysisNumWindows(60)).toBe(1)
    expect(videoAnalysisNumWindows(180)).toBe(1)
    expect(videoAnalysisNumWindows(360)).toBe(3)
    expect(videoAnalysisNumWindows(600)).toBe(5)
  })

  it("tolerance constant is exported for the worker re-check", () => {
    expect(VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC).toBe(3)
  })

  it("model SSOT is capability-derived and Gemini-only today", () => {
    expect(VIDEO_ANALYSIS_LLM_MODELS).toEqual(["gemini-3-flash", "gemini-3.6-flash", "gemini-3.1-pro"])
  })

  it("tier layer: every model-backed tier maps to a real model AND every model is tier-reachable or explicitly legacy (no vendor leak)", () => {
    // Adding a video-analysis model without a tier would silently leave it
    // unreachable / unnamed — this fails until an explicit decision is made:
    // either a tier targets it, or it's acknowledged in
    // VIDEO_ANALYSIS_LEGACY_MODELS (kept only for stored raw-id configs).
    const tierTargets = Object.values(VIDEO_ANALYSIS_TIERS)
    const legacy = Object.keys(VIDEO_ANALYSIS_LEGACY_MODELS)
    for (const m of tierTargets) expect(VIDEO_ANALYSIS_LLM_MODELS).toContain(m)
    for (const m of VIDEO_ANALYSIS_LLM_MODELS) {
      expect([...tierTargets, ...legacy], `${m} needs a tier or a legacy entry`).toContain(m)
    }
    // Legacy entries are strictly the OTHER side of that decision: a legacy
    // model is never also a tier target, must still be video-capable, and must
    // point at a real tier (the tier it used to back — UIs reverse-map via it).
    for (const [m, tier] of Object.entries(VIDEO_ANALYSIS_LEGACY_MODELS)) {
      expect(tierTargets).not.toContain(m)
      expect(VIDEO_ANALYSIS_LLM_MODELS).toContain(m)
      expect(Object.keys(VIDEO_ANALYSIS_TIERS)).toContain(tier)
    }
    // TIER_ORDER = model-backed tiers + mixed roll-plan tiers, exactly.
    expect(new Set(VIDEO_ANALYSIS_TIER_ORDER)).toEqual(
      new Set([...Object.keys(VIDEO_ANALYSIS_TIERS), ...VIDEO_ANALYSIS_MIXED_TIERS]),
    )
    // Mixed tiers are SENTINELS, never model ids — a mixed id leaking into the
    // model list would break the roll-plan dispatch in the analysis engine.
    for (const t of VIDEO_ANALYSIS_MIXED_TIERS) expect(VIDEO_ANALYSIS_LLM_MODELS).not.toContain(t)
  })

  it("fast tier never prices above pro in any bucket", () => {
    for (const bucketSec of VIDEO_ANALYSIS_DURATION_BUCKETS) {
      const fast = VIDEO_ANALYSIS_BUCKET_CREDITS[buildVideoAnalysisCreditId(VIDEO_ANALYSIS_TIERS.fast, bucketSec)]!
      const pro = VIDEO_ANALYSIS_BUCKET_CREDITS[buildVideoAnalysisCreditId(VIDEO_ANALYSIS_TIERS.pro, bucketSec)]!
      expect(fast, `fast > pro at ${bucketSec}s`).toBeLessThanOrEqual(pro)
    }
  })

  it("resolveVideoAnalysisModel: tier → model, mixed → sentinel, raw model passthrough, default pro on empty/unknown", () => {
    expect(DEFAULT_VIDEO_ANALYSIS_TIER).toBe("pro")
    expect(DEFAULT_VIDEO_ANALYSIS_MODEL).toBe("gemini-3.1-pro")
    expect(resolveVideoAnalysisModel("pro")).toBe("gemini-3.1-pro")
    // The economy tiers moved to the cheaper flash generation when they moved to
    // the cheaper transport; the newer flash now sits behind the `smart` sentinel.
    expect(resolveVideoAnalysisModel("fast")).toBe("gemini-3-flash")
    expect(resolveVideoAnalysisModel("mixed")).toBe("mixed") // roll-plan sentinel passthrough
    expect(resolveVideoAnalysisModel("mixed-fast")).toBe("mixed-fast")
    // `smart` is a sentinel too — it names an engine plan, never a model id, so the
    // engine behind it stays unpublished exactly as the mixed plans' does.
    expect(resolveVideoAnalysisModel("smart")).toBe("smart")
    // Raw passthrough keeps LEGACY stored configs running (and priced) on the
    // exact model they were saved with — never silently re-tiered.
    expect(resolveVideoAnalysisModel("gemini-3-flash")).toBe("gemini-3-flash")
    expect(resolveVideoAnalysisModel("gemini-3.6-flash")).toBe("gemini-3.6-flash")
    expect(resolveVideoAnalysisModel(undefined)).toBe("gemini-3.1-pro") // default → pro
    expect(resolveVideoAnalysisModel("")).toBe("gemini-3.1-pro")
    expect(resolveVideoAnalysisModel("nonsense")).toBe("gemini-3.1-pro") // unknown → default, never throws
  })

  it("mixed tiers price under ONE shared credit family (video-analysis:mixed:*)", () => {
    // Both variants are the identical compute plan — a per-variant price split
    // would be a phantom distinction and double the admin surface.
    for (const bucketSec of VIDEO_ANALYSIS_DURATION_BUCKETS) {
      expect(buildVideoAnalysisCreditId("mixed", bucketSec)).toBe(`video-analysis:mixed:${bucketSec}s`)
      expect(buildVideoAnalysisCreditId("mixed-fast", bucketSec)).toBe(`video-analysis:mixed:${bucketSec}s`)
      const credits = VIDEO_ANALYSIS_BUCKET_CREDITS[`video-analysis:mixed:${bucketSec}s`]
      expect(credits, `missing mixed entry for ${bucketSec}s`).toBeDefined()
      expect(Number.isInteger(credits)).toBe(true)
      // Sanity: mixed (3 fast + 2 pro rolls + refine) must never price below
      // the pro tier it supersets.
      expect(credits).toBeGreaterThanOrEqual(
        VIDEO_ANALYSIS_BUCKET_CREDITS[`video-analysis:gemini-3.1-pro:${bucketSec}s`],
      )
    }
  })

  // Full drift-detection against the live $-formula lives in the PRIVATE
  // plugin repo — the
  // formula moved there in 2026-07 and the app-side test was deleted with it,
  // so nothing in THIS repo can recompute these numbers. This is a lightweight
  // shape check that the precomputed table covers every legal id.
  it("VIDEO_ANALYSIS_BUCKET_CREDITS has a positive-integer entry for every model × bucket id", () => {
    for (const model of VIDEO_ANALYSIS_LLM_MODELS) {
      for (const bucketSec of VIDEO_ANALYSIS_DURATION_BUCKETS) {
        const id = buildVideoAnalysisCreditId(model, bucketSec)
        const credits = VIDEO_ANALYSIS_BUCKET_CREDITS[id]
        expect(credits, `missing entry for ${id}`).toBeDefined()
        expect(Number.isInteger(credits)).toBe(true)
        expect(credits).toBeGreaterThan(0)
      }
    }
  })
})

// `video-audit` ("AI Audit") is a SEPARATE node from video-analysis, but
// shares this module's bucket ladder and generator-authoritative table
// pattern. Its own $-formula and generator live in the private
// `@nodaroai/cloud-plugins` package exactly like video-analysis's — see
// `VIDEO_AUDIT_BUCKET_CREDITS`'s doc comment. These values are pasted
// verbatim from that generator's output; this file only covers the
// NON-monetary bucket/id-construction logic, same split as above.
describe("video-audit-pricing", () => {
  it("buildVideoAuditCreditId: family selection by analysisProvided, same bucket ladder/rounding as buildVideoAnalysisCreditId", () => {
    expect(buildVideoAuditCreditId({ analysisProvided: true, durationSec: 60 })).toBe("video-audit:60s")
    expect(buildVideoAuditCreditId({ analysisProvided: false, durationSec: 60 })).toBe("video-audit:auto:60s")
    expect(buildVideoAuditCreditId({ analysisProvided: true, durationSec: 170 })).toBe("video-audit:180s")
    expect(buildVideoAuditCreditId({ analysisProvided: false, durationSec: 170 })).toBe("video-audit:auto:180s")
    expect(buildVideoAuditCreditId({ analysisProvided: true, durationSec: 360 })).toBe("video-audit:360s")
    expect(buildVideoAuditCreditId({ analysisProvided: true, durationSec: 600 })).toBe("video-audit:600s")

    // Tolerance/boundary edges: 60 stays in the 60s bucket (inclusive upper
    // bound); 61/63/64 all bump straight to the next bucket (180s) — the
    // builder has NO grace period of its own (identical cliff behavior to
    // pickVideoAnalysisBucket / buildVideoAnalysisCreditId; any tolerance
    // grace is a WORKER re-check concern, private to the plugin, never baked
    // into this pure id builder).
    expect(buildVideoAuditCreditId({ analysisProvided: true, durationSec: 60 })).toBe("video-audit:60s")
    expect(buildVideoAuditCreditId({ analysisProvided: true, durationSec: 61 })).toBe("video-audit:180s")
    expect(buildVideoAuditCreditId({ analysisProvided: true, durationSec: 63 })).toBe("video-audit:180s")
    expect(buildVideoAuditCreditId({ analysisProvided: true, durationSec: 64 })).toBe("video-audit:180s")
    expect(buildVideoAuditCreditId({ analysisProvided: false, durationSec: 61 })).toBe("video-audit:auto:180s")

    // No / invalid duration → 600s ceiling composite, both families — the
    // ONLY silent-ceiling path, matching buildVideoAnalysisCreditId.
    expect(buildVideoAuditCreditId({ analysisProvided: true })).toBe("video-audit:600s")
    expect(buildVideoAuditCreditId({ analysisProvided: false })).toBe("video-audit:auto:600s")
    expect(buildVideoAuditCreditId({ analysisProvided: true, durationSec: 0 })).toBe("video-audit:600s")
    expect(buildVideoAuditCreditId({ analysisProvided: true, durationSec: -5 })).toBe("video-audit:600s")
    expect(buildVideoAuditCreditId({ analysisProvided: true, durationSec: Number.NaN })).toBe("video-audit:600s")
    // Beyond the ceiling clamps to 600s rather than an out-of-ladder bucket.
    expect(buildVideoAuditCreditId({ analysisProvided: false, durationSec: 9999 })).toBe("video-audit:auto:600s")
  })

  it("videoAuditCreditsForBucket: table lookup by resolved bucket + family, snapping a raw duration onto the ladder", () => {
    expect(videoAuditCreditsForBucket(60, false)).toBe(214)
    expect(videoAuditCreditsForBucket(60, true)).toBe(394)
    expect(videoAuditCreditsForBucket(180, false)).toBe(290)
    expect(videoAuditCreditsForBucket(360, false)).toBe(661)
    expect(videoAuditCreditsForBucket(600, false)).toBe(1070)
    expect(videoAuditCreditsForBucket(600, true)).toBe(1917)
    // Not just exact ladder values — a raw duration snaps up to its bucket.
    expect(videoAuditCreditsForBucket(70, false)).toBe(VIDEO_AUDIT_BUCKET_CREDITS["video-audit:180s"])
    expect(videoAuditCreditsForBucket(9999, true)).toBe(VIDEO_AUDIT_BUCKET_CREDITS["video-audit:auto:600s"])
  })

  it("bucketSecondsFromAuditCreditId: round-trips both families, null on bare ids / video-analysis ids / garbage", () => {
    for (const bucketSec of VIDEO_ANALYSIS_DURATION_BUCKETS) {
      expect(bucketSecondsFromAuditCreditId(`video-audit:${bucketSec}s`)).toBe(bucketSec)
      expect(bucketSecondsFromAuditCreditId(`video-audit:auto:${bucketSec}s`)).toBe(bucketSec)
      // Round-trips the builder's own output too.
      expect(bucketSecondsFromAuditCreditId(buildVideoAuditCreditId({ analysisProvided: true, durationSec: bucketSec }))).toBe(bucketSec)
      expect(bucketSecondsFromAuditCreditId(buildVideoAuditCreditId({ analysisProvided: false, durationSec: bucketSec }))).toBe(bucketSec)
    }
    expect(bucketSecondsFromAuditCreditId("video-audit")).toBeNull() // bare base-family id, no bucket
    expect(bucketSecondsFromAuditCreditId("video-audit:auto")).toBeNull() // bare auto-family id, no bucket
    // The VA-anchored id space must never be mistaken for an audit id, and vice versa.
    expect(bucketSecondsFromAuditCreditId("video-analysis:gemini-3-flash:60s")).toBeNull()
    expect(bucketSecondsFromAuditCreditId("video-analysis:mixed:600s")).toBeNull()
    expect(bucketSecondsFromCreditId("video-audit:60s")).toBeNull()
    expect(bucketSecondsFromCreditId("video-audit:auto:60s")).toBeNull()
    expect(bucketSecondsFromAuditCreditId("garbage")).toBeNull()
    expect(bucketSecondsFromAuditCreditId("")).toBeNull()
    expect(bucketSecondsFromAuditCreditId("video-audit:60seconds")).toBeNull()
    expect(bucketSecondsFromAuditCreditId("video-audit-auto:60s")).toBeNull() // hyphen, not colon — not a legal id
  })

  it("VIDEO_AUDIT_BUCKET_CREDITS: exactly both families × 4 buckets, positive integers, bare-id ceiling pins", () => {
    for (const bucketSec of VIDEO_ANALYSIS_DURATION_BUCKETS) {
      for (const id of [`video-audit:${bucketSec}s`, `video-audit:auto:${bucketSec}s`]) {
        const credits = VIDEO_AUDIT_BUCKET_CREDITS[id]
        expect(credits, `missing entry for ${id}`).toBeDefined()
        expect(Number.isInteger(credits)).toBe(true)
        expect(credits).toBeGreaterThan(0)
      }
    }
    // Exactly 2 families × 4 buckets — no stray keys, no bare-id keys (bare
    // ids live only in model-catalog.ts's pricing rows, derived from the
    // 600s bucket here, same convention as VIDEO_ANALYSIS_BUCKET_CREDITS).
    expect(Object.keys(VIDEO_AUDIT_BUCKET_CREDITS)).toHaveLength(8)
    // Bare-id values quoted in the task/catalog must equal each family's 600s ceiling.
    expect(VIDEO_AUDIT_BUCKET_CREDITS["video-audit:600s"]).toBe(1070)
    expect(VIDEO_AUDIT_BUCKET_CREDITS["video-audit:auto:600s"]).toBe(1917)
  })

  it("auto family = base family + the gemini-3-flash (legacy fast tier) row at the same bucket, exactly — single-source, never hand-added", () => {
    // Single-source assertion: reads the fast-tier row straight out of
    // VIDEO_ANALYSIS_BUCKET_CREDITS rather than re-hardcoding 180/185/514/846
    // here, so this test can't silently drift from that table either.
    for (const bucketSec of VIDEO_ANALYSIS_DURATION_BUCKETS) {
      const base = VIDEO_AUDIT_BUCKET_CREDITS[`video-audit:${bucketSec}s`]!
      const auto = VIDEO_AUDIT_BUCKET_CREDITS[`video-audit:auto:${bucketSec}s`]!
      const fastRow = VIDEO_ANALYSIS_BUCKET_CREDITS[`video-analysis:gemini-3-flash:${bucketSec}s`]!
      expect(auto - base, `auto-base mismatch at ${bucketSec}s`).toBe(fastRow)
    }
  })
})
