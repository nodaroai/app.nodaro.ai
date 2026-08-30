/**
 * Video-analysis pricing — shared duration-bucket credit model.
 *
 * Single source of truth for the video-analysis node's NON-monetary credit
 * math: duration bucketing, the window-batching constants (also consumed by
 * the backend workers for real chunking, not just pricing), and the
 * composite credit-id builder. The route (charge at generate-time), the
 * worker (re-check + settle), and the frontend node UI (via
 * `buildVideoAnalysisCreditId` + `/v1/credits/model-cost`) all derive from
 * these.
 *
 * The rate constants and the formula that GENERATE these numbers live
 * PRIVATELY in the `@nodaroai/cloud-plugins` package — never in this public
 * repo. They were first moved out of this package (published Apache-2.0 on
 * npm), then out of the app repo entirely alongside the rest of the
 * video-analysis node. A cross-check test in that private package guards
 * this table so the public numbers can't silently drift from the formula.
 *
 * `VIDEO_ANALYSIS_BUCKET_CREDITS` below is the precomputed OUTPUT of that
 * private formula for every (model × bucket) combination — a plain credit
 * lookup table, not a formula, mirroring the same wire-contract pattern
 * `VIDEO_CLIP_CREDITS` uses in `film-pricing.ts`. It is what the frontend's
 * client-side cost preview (`estimateNodeCredits` in
 * workflow-editor/types.ts) reads instead of calling the formula directly.
 * The formula's own test in `@nodaroai/cloud-plugins` cross-checks this
 * table against it and fails on drift. There is deliberately NO app-side formula to
 * check against — it was moved private in 2026-07 and the old backend test
 * went with it.
 *
 * `VIDEO_AUDIT_BUCKET_CREDITS` further down is the sibling table for the
 * `video-audit` node ("AI Audit") — same module, same bucket ladder, same
 * generator-authoritative pattern, its own two credit families.
 */

export const VIDEO_ANALYSIS_DURATION_BUCKETS = [60, 180, 360, 600] as const
/** Worker re-check grace: route metadata is integer-rounded, provider durations nominal;
 *  ffprobe floats run 0.05–2 s over. Zero tolerance fails legit videos at 1:00/3:00/6:00/10:00. */
export const VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC = 3
export const VIDEO_ANALYSIS_MAX_DURATION_SEC = 600
const WINDOW_LEN = 150, WINDOW_STRIDE = 145, WINDOW_OVERLAP = 5
export const VIDEO_ANALYSIS_WINDOW = { LEN: WINDOW_LEN, STRIDE: WINDOW_STRIDE, OVERLAP: WINDOW_OVERLAP, SINGLE_MAX: 180 } as const

/**
 * Precomputed credit cost per (model, bucket) — the OUTPUT of the private
 * `videoAnalysisBucketCredits` formula (in `@nodaroai/cloud-plugins`), not a
 * formula itself. Regenerate by running that function for every
 * `VIDEO_ANALYSIS_LLM_MODELS` × duration bucket combination whenever the
 * underlying rate/token constants change (the plugin's cost test guards drift).
 * Keep in sync with
 * `docs/nodes/processing-video/video-analysis.md`.
 */
