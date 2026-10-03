/**
 * The edit-plan node's credit-id scheme and output unwrap — split out of
 * `edl.ts` (which keeps the EDL shape itself) so that module stays within the
 * file-size cap. Re-exported from the package index, so importers of
 * `@nodaro/shared` are unaffected.
 */
import { EDL_VERSION } from "./edl.js"

// ─────────────────────────────────────────────────────────────────────────
//  edit-plan credit-id scheme (STRUCTURE only — the per-mode/tier/bucket credit
//  VALUES live app-side in backend/ee/billing/credits.ts + migration 432, since
//  they are probe-set placeholders and the DB row wins at runtime). Lives HERE
//  so BOTH core payload-builder and ee credits.ts read one id builder — core
//  may not import ee (check-ee-imports), the same reason buildVideoAnalysisCreditId
//  is shared. Mirrors the plugin's own (D13-local) pricing.ts scheme.
// ─────────────────────────────────────────────────────────────────────────

export type EditPlanMode = "tighten" | "clips" | "chapters"
export type EditPlanTier = "economy" | "standard" | "premium"
export const EDIT_PLAN_MODES: readonly EditPlanMode[] = ["tighten", "clips", "chapters"]
export const EDIT_PLAN_TIERS: readonly EditPlanTier[] = ["economy", "standard", "premium"]
/** The coarse duration ladder (MINUTES) a probed source duration rounds UP to;
 *  the composite credit id carries the bucket. 3 modes × 3 tiers × 6 buckets =
 *  54 composites (+ the bare `edit-plan`). */
export const EDIT_PLAN_BUCKET_MINUTES: readonly number[] = [15, 30, 60, 90, 120, 180]
/** Hard duration cap (design §7.4). */
export const EDIT_PLAN_MAX_MINUTES = 180
/** `clips` mode: how many clips a plan returns when the caller names no count,
 *  and the most it may be asked for. One source for the credit estimate, the
 *  orchestrated payload clamp and the request schema. */
export const EDIT_PLAN_DEFAULT_CLIP_COUNT = 8
export const EDIT_PLAN_MAX_CLIP_COUNT = 50

/** Clamp a requested clip count into `[1, EDIT_PLAN_MAX_CLIP_COUNT]`; `undefined`
 *  for anything that is not a positive number (the planner then uses its default). */
export function clampEditPlanClipCount(count: unknown): number | undefined {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return undefined
  return Math.min(EDIT_PLAN_MAX_CLIP_COUNT, Math.max(1, Math.floor(count)))
}
/** The bare estimator / DB-down fallback id. */
export const EDIT_PLAN_BASE_CREDIT_ID = "edit-plan"

/** Round a source duration (seconds) UP to the smallest covering ladder bucket
 *  (capped at the max), in minutes. `undefined` / non-finite → the ceiling
 *  bucket (the safe over-reserve direction). */
export function editPlanBucketMinutes(durationSec: number | undefined): number {
  const secs = typeof durationSec === "number" && Number.isFinite(durationSec) ? durationSec : EDIT_PLAN_MAX_MINUTES * 60
  const mins = Math.max(1, Math.ceil(secs / 60))
  const capped = Math.min(mins, EDIT_PLAN_MAX_MINUTES)
  for (const b of EDIT_PLAN_BUCKET_MINUTES) if (capped <= b) return b
  return EDIT_PLAN_BUCKET_MINUTES[EDIT_PLAN_BUCKET_MINUTES.length - 1]!
}

/** `edit-plan:<mode>:<tier>:<bucket>m`. `durationSec` undefined → the ceiling
 *  bucket. Single source of truth for the composite id shape. */
export function buildEditPlanCreditId(mode: EditPlanMode, tier: EditPlanTier, durationSec?: number): string {
  return `edit-plan:${mode}:${tier}:${editPlanBucketMinutes(durationSec)}m`
}

/** Narrow an arbitrary value to a known edit-plan mode, defaulting to "tighten". */
export function asEditPlanMode(v: unknown): EditPlanMode {
  return v === "clips" || v === "chapters" ? v : "tighten"
}

/** Narrow an arbitrary value to a known edit-plan tier, defaulting to "standard". */
export function asEditPlanTier(v: unknown): EditPlanTier {
  return v === "economy" || v === "premium" ? v : "standard"
}

/**
 * Unwrap an `edit-plan` job's `output_data` into the value stored on the node's
 * `data.generatedJson`, which every output extractor then reads. This is the ONE
 * place the three modes are normalized (the same rule on both engines and every
 * result-application site, so audit-dag parity can't drift):
 *   - `clips`    → the BARE `Edl[]` (T5: the `list` fan-out reads `Array.isArray`
 *                  on `generatedJson`; each element becomes one JSON-stringified
 *                  item a downstream `edl` input `normalizeEdl`-parses).
 *   - `chapters` → the `{ version, chapters }` object.
 *   - `tighten`  → the `Edl` object at top level.
 *
 * The cloud relay object-spreads `output_data` and adds `viaNodaroCloud: true`;
 * that key (and any other bookkeeping) is stripped here. The unwrap lives HERE —
 * NEVER in `output_data` — because a bare array written into `output_data` would
 * be corrupted into numeric keys by the relay's object-spread (see `EdlClipSet`).
 */
export function unwrapEditPlanOutput(outputData: unknown): unknown {
  if (!outputData || typeof outputData !== "object") return outputData
  const o = outputData as Record<string, unknown>
  // clips: EdlClipSet { version, clips: Edl[] } → the bare Edl[].
  if (Array.isArray(o.clips)) return o.clips
  // chapters: { version, chapters: [...] } → the object, minus bookkeeping.
  if (Array.isArray(o.chapters)) return { version: EDL_VERSION, chapters: o.chapters }
  // tighten: the Edl object at top level → drop the relay's viaNodaroCloud.
  const { viaNodaroCloud: _viaNodaroCloud, ...rest } = o
  return rest
}
