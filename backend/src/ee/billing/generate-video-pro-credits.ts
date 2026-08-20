import {
  MODEL_CATALOG,
  buildVideoCreditModelIdentifier,
  SEEDANCE_2_CONTINUATION_REF_SEC,
  isMinimaxH3Provider,
  normalizeMinimaxH3Resolution,
  segmentDurationsFor,
  minSegmentSecFor,
  maxSegmentSecFor,
  hasContiguousSegmentDurations,
  supportsExtendRender,
  supportsEndAnchor,
} from "@nodaro/shared"
import { STATIC_CREDIT_COSTS, PriceNotConfiguredError, getModelCreditBaseCost } from "./credits.js"

/**
 * Money-authoritative closed-form for the `generate-video-pro` node.
 *
 * The pro node stitches multiple KIE Seedance-2-family segments into one
 * long clip when the requested duration exceeds a single segment's max
 * (15s). Below that threshold it behaves exactly like a normal single-shot
 * t2v run (mode "single"); above it, it splits into N segments (mode
 * "multi") and reserves a fee-base PLUS the per-second cost of the segments
 * (the first segment billed at the no-video-ref rate, every subsequent
 * segment billed at the video-ref rate since it re-seeds off the previous
 * segment's tail frames).
 */
export interface GenerateVideoProPricing {
  mode: "single" | "multi"
  clampedDurationSec: number
  segmentCount: number
  totalRawSec: number
  segmentDurations: number[]
  /**
   * The explicit `segmentDurations` were SNAPPED onto the provider's duration
   * menu, so `segmentDurations` above deliberately differs from what was asked
   * for (2026-08-06).
   *
   * A DECLARATION, and load-bearing as one: the plugin route's echo guard
   * refuses a differing array because that is how an app predating the
   * `segmentDurations` field is detected (it prices the classic split and
   * silently ignores the request). Only an explicit signal tells that apart
   * from a deliberate snap, which is why this cannot be inferred from the
   * arrays differing.
   *
   * Additive-optional: absent means priced verbatim, which is what every
   * pre-2026-08-06 caller already assumes.
   */
  segmentDurationsSnapped?: true
  feeBase: number // 0 when single
  noRefPerSec: number
  refPerSec: number
  tailSec: number
  reserveBase: number // pre-markup
  /**
   * The resolution this run was actually PRICED at — the request clamped onto
   * the provider's catalog tiers (see `clampResolution`), or its own vocabulary
   * for Hailuo 3.
   *
   * ECHOED so the render can use it. The clamp snaps to the NEAREST tier, which
   * can be DOWNWARD; a provider handed the raw request while billing quoted the
   * clamp would deliver something the reserve never covered. Rendering this
   * value is what makes price and delivery the same by construction.
   *
   * Additive-optional: absent means a caller predating the field, which renders
   * the raw request exactly as it always has.
   */
  resolution?: string
  creditIdentifier?: string // single mode only
  /** CONTINUATION billing floor (2026-07-21): 1-based segment the CHILD job
   *  starts paying from — segments below it were delivered and billed by the
   *  parent. Set only by `computeGenerateVideoProContinuationPricing`; the
   *  plugin's `commitBase` twin bills feeBase + segments ≥ this index (all at
   *  the ref rate + one continuation tail each). Absent/1 → classic. */
  billFromSegment?: number
  /** KEYFRAMES render method (2026-08-03) — set ONLY when the run was priced
   *  under it. Scene-decomposed rendering: each segment is generated from its
   *  own start/end anchor frames instead of a continuation tail off the
   *  previous segment, so every segment bills at the NO-ref per-second rate
   *  and the `refPerSec × tailSec × (n−1)` continuation term is gone. Absent
   *  → the classic extend chain, byte-identical. */
  renderMethod?: "keyframes"
  /** KEYFRAMES anchor budget (pre-markup, included in `reserveBase`) —
   *  WORST CASE: 2 anchor images per segment at the anchor image model's base
   *  credit. The engine generates fewer whenever a scene reuses a neighbour's
   *  frame, and its metered commit settles the actual count, so this only ever
   *  refunds DOWN. Absent on extend runs and on keyframes CONTINUATIONS (which
   *  reuse the parent's already-paid-for anchors). */
  anchorReserve?: number
  /** SCENE-SET continue (2026-08-04, keyframes only): the EXACT sorted,
   *  deduped 1-based segments the child regenerates — an arbitrary set, not a
   *  suffix. Set ONLY by `computeGenerateVideoProContinuationPricing` when the
   *  caller passed `segments`; its presence is also the CAPABILITY ECHO the
   *  plugin feature-detects (an older app ignores the arg and returns
   *  suffix-shaped pricing with this field absent → the plugin 503s rather
   *  than dispatching a mispriced run). The plugin's `commitBase` twin bills
   *  feeBase + only the DONE members of this set, each at the no-ref rate.
   *  `billFromSegment` still carries `min(set)` beside it for every consumer
   *  that reasons about the adopted prefix. */
  billSegments?: number[]
  /** PER-SEGMENT COSTS (2026-08-05, keyframes on FLAT-priced providers) — the
   *  credit cost of each segment, index-aligned with `segmentDurations`.
   *
   *  Set ONLY when the provider has no linear `${id}:8s:${res}` composite to
   *  divide (veo3 family, gemini-omni-video, kling-3-omni, grok-i2v,
   *  happyhorse-ref2v — all priced flat per generation). For those runs
   *  `noRefPerSec`/`refPerSec` are 0 and carry no meaning, so the plugin's
   *  metered `commitBase` MUST bill from this array; multiplying a 0 rate by a
   *  duration would commit nothing and refund the whole reserve.
   *
   *  Absent on every per-second provider, whose reserve and commit stay
   *  byte-identical to the pre-expansion closed-form. Additive-optional: a
   *  plugin predating the field cannot dispatch these providers anyway (its
   *  route enum rejects them), so there is no mis-commit window. */
  segmentCosts?: number[]
  /** END-ANCHOR CAPABILITY (2026-08-05) — whether this provider honours a
   *  strict closing frame, so the keyframes anchor wave should generate an end
   *  still as well as a start still.
   *
   *  Sent because the PLUGIN CANNOT DERIVE IT. Its pinned `@nodaro/shared` lags
   *  the app's by whole releases (the deployed copy has no `minimax-h3` in
   *  MODEL_CATALOG at all), so a catalog read there answers for a stale model
   *  set. The app always has the fresh catalog, and this rides on a response
   *  the plugin already consumes.
   *
   *  Its absence is the old behaviour — the plugin's `wantEndAnchor` falls back
   *  to its Seedance-family name check, which is exactly what shipped before. */
  endAnchors?: boolean
}