// EVERY row here is RE-DERIVED from the cloud-plugins formula at the current
// credit base — never a mechanical x10 of an older table. The formula ceils USD
// into credits, so a 10x finer base rounds LESS: the 60s flash bucket is 23,
// where x10 of the old 3 would have been 30 (a ~30% over-charge).
//
// That applies to the SENTINEL rows (`mixed:*`, `smart:*`) exactly as much as to
// the per-model rows. They were briefly shipped as a x10 on the reasoning that
// they sit outside the plugin's cross-check loop — but being outside the loop
// makes a row UNGUARDED, not exempt: `videoAnalysisBucketCredits` computes them
// from the same roll plan, so they are formula-derived too (mixed:60s is 104,
// not 110). The plugin's cost test now covers sentinels as well, so this class
// of drift fails CI instead of shipping.
// REGENERATED 2026-07-31 with the smart-tier re-base (formula inputs moved in
// the plugin: sampling 24→6 fps, which proved equal on content and better on
// cast stability; system-prompt and per-window output-token constants updated).
// Net effect: smart drops 27–47% per bucket, and the economy rows tick up 3–6%.
//
// REGENERATED 2026-08-03 — V1 hybrid-smart reprice, from the plugin's own
// generator. This is the V1 true-up of the earlier provisional
// judge/refine/frame-judge constants (the constants themselves, like the rest
// of the formula, stay private in the plugin repo — never in this public
// package). `smart` is now a multi-roll plan that always refines its merged
// result (`selectionMode` does not apply to it), and every multi-roll tier
// now carries its own explicit judge/refine terms instead of an implicit
// share of a single-pass budget.
// The economy tiers rise too (fast 33->185 @180s).
// Net effect, per bucket (every row rises):
//
//   gemini-3-flash    60s   24->180   180s   33->185   360s   86-> 514   600s  143-> 846
//   gemini-3.6-flash  60s   65->203   180s   92->218   360s  237-> 598   600s  395-> 986
//   gemini-3.1-pro    60s   87->215   180s  116->231   360s  305-> 636   600s  509->1050
//   mixed             60s  110->228   180s  149->249   360s  390-> 684   600s  651->1129
//   mixed (2026-08-04) 60s 228->268   180s  249->289   360s  684-> 724   600s 1129->1169  (+40 flat: continuity pass joined the family)
//   smart             60s  333->410   180s  470->500   360s 1135->1259   600s 1868->2064
//
// Values are pasted verbatim from the plugin generator's output — never hand
// computed. The plugin's cost test cross-checks every row, sentinels included.
// REGENERATED 2026-08-28 — recast shot-craft Stage 1: the analyser's system
// prompt grew (transition/on-screen-text doctrine + three required wire
// fields), so the plugin's system-prompt token pin moved 8_203 → 8_482 and
// 21 of 28 rows tick up by 1–4 credits (~0.1–0.3%). Output of the plugin's
// `scripts/gen-va-buckets.mjs` on `feat/va-shot-craft`, pasted verbatim.
//
// REGENERATED 2026-08-29 — recast shot-craft Stage 1.3: the analyser's system
// prompt grew again, moving the plugin's system-prompt token pin 8_482 → 8_706
// (cloud-plugins 0.209.0). 12 of 20 analysis rows and 6 of 8 audit rows tick up
// by 1–3 credits (~0.1–0.3%); the legacy `gemini-3-flash` family is unchanged.
// Output of the plugin's `scripts/gen-va-buckets.mjs`, pasted verbatim.
//
// REGENERATED 2026-08-30 — transition vocabulary v2: the analyser's doctrine now
// DEFINES twelve named transition values (and says an absent transition asserts
// nothing), which grew the analyser's system prompt once more — the plugin's
// system-prompt token pin moved 8_706 → 9_082 (cloud-plugins 0.212.0). 15 of 20
// analysis rows and 6 of 8 audit rows tick up by 1–5 credits (~0.1–0.6%); unlike
// the 8_482 → 8_706 round, the legacy `gemini-3-flash` family moves too.
// Output of the plugin's `scripts/gen-va-buckets.mjs`, pasted verbatim.
export const VIDEO_ANALYSIS_BUCKET_CREDITS: Record<string, number> = {
  // Legacy fast-tier model (pre-2026-07) — kept for stored raw-id configs.
  "video-analysis:gemini-3-flash:60s": 181,
  "video-analysis:gemini-3-flash:180s": 185,
  "video-analysis:gemini-3-flash:360s": 515,
  "video-analysis:gemini-3-flash:600s": 848,
  // Current fast tier — regenerated from the private formula for its backing
  // model; higher than the legacy fast schedule but still ≤ pro per bucket.
  "video-analysis:gemini-3.6-flash:60s": 204,
  "video-analysis:gemini-3.6-flash:180s": 219,
  "video-analysis:gemini-3.6-flash:360s": 602,
  "video-analysis:gemini-3.6-flash:600s": 992,
  "video-analysis:gemini-3.1-pro:60s": 216,
  "video-analysis:gemini-3.1-pro:180s": 232,
  "video-analysis:gemini-3.1-pro:360s": 640,
  "video-analysis:gemini-3.1-pro:600s": 1056,
  // Mixed tiers (`mixed` + `mixed-fast`) share ONE credit family — they are
  // variants of the same engine plan (plan internals live in the private
  // analysis plugin). Admin-tunable via model_pricing like every other row.
  "video-analysis:mixed:60s": 270,
  "video-analysis:mixed:180s": 291,
  "video-analysis:mixed:360s": 729,
  "video-analysis:mixed:600s": 1177,
  // SMART — the accuracy tier, and since the 2026-08-03 re-plan a multi-roll
  // plan like the others, always refined (`selectionMode` does not apply
  // here — smart always refines; it never offers a cheaper "choose" path).
  // Priced above the economy tiers because it genuinely costs more to run;
  // the only tier whose accuracy is validated against a hand-counted edit
  // list, re-validated at the current plan before this schedule shipped.
  "video-analysis:smart:60s": 413,
  "video-analysis:smart:180s": 503,
  "video-analysis:smart:360s": 1267,
  "video-analysis:smart:600s": 2076,
}

