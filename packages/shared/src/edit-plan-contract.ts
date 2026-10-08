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

/** `trailer` (Track D1): one short teaser EDL built from the strongest moments,
 *  priced like `clips` (the per-minute rate plus the clips flat). */
export type EditPlanMode = "tighten" | "clips" | "chapters" | "trailer"
export type EditPlanTier = "economy" | "standard" | "premium"
export const EDIT_PLAN_MODES: readonly EditPlanMode[] = ["tighten", "clips", "chapters", "trailer"]
export const EDIT_PLAN_TIERS: readonly EditPlanTier[] = ["economy", "standard", "premium"]
/** The coarse duration ladder (MINUTES) a probed source duration rounds UP to;
 *  the composite credit id carries the bucket. 4 modes × 3 tiers × 6 buckets =
 *  72 composites (+ the bare `edit-plan`). */
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
  return editPlanMinutesCreditId(mode, tier, editPlanBucketMinutes(durationSec))
}

// ─────────────────────────────────────────────────────────────────────────
//  Per started minute (decided 2026-10-07). A plugin that declares
//  `supports().editPlanPerMinute` reserves `edit-plan:<mode>:<tier>:<N>m` with
//  N = the started minutes of the source (1..180), priced flat + rate × N from
//  ONE rate row and ONE flat row per mode × tier. The step ids above have the
//  same shape (N = a step), so one parser reads both, and the plugin's money
//  gate (`:(\d+)m$`) accepts both.
// ─────────────────────────────────────────────────────────────────────────

/** Started minutes of a source (seconds): ceil(sec / 60), at least 1, capped at
 *  the maximum. `undefined` / non-finite → the maximum (over-reserve direction). */
export function editPlanStartedMinutes(durationSec: number | undefined): number {
  const secs = typeof durationSec === "number" && Number.isFinite(durationSec) ? durationSec : EDIT_PLAN_MAX_MINUTES * 60
  return Math.min(EDIT_PLAN_MAX_MINUTES, Math.max(1, Math.ceil(secs / 60)))
}

/** `edit-plan:<mode>:<tier>:<N>m` for N minutes (a started-minute count or a step). */
export function editPlanMinutesCreditId(mode: EditPlanMode, tier: EditPlanTier, minutes: number): string {
  return `edit-plan:${mode}:${tier}:${minutes}m`
}

/** The id a run of this mode/tier on a source of `durationSec` reserves: per
 *  started minute when the plugin charges that way (`perMinute`), else the step
 *  the length rounds up to. An unknown length → the 180-minute maximum either way. */
export function editPlanReserveCreditId(
  mode: EditPlanMode,
  tier: EditPlanTier,
  durationSec: number | undefined,
  perMinute: boolean,
): string {
  return perMinute
    ? editPlanMinutesCreditId(mode, tier, editPlanStartedMinutes(durationSec))
    : buildEditPlanCreditId(mode, tier, durationSec)
}

/** The rate row: credits per started source minute for a mode/tier. Never reserved. */
export function editPlanRateCreditId(mode: EditPlanMode, tier: EditPlanTier): string {
  return `edit-plan:${mode}:${tier}:per-minute`
}

/** The flat row: credits once per plan for a mode/tier (0 for tighten and chapters). Never reserved. */
export function editPlanFlatCreditId(mode: EditPlanMode, tier: EditPlanTier): string {
  return `edit-plan:${mode}:${tier}:flat`
}

/** The mode, tier and minutes of an `edit-plan:<mode>:<tier>:<N>m` id (1 ≤ N ≤
 *  the maximum), or `undefined` for anything else (the bare id, a rate or flat
 *  row, an unknown mode or tier). */
export function parseEditPlanMinutesCreditId(
  id: string,
): { mode: EditPlanMode; tier: EditPlanTier; minutes: number } | undefined {
  const m = /^edit-plan:([a-z]+):([a-z]+):(\d+)m$/.exec(id)
  if (!m) return undefined
  const mode = parseEditPlanMode(m[1])
  const tier = (EDIT_PLAN_TIERS as readonly string[]).includes(m[2]!) ? (m[2] as EditPlanTier) : undefined
  const minutes = Number(m[3])
  if (!mode || !tier || !Number.isInteger(minutes) || minutes < 1 || minutes > EDIT_PLAN_MAX_MINUTES) return undefined
  return { mode, tier, minutes }
}

/** flat + rate × N, rounded up, at least 1 credit — what an
 *  `edit-plan:<mode>:<tier>:<N>m` id costs from its two rows (the plugin's formula). */
export function editPlanMinutesBaseCredits(flat: number, rate: number, minutes: number): number {
  return Math.max(1, Math.ceil(flat + rate * minutes))
}

/** Narrow an arbitrary value to a known edit-plan mode, defaulting to "tighten".
 *  For display and estimates only: anything that DISPATCHES a plan must use
 *  {@link parseEditPlanMode} and refuse an unknown mode, or that mode is planned
 *  (and charged) as tighten. */
export function asEditPlanMode(v: unknown): EditPlanMode {
  return parseEditPlanMode(v) ?? "tighten"
}

/** The strict sibling of {@link asEditPlanMode}: the mode when `v` is exactly a
 *  known edit-plan mode, otherwise `undefined` — never a substitute. */
export function parseEditPlanMode(v: unknown): EditPlanMode | undefined {
  return typeof v === "string" && (EDIT_PLAN_MODES as readonly string[]).includes(v) ? (v as EditPlanMode) : undefined
}

/** Narrow an arbitrary value to a known edit-plan tier, defaulting to "standard". */
export function asEditPlanTier(v: unknown): EditPlanTier {
  return v === "economy" || v === "premium" ? v : "standard"
}

/**
 * Unwrap an `edit-plan` job's `output_data` into the value stored on the node's
 * `data.generatedJson`, which every output extractor then reads. This is the ONE
 * place the modes are normalized (the same rule on both engines and every
 * result-application site, so audit-dag parity can't drift):
 *   - `clips`    → the BARE `Edl[]` (T5: the `list` fan-out reads `Array.isArray`
 *                  on `generatedJson`; each element becomes one JSON-stringified
 *                  item a downstream `edl` input `normalizeEdl`-parses).
 *   - `chapters` → the `{ version, chapters }` object.
 *   - `tighten` / `trailer` → the `Edl` object at top level.
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
  // tighten / trailer: the Edl object at top level → drop the relay's viaNodaroCloud.
  const { viaNodaroCloud: _viaNodaroCloud, ...rest } = o
  return rest
}