/** Image model the keyframes engine generates scene anchors with — GPT Image 2
 *  at 2K since 2026-08-04 (was `nano-banana-pro`). The `:2K` COMPOSITE is the
 *  billed identifier, not the bare id: bare `gpt-image-2` is the 1K price and
 *  would under-reserve every anchor by half (nano-banana-pro's base covered
 *  1K AND 2K, which is why the old constant was bare). */
const KEYFRAME_ANCHOR_MODEL = "gpt-image-2:2K"
/** Wide-aspect fallback — GPT Image 2 renders only `auto/1:1/16:9/9:16/4:3/
 *  3:4`, so ratios it cannot do (21:9) generate on nano-banana-pro and must
 *  price at nano-banana-pro. Its base already covers 2K (no composite). */
const KEYFRAME_ANCHOR_FALLBACK_MODEL = "nano-banana-pro"
/** Worst-case anchors per segment (start + end frame). */
const ANCHORS_PER_SEGMENT = 2

/**
 * Billed identifier for ONE anchor at a given aspect — CATALOG-DRIVEN off the
 * base model's documented `aspectRatios`, never a hand-kept ratio list, so
 * widening GPT Image 2 moves price and generation together.
 *
 * TWIN: the anchor-model resolver in the plugin repo — same predicate, same
 * fallback, and the plugin resolves `"adaptive"`/absent to `"16:9"` before
 * sending. A mismatch is a mispriced run, so keep them in lock-step.
 *
 * ABSENT aspect → the FALLBACK (pricier) id, deliberately. The only caller
 * that omits it is a plugin predating the field, whose engine still generates
 * every anchor on nano-banana-pro — so this reserves exactly what that plugin
 * spends. Guessing the cheaper id there would under-reserve a real run.
 */
function anchorCreditIdFor(aspectRatio?: string): string {
  if (!aspectRatio) return KEYFRAME_ANCHOR_FALLBACK_MODEL
  const base = KEYFRAME_ANCHOR_MODEL.split(":")[0]!
  const supported = MODEL_CATALOG[base]?.aspectRatios as readonly string[] | undefined
  return supported?.includes(aspectRatio) ? KEYFRAME_ANCHOR_MODEL : KEYFRAME_ANCHOR_FALLBACK_MODEL
}

/**
 * Keyframes reserve for a set of segment durations: every segment at the
 * NO-ref per-second rate (each is generated from its own anchors — nothing
 * re-seeds off a previous segment's tail), with no continuation-tail term.
 * Per-segment `ceil` so a continuation of a keyframes run bills exactly the
 * parent's terms for the segments it re-renders.
 */
function keyframesSegmentsBase(durations: number[], noRefPerSec: number): number {
  return durations.reduce((sum, d) => sum + Math.ceil(d * noRefPerSec), 0)
}

// ---------------------------------------------------------------------------
// Segment-split closed-form. Module-local transcription of the Task 2
// function body (verbatim) — plugin/frontend code is not importable from
// ee/, so this copy is the single implementation this file depends on. Keep
// it IN SYNC with the twin if the split algorithm ever changes.
// ---------------------------------------------------------------------------

/** The ONLY hardcoded split constant left: the seam allowance per join. Every
 *  other bound is read off the provider's catalog duration set (see
 *  `boundsFor`) — `{minSeg: 4, maxSeg: 15}` was only ever correct for the
 *  Seedance-2 family and silently mispriced veo3 (4/6/8) and grok-i2v (6/10). */
const SPLIT = { lossSec: 0.3 } as const

/** Per-provider segment bounds, derived from `MODEL_CATALOG[provider].durations`. */
interface SegmentBounds {
  minSeg: number
  maxSeg: number
  /** Every single-segment length the provider will accept, ascending. */
  allowed: readonly number[]
  /** True when `allowed` is every integer in [minSeg, maxSeg] — the classic
   *  arithmetic splitter is only valid then. */
  contiguous: boolean
}

function boundsFor(provider: string): SegmentBounds {
  const allowed = segmentDurationsFor(provider)
  if (allowed.length === 0) {
    // An unknown provider keeps the established hard-fail contract: the route
    // maps PriceNotConfiguredError to a 503 `price_not_configured`, which is
    // what every caller already handles. Before segment bounds became
    // catalog-driven this surfaced from the `:8s:` composite lookup a few
    // lines later; the shape must not change just because the check moved
    // earlier. A model that IS catalogued but declares no durations is a
    // config bug, not a pricing gap, so it throws plainly.
    if (MODEL_CATALOG[provider] === undefined) {
      throw new PriceNotConfiguredError(provider)
    }
    throw new Error(`generate-video-pro: ${provider} declares no segment durations`)
  }
  return {
    minSeg: minSegmentSecFor(provider),
    maxSeg: maxSegmentSecFor(provider),
    allowed,
    contiguous: hasContiguousSegmentDurations(provider),
  }
}

/** Nearest allowed segment length (NOT a clamp) — ties round down, matching
 *  `snapToAllowedDuration` in the KIE provider layer so the billed tier is the
 *  one the provider actually renders. */
function snapToAllowed(d: number, allowed: readonly number[]): number {
  return allowed.reduce((best, a) => (Math.abs(a - d) < Math.abs(best - d) ? a : best), allowed[0]!)
}

interface SplitResult {
  mode: "single" | "multi"
  clampedD: number
  n: number
  s: number
  durations: number[]
  /** An explicit entry was off the provider's duration menu and was snapped
   *  onto it (2026-08-06). Only `explicitSplit` ever sets this — the derived
   *  splits pick from the menu by construction. Travels out as
   *  {@link GenerateVideoProPricing.segmentDurationsSnapped}. */
  snapped?: true
}