/**
 * The credit-id MODEL SEGMENT for an engine identifier: both mixed-tier
 * sentinels share the `mixed` price family (same engine plan); everything
 * else prices under its own identifier. Single source of truth — used by
 * `buildVideoAnalysisCreditId` below, so route/orchestrator/UI callers can
 * never diverge on where a sentinel prices.
 */
export function videoAnalysisCreditSegment(modelOrSentinel: string): string {
  return modelOrSentinel === "mixed-fast" ? "mixed" : modelOrSentinel
}

export function pickVideoAnalysisBucket(durationSec: number): number {
  for (const b of VIDEO_ANALYSIS_DURATION_BUCKETS) if (durationSec <= b) return b
  return VIDEO_ANALYSIS_MAX_DURATION_SEC
}

export function buildVideoAnalysisCreditId(model: string, durationSec?: number): string {
  const bucket = durationSec !== undefined && durationSec > 0
    ? pickVideoAnalysisBucket(Math.min(durationSec, VIDEO_ANALYSIS_MAX_DURATION_SEC))
    : VIDEO_ANALYSIS_MAX_DURATION_SEC // unknown → ceiling composite (the ONLY silent-ceiling path)
  return `video-analysis:${videoAnalysisCreditSegment(model)}:${bucket}s`
}

export function bucketSecondsFromCreditId(creditId: string): number | null {
  const m = /^video-analysis:.+:(\d+)s$/.exec(creditId)
  return m ? Number(m[1]) : null
}

export function videoAnalysisNumWindows(bucketSec: number): number {
  return bucketSec <= VIDEO_ANALYSIS_WINDOW.SINGLE_MAX ? 1 : 1 + Math.ceil((bucketSec - WINDOW_LEN) / WINDOW_STRIDE)
}

/**
 * Precomputed credit cost for the `video-audit` node ("AI Audit") — the same
 * pattern as `VIDEO_ANALYSIS_BUCKET_CREDITS` above: the OUTPUT of the private
 * `videoAuditBucketCredits` formula in `@nodaroai/cloud-plugins`
 * (in the plugin repo), a plain lookup table never a
 * formula, cross-checked against that package's own cost test. Shares the
 * SAME duration-bucket ladder as video-analysis (`VIDEO_ANALYSIS_DURATION_BUCKETS`
 * / `pickVideoAnalysisBucket`) — the audit re-watches the same clip, so it
 * buckets identically.
 *
 * Two credit families, selected by whether an analysis was wired into the
 * node (see `buildVideoAuditCreditId`):
 * - `video-audit:<bucket>s` — an analysis was provided; the audit re-watches
 *   the clip against it directly (native watcher roll + reasoner pass, at a
 *   safety margin — internals stay private in the plugin).
 * - `video-audit:auto:<bucket>s` — no analysis wired; the node auto-runs a
 *   fast-tier analysis first. Exactly the base family's price PLUS the
 *   `gemini-3-flash` (legacy fast tier) row from `VIDEO_ANALYSIS_BUCKET_CREDITS`
 *   at the SAME bucket — summed in the plugin's generator/formula, never
 *   hand-added here (see the single-source assertion in
 *   video-analysis-pricing.test.ts).
 *
 * Bare ids (`video-audit`, `video-audit:auto` — they live in
 * `model-catalog.ts`'s pricing rows, not as keys in this table) equal their
 * family's 600s ceiling, the same "unknown duration → ceiling" convention
 * `VIDEO_ANALYSIS_BUCKET_CREDITS`'s bare per-model catalog rows use.
 * `buildVideoAuditCreditId` never returns a bare id itself — an
 * unknown/invalid duration resolves to the bucketed 600s id, matching
 * `buildVideoAnalysisCreditId`.
 *
 * Values pasted verbatim from the plugin generator's output
 * (the plugin repo's bucket generator) —
 * never hand computed. The plugin's cost test cross-checks every row.
 */
