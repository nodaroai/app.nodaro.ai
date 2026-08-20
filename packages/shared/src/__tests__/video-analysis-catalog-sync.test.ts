/**
 * The model catalog hand-copies video-analysis credit values that already live
 * in `VIDEO_ANALYSIS_BUCKET_CREDITS`. Nothing cross-checked the two, so a
 * reprice could update the table (and the DB migration) while the catalog kept
 * quoting the old numbers — and the catalog is what the model browser shows a
 * user BEFORE they run anything.
 *
 * This is the guard that was missing.
 */
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import {
  VIDEO_ANALYSIS_BUCKET_CREDITS,
  VIDEO_ANALYSIS_DURATION_BUCKETS,
  VIDEO_ANALYSIS_MAX_DURATION_SEC,
  buildVideoAnalysisCreditId,
  VIDEO_AUDIT_BUCKET_CREDITS,
} from "../video-analysis-pricing.js"
import { DEFAULT_VIDEO_ANALYSIS_MODEL } from "../llm-models.js"

/** Every `video-analysis:*` pricing row declared anywhere in the catalog. */
const catalogRows = Object.values(MODEL_CATALOG)
  .flatMap((m) => (m.pricing ?? []) as ReadonlyArray<{ identifier: string; credits: number }>)
  .filter((r) => r.identifier.startsWith("video-analysis:"))

/**
 * Every `video-audit*` pricing row declared anywhere in the catalog. NOTE:
 * no trailing colon in the filter (unlike the `video-analysis:` filter
 * above) — `video-audit`'s bare base-family id has no colon at all (there's
 * no per-model segment to be bare "within", unlike video-analysis's bare
 * per-model ids which still carry `video-analysis:<model>`), so a
 * colon-anchored filter would silently miss it.
 */
const auditCatalogRows = Object.values(MODEL_CATALOG)
  .flatMap((m) => (m.pricing ?? []) as ReadonlyArray<{ identifier: string; credits: number }>)
  .filter((r) => r.identifier.startsWith("video-audit"))

describe("model catalog video-analysis pricing", () => {
  it("declares at least one row (guard is actually wired to something)", () => {
    expect(catalogRows.length).toBeGreaterThan(0)
  })

  it("every bucketed catalog row matches VIDEO_ANALYSIS_BUCKET_CREDITS exactly", () => {
    const bucketed = catalogRows.filter((r) => /:\d+s$/.test(r.identifier))
    expect(bucketed.length).toBeGreaterThan(0)
    for (const row of bucketed) {
      expect(
        row.credits,
        `catalog "${row.identifier}" = ${row.credits} but the table says ${VIDEO_ANALYSIS_BUCKET_CREDITS[row.identifier]}`,
      ).toBe(VIDEO_ANALYSIS_BUCKET_CREDITS[row.identifier])
    }
  })

  it("every bare (no-duration) catalog row equals its max-duration ceiling", () => {
    // A bare id means "duration unknown", which the route prices at the ceiling.
    const bare = catalogRows.filter((r) => !/:\d+s$/.test(r.identifier))
    expect(bare.length).toBeGreaterThan(0)
    for (const row of bare) {
      const ceiling = VIDEO_ANALYSIS_BUCKET_CREDITS[`${row.identifier}:${VIDEO_ANALYSIS_MAX_DURATION_SEC}s`]
      expect(ceiling, `no ceiling row for ${row.identifier}`).toBeDefined()
      expect(row.credits, `catalog "${row.identifier}" must equal its ${VIDEO_ANALYSIS_MAX_DURATION_SEC}s ceiling`).toBe(ceiling)
    }
  })

  it("catalog covers every bucket it claims a model supports", () => {
    const byModel = new Map<string, Set<number>>()
    for (const r of catalogRows) {
      const m = /^video-analysis:(.+):(\d+)s$/.exec(r.identifier)
      if (!m) continue
      if (!byModel.has(m[1]!)) byModel.set(m[1]!, new Set())
      byModel.get(m[1]!)!.add(Number(m[2]))
    }
    for (const [model, buckets] of byModel) {
      expect([...buckets].sort((a, b) => a - b), `${model} bucket coverage`)
        .toEqual([...VIDEO_ANALYSIS_DURATION_BUCKETS])
    }
  })
})

/**
 * Same guard as above, for `video-audit` ("AI Audit") — a sibling node whose
 * catalog rows hand-copy `VIDEO_AUDIT_BUCKET_CREDITS`. Mirrors the
 * video-analysis describe block's structure exactly, adapted for
 * video-audit's simpler id shape (two FAMILIES — `video-audit` /
 * `video-audit:auto` — rather than an open set of per-model segments).
 */