/**
 * SPARSE-DURATION PACKER — for providers that accept only a few discrete
 * segment lengths (veo3's 4/6/8, grok-i2v's 6/10, gemini-omni's 4/6/8/10).
 * The contiguous arithmetic splitter cannot serve them: it produces even
 * base/base+1 lengths that simply are not on the menu.
 *
 * WHY THIS LIVES APP-SIDE. The original design had the plugin pack and this
 * side validate verbatim (the scene-aligned `explicitSplit` contract), to
 * avoid a fourth copy of a split algorithm. That is not viable here: the
 * plugin's pinned `@nodaro/shared` lags the app's by whole releases — the
 * copy deployed today has no `minimax-h3` in its MODEL_CATALOG at all — so
 * the plugin cannot read a trustworthy duration set for a newly-blessed SKU.
 * The app always has the fresh catalog, and the plugin ALREADY plans against
 * `pricing.segmentDurations`, so packing here keeps one implementation and one
 * source of truth rather than two of each.
 *
 * The pack: for each candidate segment count, spread the target raw seconds
 * across the two allowed lengths that bracket the ideal average, and keep the
 * count whose DELIVERED duration lands closest to what was asked (ties → fewer
 * segments, which is cheaper and has fewer seams). Longer segments go first,
 * matching the contiguous splitter's "establishing shot absorbs the extra".
 *
 * Exactness is not always possible and that is expected: veo3's lengths are
 * all even, so no pack of them delivers an odd number of seconds. The node
 * reports the delivered duration (`clampedD`) rather than pretending.
 */
function packSparseSegments(d: number, b: SegmentBounds): SplitResult {
  // The segment CEILING binds before the duration cap does on a short-segment
  // provider: veo3 tops out at 8s, so 24 segments deliver ~185s while the cap
  // is already 300s. Clamp the candidate range to the ceiling and deliver what
  // fits — `clampedD` reports it, exactly as the duration clamp does. Without
  // this floor-vs-ceiling clamp the loop below never runs (nMin > nMax) and a
  // 300s veo3 request throws instead of shortening.
  const nCeil = EXPLICIT_MAX_SEGMENTS
  const nMin = Math.min(nCeil, Math.max(1, Math.ceil(d / b.maxSeg)))
  const nMax = Math.min(nCeil, Math.max(nMin, Math.ceil(d / b.minSeg)))
  let best: { n: number; durations: number[]; s: number; delivered: number } | undefined

  for (let n = nMin; n <= nMax; n++) {
    const target = d + SPLIT.lossSec * (n - 1)
    const ideal = target / n
    // The two allowed lengths bracketing the ideal average. Mixing exactly two
    // adjacent values keeps segments as even as the menu permits.
    const lo = [...b.allowed].filter((a) => a <= ideal).pop() ?? b.minSeg
    const hi = b.allowed.find((a) => a >= ideal) ?? b.maxSeg
    for (let k = 0; k <= n; k++) {
      const s = k * hi + (n - k) * lo
      const delivered = s - SPLIT.lossSec * (n - 1)
      const err = Math.abs(delivered - d)
      const bestErr = best ? Math.abs(best.delivered - d) : Infinity
      // Strictly-better error wins; equal error keeps the earlier (fewer
      // segments) candidate, so the pack is deterministic.
      if (err < bestErr - 1e-9) {
        best = {
          n,
          // Longer segments first.
          durations: [...new Array<number>(k).fill(hi), ...new Array<number>(n - k).fill(lo)],
          s,
          delivered,
        }
      }
    }
  }

  if (!best) {
    throw new Error(`generate-video-pro: cannot pack ${d}s from [${b.allowed.join(",")}]`)
  }
  const clampedD = Math.max(b.minSeg, Math.round(best.delivered))
  if (best.n === 1) {
    return { mode: "single" as const, clampedD: best.s, n: 1, s: best.s, durations: best.durations }
  }
  return { mode: "multi" as const, clampedD, n: best.n, s: best.s, durations: best.durations }
}

function computeSplit(requestedSec: number, capSec: number, b: SegmentBounds): SplitResult {
  const d = Math.min(Math.max(Math.round(requestedSec), b.minSeg), capSec)
  if (d <= b.maxSeg) {
    // Single segment: the length must be one the provider accepts, so a sparse
    // set (veo3's 4/6/8) snaps — the delivered duration is `clampedD`, which
    // node-executor writes back onto the payload.
    const one = b.contiguous ? d : snapToAllowed(d, b.allowed)
    return { mode: "single" as const, clampedD: one, n: 1, s: one, durations: [one] }
  }
  if (!b.contiguous) return packSparseSegments(d, b)
  let n = 2
  while (n * b.maxSeg < d + SPLIT.lossSec * (n - 1)) n++
  const s = Math.ceil(d + SPLIT.lossSec * (n - 1))
  const base = Math.floor(s / n)
  const durations = new Array<number>(n).fill(base)
  durations[0] += s - base * n
  for (let i = 0; i < n - 1; i++) {
    if (durations[i] > b.maxSeg) {
      durations[i + 1] += durations[i] - b.maxSeg
      durations[i] = b.maxSeg
    }
  }
  return { mode: "multi" as const, clampedD: d, n, s, durations }
}

/**
 * PREFERRED-POINT SPLIT (user lever, 2026-07-21) — TWIN of the plugin's
 * `computePreferredSplit` (engine/split.ts); keep in lock-step. Even
 * segments near a RECOMMENDED length instead of pack-to-cap: n ≈
 * round(total/preferred), adjusted until the even base sits inside
 * [minSeg, maxSeg]; durations are base/base+1 with the remainder on the
 * EARLIEST segments. Can turn a ≤15s request into a MULTI split — that is
 * the point of the lever (more, shorter generations). The classic
 * `computeSplit` above stays byte-identical for lever-less runs.
 */
/** Hard cap on explicit segment counts — mirrors the plugin plan schema's
 *  24-segment ceiling (plan schema + `packScenesToSegments`' merge rule).
 *
 *  NOTE for the 600s work: this does NOT become `maxSegmentsFor(provider, cap)`
 *  = ceil(cap / maxSeg). That expression is the FEWEST segments needed to reach
 *  the cap, not the most a run can have — `preferredSegmentSec` can drive a
 *  120s seedance-2 run to 30 four-second segments today. The reachable bound is
 *  ceil(cap / minSeg); raising this constant is deliberately deferred to the
 *  cap change so the two land together with one policy decision. */
const EXPLICIT_MAX_SEGMENTS = 24

/**
 * EXPLICIT-DURATIONS SPLIT (scene-aligned mode, 2026-08-03) — validates and
 * adopts a caller-supplied per-segment array VERBATIM (spec rule: the array is
 * passed on the wire and never re-derived — the plugin's `packScenesToSegments`
 * produces it, this side only validates and prices it, so quote/reserve/plan
 * drift is impossible by construction). Throws on any violation — never a
 * silent misprice. `clampedD` stays the DELIVERED duration (clamp(round(
 * durationSec))), NEVER the array sum: `node-executor` rewrites
 * `payload.duration` from `clampedDurationSec` and the plugin's drift/planOnly
 * branches consume it as delivered-d.
 */