export const VIDEO_AUDIT_BUCKET_CREDITS: Record<string, number> = {
  "video-audit:60s": 215,
  "video-audit:180s": 290,
  "video-audit:360s": 663,
  "video-audit:600s": 1073,
  "video-audit:auto:60s": 396,
  "video-audit:auto:180s": 475,
  "video-audit:auto:360s": 1178,
  "video-audit:auto:600s": 1921,
}

/**
 * Composite credit-id builder for `video-audit`. Mirrors
 * `buildVideoAnalysisCreditId`'s bucket selection and unknown/invalid-duration
 * ceiling fallback exactly (same ladder, same rounding — `durationSec <=
 * bucket`, clamped to the 600s max), but selects the FAMILY by whether an
 * analysis was already provided instead of by model: `analysisProvided:
 * true` prices under the cheaper `video-audit` family (re-audits an existing
 * analysis); `false` prices under `video-audit:auto` (the node auto-runs a
 * fast analysis first, hence that family's built-in fast-tier addition).
 */
export function buildVideoAuditCreditId(args: { analysisProvided: boolean; durationSec?: number }): string {
  const { analysisProvided, durationSec } = args
  const bucket = durationSec !== undefined && durationSec > 0
    ? pickVideoAnalysisBucket(Math.min(durationSec, VIDEO_ANALYSIS_MAX_DURATION_SEC))
    : VIDEO_ANALYSIS_MAX_DURATION_SEC // no/invalid duration → ceiling composite, same convention as buildVideoAnalysisCreditId
  const family = analysisProvided ? "video-audit" : "video-audit:auto"
  return `${family}:${bucket}s`
}

/**
 * Table lookup for a resolved bucket + family. Snaps `bucketSec` onto the
 * ladder via `pickVideoAnalysisBucket` first, so a raw duration (not just an
 * exact 60/180/360/600) is safe to pass — mirrors `buildVideoAuditCreditId`'s
 * own rounding rather than requiring the caller to pre-round.
 */
export function videoAuditCreditsForBucket(bucketSec: number, auto: boolean): number {
  const bucket = pickVideoAnalysisBucket(bucketSec)
  return VIDEO_AUDIT_BUCKET_CREDITS[`video-audit${auto ? ":auto" : ""}:${bucket}s`]!
}

/**
 * Parses a `video-audit:*` credit id back to its bucket seconds — both
 * families (`video-audit:<n>s` and `video-audit:auto:<n>s`); null on
 * anything else (a bare id with no bucket, a `video-analysis:*` id, or
 * garbage). Deliberately a SEPARATE parser from `bucketSecondsFromCreditId`
 * (anchored to the `video-analysis:` prefix and a mandatory model segment) —
 * mirrors the plugin-local audit parser so app code can never mis-parse an
 * audit id with the VA-anchored parser, or vice versa.
 */
export function bucketSecondsFromAuditCreditId(id: string): number | null {
  const m = /^video-audit(?::auto)?:(\d+)s$/.exec(id)
  return m ? Number(m[1]) : null
}