describe("model catalog video-audit pricing", () => {
  it("declares at least one row (guard is actually wired to something)", () => {
    expect(auditCatalogRows.length).toBeGreaterThan(0)
  })

  it("every bucketed catalog row matches VIDEO_AUDIT_BUCKET_CREDITS exactly", () => {
    const bucketed = auditCatalogRows.filter((r) => /:\d+s$/.test(r.identifier))
    expect(bucketed.length).toBeGreaterThan(0)
    for (const row of bucketed) {
      expect(
        row.credits,
        `catalog "${row.identifier}" = ${row.credits} but the table says ${VIDEO_AUDIT_BUCKET_CREDITS[row.identifier]}`,
      ).toBe(VIDEO_AUDIT_BUCKET_CREDITS[row.identifier])
    }
  })

  it("every bare (no-duration) catalog row equals its 600s ceiling", () => {
    // A bare id means "duration unknown", which prices at the ceiling.
    const bare = auditCatalogRows.filter((r) => !/:\d+s$/.test(r.identifier))
    expect(bare.length).toBe(2) // exactly `video-audit` + `video-audit:auto`
    for (const row of bare) {
      const ceiling = VIDEO_AUDIT_BUCKET_CREDITS[`${row.identifier}:${VIDEO_ANALYSIS_MAX_DURATION_SEC}s`]
      expect(ceiling, `no ceiling row for ${row.identifier}`).toBeDefined()
      expect(row.credits, `catalog "${row.identifier}" must equal its ${VIDEO_ANALYSIS_MAX_DURATION_SEC}s ceiling`).toBe(ceiling)
    }
  })

  it("catalog covers every bucket for both families", () => {
    const byFamily = new Map<string, Set<number>>()
    for (const r of auditCatalogRows) {
      const m = /^(video-audit(?::auto)?):(\d+)s$/.exec(r.identifier)
      if (!m) continue
      if (!byFamily.has(m[1]!)) byFamily.set(m[1]!, new Set())
      byFamily.get(m[1]!)!.add(Number(m[2]))
    }
    expect([...byFamily.keys()].sort()).toEqual(["video-audit", "video-audit:auto"])
    for (const [family, buckets] of byFamily) {
      expect([...buckets].sort((a, b) => a - b), `${family} bucket coverage`)
        .toEqual([...VIDEO_ANALYSIS_DURATION_BUCKETS])
    }
  })
})

/**
 * The BARE `video-analysis` node-type id — the one every colon-scoped guard misses.
 *
 * `getModelIdentifier` (frontend) has no video-analysis branch, so it falls through
 * to `return nodeType` and the run-credits estimate resolves this exact id. It was
 * seeded at 3 credits in migration 247 with the comment "= flash 600s" and then
 * skipped by FIVE consecutive repricings (248, 259, 273, 275, 276), every one of
 * which matched only `video-analysis:` prefixes — including this test file's own
 * `catalogRows` filter above. A real run reserves 21-200, so the pre-run balance
 * check was quoting 3 for a run it would then refuse.
 *
 * The value is the MAXIMUM of the table, not the default tier at the ceiling
 * bucket: this test's first version pinned the latter and failed immediately,
 * because the default (pro) tops out at 120 while `mixed` reaches 200. Reached only
 * when BOTH model and duration are unknown, so it has to bound every row.
 */
describe("bare video-analysis node-type credit id", () => {
  it("bounds EVERY bucketed row — an unknown-duration estimate must never UNDER-quote", () => {
    const ceiling = Math.max(...Object.values(VIDEO_ANALYSIS_BUCKET_CREDITS))
    for (const [id, credits] of Object.entries(VIDEO_ANALYSIS_BUCKET_CREDITS)) {
      expect(credits, `${id} exceeds the bare-id ceiling ${ceiling}`).toBeLessThanOrEqual(ceiling)
    }
    // The migration writes this number; keep them in lockstep (277 wrote 200,
    // 279 wrote 739, 283 wrote 346, 284 wrote 350 — `smart` owns the ceiling and
    // gained the continuity pass — 288 wrote 3500 as a x10 of that, 293
    // corrected it to 3496 by RE-DERIVING `smart:600s` from the plugin formula,
    // 294 wrote 1868: the smart re-base measured 6 fps equal-or-better than
    // 24 and the schedule regenerated ~47% lower at the ceiling bucket, and 300
    // wrote 2064: the V1 hybrid-smart reprice (task A3) moved `smart` to a
    // multi-roll plan (native skeleton + donor rolls, always refined) and
    // trued up every tier's judge/refine terms).
    expect(ceiling).toBe(2064)
  })

  it("the bare id still bounds the default tier at the ceiling bucket", () => {
    // Pins the reason the bare id is the table MAX rather than the intuitive
    // "default model, longest video" value, so nobody re-derives it wrongly.
    //
    // Was `toBeLessThan`, on the premise that `mixed` cost strictly more than the
    // default tier. That premise is gone: all tiers resolve to the same single
    // pass, so every row at a given bucket is equal and the correct assertion is
    // the INVARIANT (the bare id must never under-quote), not the old strict gap.
    // Should tiers ever diverge again this still holds, and the ceiling check
    // above catches any row that outgrows it.
    const defaultAtCeiling = VIDEO_ANALYSIS_BUCKET_CREDITS[
      buildVideoAnalysisCreditId(DEFAULT_VIDEO_ANALYSIS_MODEL, VIDEO_ANALYSIS_MAX_DURATION_SEC)
    ]!
    expect(defaultAtCeiling).toBeLessThanOrEqual(Math.max(...Object.values(VIDEO_ANALYSIS_BUCKET_CREDITS)))
  })
})