function explicitSplit(
  requestedSec: number,
  segmentDurations: number[],
  capSec: number,
  b: SegmentBounds,
): SplitResult {
  const d = Math.min(Math.max(Math.round(requestedSec), b.minSeg), capSec)
  const n = segmentDurations.length
  // Count and integrality are hard failures — snapping is for the MENU, not
  // for garbage. A fractional or absurdly long array is a caller bug, and
  // rounding one into range would hide it behind a plausible quote.
  if (n < 1 || n > EXPLICIT_MAX_SEGMENTS || segmentDurations.some((x) => !Number.isInteger(x))) {
    throw new Error(
      `explicit segment durations: expected 1..${EXPLICIT_MAX_SEGMENTS} integer entries`,
    )
  }
  // OFF-GRID ENTRIES SNAP ONTO THE MENU (2026-08-06). Membership still decides
  // what may be PRICED — veo3 accepts 4/6/8 and nothing between, so a 5s entry
  // would be rejected by the provider mid-run, after the reserve was taken —
  // but a non-member is now corrected rather than refused.
  //
  // Because the caller cannot know the menu. `nodaro-cloud-plugins` builds
  // against a PUBLISHED `@nodaro/shared` whose MODEL_CATALOG lags this repo's
  // by whole releases (the installed 2.1.0 has no `minimax-h3` entry at all,
  // for a model that has been a shipping GVP SKU since 2026-08-02). So the side
  // with the fresh catalog does the grid-aware step. Before this, recast's
  // scene-aligned pack — arbitrary ints, packed provider-blind — could never
  // satisfy a sparse menu, and every model outside the seedance/minimax-h3
  // families failed to price at all.
  //
  // COUNT AND ORDER ARE PRESERVED, so the scene count never moves; only
  // lengths do. A grid-valid array snaps to itself, which is what keeps every
  // existing golden byte-identical.
  const durations = segmentDurations.map((x) => (b.allowed.includes(x) ? x : snapToAllowed(x, b.allowed)))
  const snapped = durations.some((x, i) => x !== segmentDurations[i])
  const s = durations.reduce((a, b) => a + b, 0)
  // The sum equality is the drift guard for an array priced VERBATIM. A snapped
  // array was not priced verbatim — its delivered duration derives FROM the
  // pack, exactly as on a sparse menu below — so the equality cannot apply to
  // it and would reject every honest snap.
  if (b.contiguous && !snapped) {
    // Money-pinned path, unchanged: with every integer length available the
    // requested duration is always exactly reachable, so the sum equality is
    // the drift guard between quote, reserve and plan.
    const expected = Math.ceil(d + SPLIT.lossSec * (n - 1))
    if (s !== expected) {
      throw new Error(
        `explicit segment durations: sum ${s} != ceil(${d} + ${SPLIT.lossSec}*(${n}-1)) = ${expected} — quote and reserve would drift`,
      )
    }
    if (n === 1) return { mode: "single" as const, clampedD: d, n: 1, s: d, durations: [d] }
    return { mode: "multi" as const, clampedD: d, n, s, durations: [...durations] }
  }
  // SPARSE providers: the target sum ceil(d + 0.3(n−1)) is frequently
  // UNREACHABLE — veo3 offers 4/6/8, all even, so no combination sums to an
  // odd number at all. Requiring the equality would reject most honest packs.
  //
  // The array is the single source of truth here (the plugin's packer produces
  // it, this side prices it verbatim, nothing re-derives it), so the DELIVERED
  // duration is derived FROM the array instead of the array being forced to
  // match a pre-chosen duration. Drift is impossible by construction rather
  // than by equality check — the same reason the explicit path exists.
  const delivered = Math.max(b.minSeg, Math.round(s - SPLIT.lossSec * (n - 1)))
  if (delivered > capSec) {
    throw new Error(
      `explicit segment durations: deliver ${delivered}s, above the ${capSec}s cap`,
    )
  }
  const snapFlag = snapped ? ({ snapped: true } as const) : {}
  if (n === 1) return { mode: "single" as const, clampedD: s, n: 1, s, durations: [...durations], ...snapFlag }
  return { mode: "multi" as const, clampedD: delivered, n, s, durations: [...durations], ...snapFlag }
}

function computePreferredSplit(
  requestedSec: number,
  preferredSec: number,
  capSec: number,
  b: SegmentBounds,
): SplitResult {
  const d = Math.min(Math.max(Math.round(requestedSec), b.minSeg), capSec)
  if (!b.contiguous) {
    // The lever asks for segments NEAR a preferred length; on a sparse menu
    // the nearest allowed length IS the answer, so pack against it directly
    // rather than the even base/base+1 arithmetic (which cannot land on the
    // menu at all).
    const pref = snapToAllowed(Math.min(Math.max(Math.round(preferredSec), b.minSeg), b.maxSeg), b.allowed)
    const n = Math.min(EXPLICIT_MAX_SEGMENTS, Math.max(1, Math.round(d / pref)))
    const s = n * pref
    if (n === 1) return { mode: "single" as const, clampedD: s, n: 1, s, durations: [pref] }
    const delivered = Math.max(b.minSeg, Math.round(s - SPLIT.lossSec * (n - 1)))
    return { mode: "multi" as const, clampedD: delivered, n, s, durations: new Array<number>(n).fill(pref) }
  }
  const pref = Math.min(Math.max(Math.round(preferredSec), b.minSeg), b.maxSeg)
  let n = Math.max(1, Math.round(d / pref))
  const sOf = (k: number): number => Math.ceil(d + SPLIT.lossSec * (k - 1))
  while (n > 1 && Math.floor(sOf(n) / n) < b.minSeg) n--
  while (Math.ceil(sOf(n) / n) > b.maxSeg) n++
  if (n === 1) return { mode: "single" as const, clampedD: d, n: 1, s: d, durations: [d] }
  const s = sOf(n)
  const base = Math.floor(s / n)
  const r = s - base * n
  const durations = new Array<number>(n).fill(base)
  for (let i = 0; i < r; i++) durations[i] += 1
  return { mode: "multi" as const, clampedD: d, n, s, durations }
}

/** User-selectable context-tail bounds (seconds). Floor = the default 2s
 *  (clears KIE's 1.8s r2v minimum); ceiling 5s keeps the reference short
 *  enough to stay a continuation cue rather than replay material, and keeps
 *  the per-join surcharge bounded. The engine cuts EXACTLY what this bills —
 *  transport and formula read the same clamped value. */
export const CONTEXT_TAIL_MIN_SEC = SEEDANCE_2_CONTINUATION_REF_SEC
// Raised 5→15 (product decision 2026-07-22, testing lever) — the plugin route Zod + handler
// transport clamp move together to the same [2,15]. Billing stays exact: the
// engine cuts what this bills. A long tail eats the KIE video-ref budget, so
// it's a testing knob, not a default (default stays 2s).
export const CONTEXT_TAIL_MAX_SEC = 15
export function clampContextTailSec(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : CONTEXT_TAIL_MIN_SEC
  return Math.min(CONTEXT_TAIL_MAX_SEC, Math.max(CONTEXT_TAIL_MIN_SEC, n))
}

/**
 * Clamp a requested resolution to the provider's catalog resolutions (single
 * source of truth) — an unsupported tier (e.g. a stale 1080p on
 * seedance-2-mini, which only exposes 480p/720p) snaps to a real one so every
 * downstream composite lookup is always seeded.
 * Mirrors `seedance2-ref-video-credits.ts` / `packages/shared/src/credit-identifiers.ts`.
 *
 * SNAPS TO THE NEAREST TIER, not the highest (2026-08-06). It used to take the
 * model's top tier, so asking for the CHEAPEST resolution a model lacks quoted
 * the priciest one it has: 480p on veo3 (720p/1080p/4k) priced and reserved
 * **4k**. Nobody asking for 480p wants to be billed for 4k, and the old rule
 * made the error worst exactly where the caller was trying to spend least.
 *
 * TIES GO TO THE CHEAPER TIER, for the same reason — charging above what was
 * asked for is the worse of the two mistakes.
 *
 * Nearest is only SAFE because the clamped value is echoed back
 * ({@link GenerateVideoProPricing.resolution}) and the render uses it. Snapping
 * DOWN while the provider still rendered the raw request would reserve less
 * than the run delivers, which is precisely why the old rule reached upward.
 */
const RESOLUTION_LADDER = ["480p", "720p", "1080p", "4k"] as const

function clampResolution(provider: string, resolution: string): string {
  // MiniMax Hailuo 3: its own two-value space ("2K" default / "768P") with its
  // own collapse rule — anything not exactly 768P (incl. a stale Seedance
  // "720p" carried across a provider switch) bills AND renders as 2K.
  if (isMinimaxH3Provider(provider)) return normalizeMinimaxH3Resolution(resolution)
  const supported = MODEL_CATALOG[provider]?.resolutions ?? ["480p", "720p", "1080p"]
  const want = resolution === "4k" ? "4k" : resolution === "1080p" ? "1080p" : resolution === "720p" ? "720p" : "480p"
  if (supported.includes(want)) return want
  const wantAt = RESOLUTION_LADDER.indexOf(want)
  let best: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  // Walked low → high, so an equidistant pair settles on the cheaper tier.
  for (const tier of RESOLUTION_LADDER) {
    if (!supported.includes(tier)) continue
    const distance = Math.abs(RESOLUTION_LADDER.indexOf(tier) - wantAt)
    if (distance < bestDistance) {
      best = tier
      bestDistance = distance
    }
  }
  // A catalog listing nothing this ladder knows keeps the old top-tier rule as
  // the backstop: still seeded, still never under-reserving.
  return best ?? supported[supported.length - 1] ?? "480p"
}

/**
 * Per-second BASE rate for a (provider, resolution, ref) combination, derived
 * from the seeded 8s composite (the family's per-second rate is linear, so
 * the 8s tier is used as the canonical anchor regardless of the actual
 * segment duration — mirrors `seedance2RefVideoBaseCredits`).
 *
 * `minimax-h3` (2026-08-02; 768P lever 2026-08-03) has a DIFFERENT identifier
 * shape: a two-rate resolution axis (bare = 2K default, ":768p" = cheaper
 * tier) and no `-ref` composites — its r2v rate equals the base rate of the
 * selected tier, and KIE bills reference-VIDEO input as `unit × (input +
 * output)` seconds at that tier's rate (see minimax-h3-credits.ts). Both
 * rates therefore derive from the ONE 8s composite of the selected tier
 * (`minimax-h3:8s` or `minimax-h3:8s:768p`), and the multi-segment reserve
 * formula's `refPerSec × (n−1) × tailSec` term prices each continuation's
 * context-tail input seconds exactly. The per-image surcharge (inputs beyond
 * 5, 27.5 base each) deliberately rides the provider margin, NOT user
 * credits — the same treatment as tailUpscale/identityPlate (a pro segment
 * sends anchor + plate + a few cast refs, typically within the free tier).
 *
 * Hard-fail policy: throws `PriceNotConfiguredError` when the composite is
 * missing — never silently falls back to a wrong (under-)reservation.
 */
function perSecIdentifier(provider: string, resolution: string, ref: boolean): string {
  return isMinimaxH3Provider(provider)
    ? (normalizeMinimaxH3Resolution(resolution) === "768P" ? `${provider}:8s:768p` : `${provider}:8s`)
    : `${provider}:8s:${resolution}${ref ? "-ref" : ""}`
}

function perSecRate(provider: string, resolution: string, ref: boolean): number {
  const identifier = perSecIdentifier(provider, resolution, ref)
  const composite = STATIC_CREDIT_COSTS[identifier]
  if (composite === undefined) {
    throw new PriceNotConfiguredError(identifier)
  }
  return composite / 8
}

/**
 * Whether this (provider, resolution) is priced on the LINEAR per-second axis
 * at all — i.e. it seeds both the no-ref and ref 8s composites the formulas
 * above divide by 8.
 *
 * True for the Seedance-2 family and minimax-h3, which is why the per-second
 * closed-form is the ONLY path those runs ever take: their reserve stays
 * byte-identical to what it was before the pro node opened up. Every other
 * blessed SKU (veo3 family, gemini-omni-video, kling-3-omni, grok-i2v,
 * happyhorse-ref2v) prices FLAT per generation, so there is no `:8s:` row to
 * divide — those take {@link segmentCost} instead.
 */
function hasPerSecRate(provider: string, resolution: string): boolean {
  return (
    STATIC_CREDIT_COSTS[perSecIdentifier(provider, resolution, false)] !== undefined &&
    STATIC_CREDIT_COSTS[perSecIdentifier(provider, resolution, true)] !== undefined
  )
}

/**
 * Cost of ONE keyframes segment on a flat-priced provider.
 *
 * A keyframes segment is exactly a normal single-shot image-to-video
 * generation — one anchor still in, one clip out, nothing conditioned on
 * another segment — so it prices through the SAME canonical identifier builder
 * every other video node uses. That builder already encodes each family's
 * identifier shape (VEO's resolution tiers, Gemini Omni's duration snap,
 * Kling's `:Ns`), and `getModelCreditBaseCost` keeps the lookup DB-override
 * aware, so an admin reprice moves the pro node with it.
 */
async function segmentCost(provider: string, resolution: string, durationSec: number): Promise<number> {
  const identifier = buildVideoCreditModelIdentifier(
    provider,
    durationSec,
    false,
    "image-to-video",
    undefined,
    resolution,
    false,
  )
  const { creditCost } = await getModelCreditBaseCost(identifier)
  return creditCost
}

export async function computeGenerateVideoProPricing(args: {
  provider: string
  resolution: string
  durationSec: number
  /** Continuation-tail length per join (seconds), clamped to
   *  [CONTEXT_TAIL_MIN_SEC, CONTEXT_TAIL_MAX_SEC]; omitted → default 2s. */
  tailSec?: number
  /** Recommended segment length (seconds), clamped to [4,15] — even segments
   *  near this point instead of pack-to-cap. Omitted → the classic split,
   *  byte-identical. Money-authoritative: the plugin plans against THIS
   *  split's segmentDurations. */
  preferredSegmentSec?: number
  /** EXPLICIT per-segment durations (scene-aligned split, 2026-08-03) —
   *  validated and priced VERBATIM (ints 4..15, ≤24 entries, sum ===
   *  ceil(clampedD + 0.3×(n−1)); throws otherwise). Takes precedence over
   *  `preferredSegmentSec`. Additive-optional (no contract bump). */
  segmentDurations?: number[]
  /** Render method (2026-08-03): "keyframes" prices the scene-decomposed
   *  shape (every segment at the no-ref rate, no continuation tail, plus the
   *  worst-case anchor budget). Omitted / "extend" → the classic chain,
   *  byte-identical. Additive-optional (no contract bump). */
  renderMethod?: "extend" | "keyframes"
  /** ANCHORS ALREADY BOUGHT (interactive mode S2, 2026-08-04): this run is
   *  being rendered from stills the caller already generated and paid for, so
   *  it holds NO anchor budget. Without it a 14-scene run reserves ~1,260
   *  credits it will never spend — refundable, but held, which is how a run
   *  402s at the finish line on a balance that was always sufficient.
   *
   *  The engine's metered commit settles the real count either way, so a
   *  PARTIAL seed (one missing still regenerated by the wave) commits those
   *  few units above the reserve and margin absorbs them — bounded by the
   *  missing-artifact count, and stated deliberately.
   *
   *  Additive-optional: an older plugin never sends it and prices exactly as
   *  it does today. */
  anchorsSeeded?: boolean
  /** ANCHOR ASPECT (2026-08-04) — the ratio the engine's anchor wave will
   *  actually render at, already resolved past `"adaptive"` by the plugin's
   *  `anchorAspectFor`. Keyframes only, and it moves ONLY the anchor unit
   *  price: ratios GPT Image 2 cannot render fall back to the pricier
   *  nano-banana-pro (see `anchorCreditIdFor`).
   *
   *  Additive-optional, and absent means the FALLBACK price — a plugin
   *  predating the field still generates every anchor on nano-banana-pro, so
   *  that reserves exactly what it spends (today's number, byte-identical). */
  aspectRatio?: string
}): Promise<GenerateVideoProPricing> {
  const { provider, durationSec } = args
  const tailSec = clampContextTailSec(args.tailSec)
  const resolution = clampResolution(provider, args.resolution)

  const cap = Number(process.env.GENERATE_VIDEO_PRO_MAX_DURATION || 120)
  const bounds = boundsFor(provider)

  // Money-side enforcement of the render-method gate, BEFORE any split work:
  // `extend` sends the previous segment's tail as an r2v conditioning
  // reference, which only the "video-reference" family accepts. Refuse to
  // PRICE a combination that cannot render, rather than reserving credits for
  // a run that 400s at the provider (or, worse, silently renders
  // start-anchored and bills the ref rate). Checked first so the caller gets
  // "this provider is keyframes-only" instead of a downstream split complaint.
  // The plugin route rejects it earlier still; this is the backstop for every
  // other caller.
  if (args.renderMethod !== "keyframes" && !supportsExtendRender(provider)) {
    throw new Error(
      `generate-video-pro: ${provider} has no reference-video transport — it renders with renderMethod "keyframes" only`,
    )
  }

  const useExplicit = Array.isArray(args.segmentDurations) && args.segmentDurations.length > 0
  const usePreferred =
    !useExplicit && typeof args.preferredSegmentSec === "number" && Number.isFinite(args.preferredSegmentSec)
  const split = useExplicit
    ? explicitSplit(durationSec, args.segmentDurations as number[], cap, bounds)
    : usePreferred
      ? computePreferredSplit(durationSec, args.preferredSegmentSec as number, cap, bounds)
      : computeSplit(durationSec, cap, bounds)

  // Per-second transparency fields — always derived from STATIC_CREDIT_COSTS
  // directly (never the DB-aware getter: there is no per-duration DB row for
  // a synthetic multi-segment run, only the discrete 8s composite). Computed
  // for BOTH modes: multi mode needs them for the reserve formula; single
  // mode surfaces them for display/transparency (e.g. "priced at N cr/sec").
  //
  // FLAT-PRICED providers have no `:8s:` composite to divide, so the rates are
  // 0 and the keyframes reserve sums per-segment costs instead (`segmentCosts`
  // below carries them). Extend never reaches that case — it is gated to the
  // r2v family, every member of which is per-second priced.
  const perSecPriced = hasPerSecRate(provider, resolution)
  const noRefPerSec = perSecPriced ? perSecRate(provider, resolution, false) : 0
  const refPerSec = perSecPriced ? perSecRate(provider, resolution, true) : 0

  // KEYFRAMES (2026-08-03) — one formula for BOTH modes: nothing re-seeds off
  // a previous segment, so every segment (single or not) bills at the no-ref
  // rate, the continuation-tail term disappears, and the run reserves the
  // worst-case anchor budget on top. Single mode deliberately does NOT set
  // `creditIdentifier`: the flat per-duration composite is the extend-chain
  // price and would under-reserve the anchors, so keyframes always takes the
  // dynamic reserve path. `feeBase` is the same plan-fee row multi uses — the
  // keyframes engine plans scenes for a single segment too.
  if (args.renderMethod === "keyframes") {
    const feeBase = STATIC_CREDIT_COSTS["generate-video-pro"]
    if (feeBase === undefined) {
      throw new PriceNotConfiguredError("generate-video-pro")
    }
    // A run rendering from stills it was GIVEN buys none, so it reserves none
    // (see `anchorsSeeded`). The `getModelCreditBaseCost` lookup is skipped
    // with it — there is no unit to price.
    const anchorReserve = args.anchorsSeeded === true
      ? 0
      : split.n * ANCHORS_PER_SEGMENT * (await getModelCreditBaseCost(anchorCreditIdFor(args.aspectRatio))).creditCost
    // Per-second providers keep the linear closed-form (byte-identical);
    // flat-priced ones sum the real per-generation cost of each segment. The
    // array rides back on the wire so the plugin's metered `commitBase` bills
    // the SAME per-segment numbers instead of re-deriving from a rate that
    // does not exist for these SKUs.
    const segmentCosts = perSecPriced
      ? undefined
      : await Promise.all(split.durations.map((d) => segmentCost(provider, resolution, d)))
    const segmentsBase = segmentCosts
      ? segmentCosts.reduce((a, b) => a + b, 0)
      : keyframesSegmentsBase(split.durations, noRefPerSec)
    return {
      mode: split.mode,
      clampedDurationSec: split.clampedD,
      segmentCount: split.n,
      totalRawSec: split.s,
      segmentDurations: split.durations,
      resolution,
      ...(split.snapped ? { segmentDurationsSnapped: true as const } : {}),
      feeBase,
      noRefPerSec,
      refPerSec,
      tailSec,
      reserveBase: feeBase + segmentsBase + anchorReserve,
      renderMethod: "keyframes",
      endAnchors: supportsEndAnchor(provider),
      ...(segmentCosts ? { segmentCosts } : {}),
      // Omitted entirely when nothing was reserved: `commitBase` derives the
      // per-anchor unit from this field, and a 0 would make it divide a zero
      // budget rather than bill nothing.
      ...(anchorReserve > 0 ? { anchorReserve } : {}),
    }
  }

  if (split.mode === "single") {
    // Single-segment run behaves exactly like a normal t2v run — same
    // identifier + BASE cost path every other video node uses, so it stays
    // DB-override-aware (an admin can reprice the underlying composite and
    // the pro node's single-segment cost follows automatically).
    const creditIdentifier = buildVideoCreditModelIdentifier(
      provider,
      split.clampedD,
      false,
      "text-to-video",
      undefined,
      resolution,
      false,
    )
    const { creditCost } = await getModelCreditBaseCost(creditIdentifier)
    return {
      mode: "single",
      clampedDurationSec: split.clampedD,
      segmentCount: split.n,
      totalRawSec: split.s,
      segmentDurations: split.durations,
      resolution,
      ...(split.snapped ? { segmentDurationsSnapped: true as const } : {}),
      feeBase: 0,
      noRefPerSec,
      refPerSec,
      tailSec,
      reserveBase: creditCost,
      creditIdentifier,
    }
  }

  const feeBase = STATIC_CREDIT_COSTS["generate-video-pro"]
  if (feeBase === undefined) {
    throw new PriceNotConfiguredError("generate-video-pro")
  }

  // First segment billed at the no-ref rate; every subsequent segment + its
  // tail overlap billed at the video-ref rate (re-seeds off the previous
  // segment's tail frames). The DEFAULT path bills the first segment at the
  // maxSeg constant (worst-case padding — pinned by the golden tests); the
  // PREFERRED and EXPLICIT paths bill durations[0] instead: segments can be
  // far shorter than the cap there, the constant would over-pad AND go
  // negative in the ref term (e.g. 10s @ preferred 4 → s−15 < 0), and the
  // engine's commitBase settles on durations[0] — reserve and commit stay
  // aligned.
  const firstSegBillSec = usePreferred || useExplicit ? split.durations[0]! : bounds.maxSeg
  const reserveBase =
    feeBase +
    Math.ceil(noRefPerSec * firstSegBillSec) +
    Math.ceil(refPerSec * ((split.n - 1) * tailSec + (split.s - firstSegBillSec)))

  return {
    mode: "multi",
    clampedDurationSec: split.clampedD,
    segmentCount: split.n,
    totalRawSec: split.s,
    segmentDurations: split.durations,
    resolution,
    ...(split.snapped ? { segmentDurationsSnapped: true as const } : {}),
    feeBase,
    noRefPerSec,
    refPerSec,
    tailSec,
    reserveBase,
  }
}

/**
 * CONTINUE reserve (2026-07-21, gvp stop/continue) — money-authoritative for
 * a child job that resumes a parent run from `fromSegment` (1-based). The
 * parent plan's durations are KNOWN (embedded in its checkpoint's pricing at
 * the original reservation), so the reserve is exact — no worst-case padding:
 *
 *   fromSegment k > 1:  feeBase + ceil(refPerSec × ((N−k+1)·tailSec + Σ d[k..N]))
 *   fromSegment k = 1:  the fresh-run formula over the same fixed durations
 *                       (segment 1 no-ref; every later one ref + tail)
 *
 * Every NEW segment — including the first — bills at the ref rate + one
 * continuation tail: it re-seeds off the previous footage (the parent prefix
 * for segment k). The returned pricing carries `billFromSegment` so the
 * plugin's `commitBase` twin settles only the new segments; reserve == commit
 * when the run completes fully (refund 0), and every partial path refunds
 * the untouched remainder through the same metered commit.
 *
 * TWIN of the plugin engine's continuation-aware `commitBase`
 * (engine/finalize.ts) — keep in lock-step.
 */
export async function computeGenerateVideoProContinuationPricing(args: {
  provider: string
  resolution: string
  /** The PARENT plan's per-segment durations (from its checkpoint's embedded
   *  pricing — money-authoritative; never recomputed from a split). */
  segmentDurations: number[]
  /** 1-based first segment the child regenerates (and pays for). OPTIONAL
   *  since the scene-SET lever landed — when `segments` is passed it derives
   *  as `min(segments)`; exactly one of the two must be present. */
  fromSegment?: number
  tailSec?: number
  /** Render method (2026-08-03) — "keyframes" bills the re-rendered segments
   *  at the no-ref rate with no continuation tails and NO anchor reserve (the
   *  parent already generated, and paid for, the anchors this continuation
   *  re-uses). Omitted / "extend" → the classic continuation, byte-identical.
   *  Additive-optional (no contract bump). */
  renderMethod?: "extend" | "keyframes"
  /** SCENE-SET continue (2026-08-04): the exact 1-based segments the child
   *  regenerates — KEYFRAMES ONLY (the extend transport chains segments, so a
   *  mid-run member cannot re-render without cascading; passing a set there
   *  throws rather than silently suffix-pricing). Deduped + sorted here; the
   *  echo rides back as `billSegments` (the capability signal). */
  segments?: number[]
}): Promise<GenerateVideoProPricing> {
  const { provider } = args
  const tailSec = clampContextTailSec(args.tailSec)
  const resolution = clampResolution(provider, args.resolution)
  // Wire-path sanitation: the durations arrive from a checkpoint blob — round
  // and bound them to the split's own invariants before money math.
  const durations = args.segmentDurations.map((d) => Math.round(d))
  const n = durations.length
  // Bound against the PARENT PROVIDER's own longest segment — a continuation of
  // a veo3 run must not accept a 15s entry just because Seedance-2 allows one.
  const parentMaxSeg = maxSegmentSecFor(provider)
  if (n < 1 || durations.some((d) => !Number.isFinite(d) || d < 1 || d > parentMaxSeg)) {
    throw new Error("continuation pricing: invalid parent segment durations")
  }
  // SCENE-SET validation — before k derives from it. Same wire-path
  // discipline as the durations: round, bound, dedup, sort.
  let billSegments: number[] | undefined
  if (args.segments !== undefined) {
    if (args.renderMethod !== "keyframes") {
      throw new Error('continuation pricing: a segment SET requires renderMethod "keyframes"')
    }
    const set = [...new Set(args.segments.map((s) => Math.round(s)))].sort((a, b) => a - b)
    if (set.length < 1 || set.some((s) => !Number.isFinite(s) || s < 1 || s > n)) {
      throw new Error(`continuation pricing: segments outside 1..${n}`)
    }
    billSegments = set
  }
  if (args.fromSegment === undefined && billSegments === undefined) {
    throw new Error("continuation pricing: one of fromSegment or segments is required")
  }
  const k = args.fromSegment !== undefined ? Math.round(args.fromSegment) : billSegments![0]!
  if (!Number.isFinite(k) || k < 1 || k > n) {
    throw new Error(`continuation pricing: fromSegment ${args.fromSegment} outside 1..${n}`)
  }
  // Flat-priced providers have no per-second axis (see hasPerSecRate). They are
  // keyframes-only, so only the keyframes arms below are reachable for them.
  const perSecPriced = hasPerSecRate(provider, resolution)
  if (!perSecPriced && args.renderMethod !== "keyframes") {
    throw new Error(
      `generate-video-pro: ${provider} has no reference-video transport — continuations render with renderMethod "keyframes" only`,
    )
  }
  const noRefPerSec = perSecPriced ? perSecRate(provider, resolution, false) : 0
  const refPerSec = perSecPriced ? perSecRate(provider, resolution, true) : 0
  const feeBase = STATIC_CREDIT_COSTS["generate-video-pro"]
  if (feeBase === undefined) {
    throw new PriceNotConfiguredError("generate-video-pro")
  }
  const total = durations.reduce((a, b) => a + b, 0)
  // Per-segment costs for a flat-priced continuation — index-aligned with the
  // PARENT's full duration array (not the billed slice), so the plugin can
  // index it by absolute segment number exactly like `segmentDurations`.
  const segmentCosts = perSecPriced
    ? undefined
    : await Promise.all(durations.map((d) => segmentCost(provider, resolution, d)))
  const billedCostsFor = (segs: number[]): number =>
    segs.reduce((sum, s) => sum + (segmentCosts![s - 1] ?? 0), 0)
  // KEYFRAMES continuation: the child re-renders scenes k..N from their OWN
  // anchors — no segment re-seeds off previous footage, so every one bills at
  // the no-ref rate with no continuation tail, and there is no anchor reserve
  // (the parent's anchors are re-used). Per-segment `ceil` matches the fresh
  // keyframes run's terms exactly, so re-rendering a scene costs the same
  // whether it lands in the parent run or a continuation.
  const keyframes = args.renderMethod === "keyframes"
  // SCENE-SET reserve: fee + exactly the set's members at the fresh keyframes
  // per-segment terms — re-rendering a scene costs the same whether it lands
  // in the parent run, a suffix continuation, or a set continuation.
  const reserveBase = billSegments !== undefined
    ? feeBase +
      (segmentCosts
        ? billedCostsFor(billSegments)
        : keyframesSegmentsBase(billSegments.map((s) => durations[s - 1]!), noRefPerSec))
    : keyframes
      ? feeBase +
        (segmentCosts
          ? billedCostsFor(durations.map((_, i) => i + 1).slice(k - 1))
          : keyframesSegmentsBase(durations.slice(k - 1), noRefPerSec))
      : k > 1
        ? feeBase + Math.ceil(refPerSec * ((n - k + 1) * tailSec + durations.slice(k - 1).reduce((a, b) => a + b, 0)))
        : feeBase +
          Math.ceil(noRefPerSec * durations[0]!) +
          (n > 1 ? Math.ceil(refPerSec * ((n - 1) * tailSec + (total - durations[0]!))) : 0)
  return {
    mode: "multi",
    clampedDurationSec: total,
    segmentCount: n,
    totalRawSec: total,
    segmentDurations: durations,
    feeBase,
    noRefPerSec,
    refPerSec,
    tailSec,
    reserveBase,
    billFromSegment: k,
    ...(keyframes ? { renderMethod: "keyframes" as const } : {}),
    ...(billSegments !== undefined ? { billSegments } : {}),
    ...(segmentCosts ? { segmentCosts } : {}),
  }
}
