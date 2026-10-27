/**
 * A trend's stored face mask (pure; no I/O): what it was made from, whether
 * the one a draft carries still matches it, and what a run sends of it.
 *
 * A trend that masks faces (`faceMasking`, mode not "off") has ONE approved
 * mask: its whole source clip masked once ahead of time by the Cast Swap
 * engine (`POST /v1/cast-swap/face-mask`, a `cast-swap-face-mask` job), seen
 * and approved by an admin, and copied into the trend's storage
 * (`TrendFaceMask`). It is tied to:
 *   - the settings key (`faceMaskSettingsKey`): the source clip and the
 *     masking settings as a run sends them (`withResolvedZone`, the target
 *     resolved: left out = "head"), all but `mode` (always and auto mask the
 *     same clip);
 *   - the recipes: core's `VIDEO_MASK_RECIPE` (Video Mask's algorithm) and the
 *     engine's `faceMaskRecipe` (its own masking parameters), per environment.
 * Editing the source or the settings, or a recipe bump, makes it OUT OF DATE
 * (`faceMaskState`). The settings include the `"erased"` marks
 * (`faceMasking.marks`, decided 2026-10-26): an erased mark's box leaves the
 * faces centred in it out of the mask. Slot marks (`{ slot }`, decided
 * 2026-10-27) never touch the base mask — not its key, its make or its
 * approval: they shape the per-person variants only (face-mask-variants.ts).
 * A mask also keeps what it was made from before any mark
 * was applied (`rawMaskUrl`, `depthUrl`, `baseKey`: the BASE key, the
 * settings without the marks), so editing only the erased marks re-makes it from
 * that (`reusableFaceMaskBase`) without running the face finder again. A
 * trend with erased marks runs on its approved mask only (compose.ts refuses the
 * run otherwise). Publishing a masked trend needs an approved, up-to-date
 * one (publish-check.ts); a run sends it while its settings key matches
 * (compose.ts), and masks per run otherwise.
 */
import { createHash } from "node:crypto"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import { CAST_SWAP_FACE_MASKING_DEFAULTS } from "@nodaro/shared/models"
import { isErasedFaceMaskMark } from "@nodaro/render-rules"
import {
  faceMaskTargetOf,
  faceMaskingOn,
  faceMaskingSent,
  faceMaskingSourceOf,
  makeMarksOf,
  withResolvedZone,
  withoutMarks,
  type FaceMaskMark,
  type FaceMaskingWithMarks,
} from "../../../lib/cast-swap-face-masking.js"
import type { EngineEnvironment } from "../engine-environments.js"
import type { TrendFaceMask, TrendVersionData } from "./types.js"

/** The engine's job type for a trend's face mask. */
export const FACE_MASK_JOB_TYPE = "cast-swap-face-mask"

/** JSON with every object's keys sorted and undefined values left out: equal settings, equal text. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableJson(x)}`).join(",")}}`
  }
  return JSON.stringify(v)
}

/**
 * The settings key of a mask made from `videoUrl` with `masking`: a hash of
 * the clip and the setting with its zone resolved, as a run sends it, without
 * its `mode` (always and auto mask the same clip). The same for a setting
 * already resolved (`withResolvedZone` is idempotent). `v2`: v1 hashed the mode too.
 *
 * The target is resolved first (left out = "head", `faceMaskTargetOf`) and
 * hashed only when it is "face": a setting that leaves it out and one that
 * says "head" hash exactly as every setting did before the target existed,
 * so the masks approved then (all made of heads) stay up to date, while
 * switching between face and head makes a stored mask out of date.
 *
 * The marks likewise: the `"erased"` ones only, hashed only when there are
 * some (in a fixed order, so the same marks in another order are the same
 * mask), so a setting with none — left out, empty, or slot marks alone —
 * hashes exactly as every setting did before marks existed, and every mask
 * approved then stays up to date. Slot marks never change the base mask, so
 * they never change its key (the variants key them: face-mask-variants.ts).
 *
 * The source mode (`source`) is hashed only when it is not `"faces"`, so a
 * setting that names `"faces"` and one that leaves it out hash exactly as
 * before source modes existed. A depth mode hashes what its make reads
 * (`faceMaskingSent`: full depth, the mode alone; keep people, all but the
 * fill, its target resolved) and its make's marks (erased and main,
 * `makeMarksOf`), so a mask made under one mode is out of date under another.
 */
export function faceMaskSettingsKeyOf(videoUrl: string, masking: FaceMaskingWithMarks): string {
  const marks = makeMarksOf(masking).map(stableJson).sort()
  const withMarks = { ...(marks.length > 0 ? { marks: marks.map((mark) => JSON.parse(mark) as unknown) } : {}) }
  if (faceMaskingSourceOf(masking) !== "faces") {
    const { mode: _mode, ...settings } = faceMaskingSent(withoutMarks(masking))
    return keyOf({ videoUrl, faceMasking: { ...settings, ...withMarks } })
  }
  const { mode: _mode, target: _target, source: _source, ...settings } = withResolvedZone(withoutMarks(masking))
  const target = faceMaskTargetOf(masking)
  const faceMasking = {
    ...settings,
    ...(target === "head" ? {} : { target }),
    ...withMarks,
  }
  return keyOf({ videoUrl, faceMasking })
}

const keyOf = (v: unknown): string => `v2:${createHash("sha256").update(stableJson(v)).digest("hex")}`

/** The draft's settings key, or null when it has no source clip or does not mask. */
export function faceMaskSettingsKey(data: Pick<TrendVersionData, "source" | "faceMasking">): string | null {
  if (!data.source || !faceMaskingOn(data.faceMasking)) return null
  return faceMaskSettingsKeyOf(data.source.videoUrl, data.faceMasking)
}

/**
 * The draft's BASE key: its settings key with the marks left out (with none,
 * its settings key), or null like `faceMaskSettingsKey`. A mask's raw mask
 * (before any mark) is made from exactly this.
 */
export function faceMaskBaseKey(data: Pick<TrendVersionData, "source" | "faceMasking">): string | null {
  if (!data.source || !faceMaskingOn(data.faceMasking)) return null
  return faceMaskSettingsKeyOf(data.source.videoUrl, withoutMarks(data.faceMasking))
}

/**
 * Whether a face mask job was made with exactly `marks` (in any order): its
 * recorded `input_data.faceMasking.marks` (`recorded`, absent = none). An
 * engine that does not take marks strips them, so its mask would cover the
 * faces they leave out: approving checks this first, against the draft's
 * `"erased"` marks (a make never sends slot marks).
 */
export function faceMaskMarksMatch(recorded: unknown, marks: readonly FaceMaskMark[]): boolean {
  const list = recorded === undefined ? [] : recorded
  if (!Array.isArray(list)) return false
  const key = (xs: readonly unknown[]) => xs.map(stableJson).sort().join("\n")
  return key(list) === key(marks)
}

/**
 * Whether the draft's face masking has `"erased"` marks its make applies
 * (masking on, and at least one; a full-depth clip applies none): faces every
 * run leaves unmasked, so every run must use the stored mask. Slot marks alone
 * are not (the base mask covers every face).
 */
export function faceMaskHasErasedMarks(data: Pick<TrendVersionData, "faceMasking">): boolean {
  return faceMaskingOn(data.faceMasking) && makeMarksOf(data.faceMasking).some(isErasedFaceMaskMark)
}

/**
 * Whether every run must use the draft's stored clip (`storedFaceMask` with
 * `required: true`), never masking per run: a depth mode's clip (made once and
 * approved, never per run), or a face mask with erased marks.
 */
export function faceMaskStoredRequired(data: Pick<TrendVersionData, "faceMasking">): boolean {
  return faceMaskingOn(data.faceMasking) && (faceMaskingSourceOf(data.faceMasking) !== "faces" || faceMaskHasErasedMarks(data))
}

/**
 * The raw mask a make may start from instead of finding the faces again
 * (`fromMask` of `POST /v1/cast-swap/face-mask`), or undefined (a whole make).
 * The approved mask's own only (decided 2026-10-26), and only when:
 *   - it was made from the draft's current BASE settings (`baseKey` =
 *     `faceMaskBaseKey`) and kept its raw mask (`rawMaskUrl`), and its depth
 *     view (`depthUrl`) when the fill is depth;
 *   - it was made by the masking that runs now: core's `VIDEO_MASK_RECIPE`
 *     and the loaded engine's `faceMaskRecipe` (`engineRecipe`), so a stale
 *     raw mask is never re-used again and again.
 * `recipe` is the approved mask's and `stats` its raw mask's (`baseStats`; a
 * mask approved before them: its `stats` when nothing was erased, else it is
 * no base), which the engine carries onto the new mask (its coverage then the
 * erase's, when one runs).
 */
export interface FaceMaskBase {
  maskUrl: string
  depthUrl?: string
  recipe: string | null
  stats: { shots: number; heldFrames: number; coverage: number; droppedRegions: number }
}

export function reusableFaceMaskBase(
  data: Pick<TrendVersionData, "source" | "faceMasking" | "faceMask">,
  engineRecipe: string | undefined,
): FaceMaskBase | undefined {
  const mask = data.faceMask
  const base = faceMaskBaseKey(data)
  // A face mask's raw mask only: a depth clip is always made whole.
  if (faceMaskingSourceOf(data.faceMasking) !== "faces") return undefined
  if (!mask || base === null || mask.baseKey !== base || !mask.rawMaskUrl) return undefined
  if (mask.recipe.core !== VIDEO_MASK_RECIPE || engineRecipe === undefined || mask.recipe.plugin !== engineRecipe) return undefined
  const fill = data.faceMasking?.fill ?? CAST_SWAP_FACE_MASKING_DEFAULTS.fill
  if (fill === "depth" && !mask.depthUrl) return undefined
  // The raw mask's stats; a mask approved before they were kept stands in its own only when nothing was
  // erased from it (then they ARE the raw mask's), else it is no base.
  const raw = mask.baseStats ?? ((mask.stats.erasedRegions ?? 0) === 0 ? mask.stats : undefined)
  if (!raw) return undefined
  const { shots, heldFrames, coverage, droppedRegions } = raw
  return {
    maskUrl: mask.rawMaskUrl,
    ...(fill === "depth" ? { depthUrl: mask.depthUrl } : {}),
    recipe: mask.recipe.core,
    stats: { shots, heldFrames, coverage, droppedRegions },
  }
}

/** Why a stored mask is out of date: settings changed, Video Mask's recipe moved, or an environment's engine recipe. */
export type FaceMaskOutOfDate =
  | { why: "settings" }
  | { why: "core_recipe" }
  | { why: "plugin_recipe"; env: string }

export interface FaceMaskState {
  /** `none`: no mask stored; `approved`: stored and up to date; `out_of_date`: see `reasons`. */
  status: "none" | "approved" | "out_of_date"
  reasons: FaceMaskOutOfDate[]
}

/**
 * Whether the draft's stored mask is up to date. `environments` null = not
 * known (a failed read): the engine recipes are then not checked. An
 * environment in `required` with no row, or whose engine makes no stored
 * masks, is not compared either: publishing already refuses it
 * (`engine_unknown` / `engine_unsupported`). A full-depth clip is made with
 * no Video Mask step, so core's recipe is not compared for it.
 */
export function faceMaskState(
  data: Pick<TrendVersionData, "source" | "faceMasking" | "faceMask">,
  environments: readonly EngineEnvironment[] | null,
  required: readonly string[],
): FaceMaskState {
  const mask = data.faceMask
  if (!mask) return { status: "none", reasons: [] }
  const reasons: FaceMaskOutOfDate[] = []
  if (mask.settingsKey !== faceMaskSettingsKey(data)) reasons.push({ why: "settings" })
  // A full-depth clip runs no Video Mask (its make records `core: null`): only the engine's recipe applies.
  if (faceMaskingSourceOf(data.faceMasking) !== "full-depth" && mask.recipe.core !== VIDEO_MASK_RECIPE) reasons.push({ why: "core_recipe" })
  for (const env of environments ? required : []) {
    const cs = environments!.find((e) => e.env === env)?.supports.castSwap
    if (cs?.storedFaceMask !== true) continue
    if (cs.faceMaskRecipe !== mask.recipe.plugin) reasons.push({ why: "plugin_recipe", env })
  }
  return { status: reasons.length > 0 ? "out_of_date" : "approved", reasons }
}

/**
 * What a run sends of the stored mask: `{ url, frames }` when the trend masks
 * and its mask was made from these exact settings, else undefined (the run
 * masks per run, as before stored masks).
 */
export function storedFaceMaskFor(data: Pick<TrendVersionData, "source" | "faceMasking" | "faceMask">): { url: string; frames: number } | undefined {
  const mask = data.faceMask
  const key = faceMaskSettingsKey(data)
  if (!mask || key === null || mask.settingsKey !== key) return undefined
  return { url: mask.url, frames: mask.frames }
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0)

/** A finished face mask job's raw-mask stats (`output.baseStats`), each a number, or undefined when the engine sent none. */
export function faceMaskBaseStats(v: unknown): TrendFaceMask["baseStats"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined
  const { shots, heldFrames, coverage, droppedRegions } = faceMaskStats(v)
  return { shots, heldFrames, coverage, droppedRegions }
}

/**
 * A finished face mask job's stats, each a number (one the engine left out is
 * 0). `erasedRegions` only when the engine reports it (an engine that takes
 * marks always does): absent reads as 0.
 */
export function faceMaskStats(v: unknown): TrendFaceMask["stats"] {
  const s = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  return {
    shots: count(s.shots),
    heldFrames: count(s.heldFrames),
    coverage: count(s.coverage),
    droppedRegions: count(s.droppedRegions),
    ...(s.erasedRegions !== undefined ? { erasedRegions: count(s.erasedRegions) } : {}),
  }
}

/** The face mask job being made, as the editor shows it: `current` = made from the draft's current settings. */
export interface PendingFaceMaskJob {
  jobId: string
  startedAt: string
  current: boolean
}

export function pendingFaceMaskJob(data: Pick<TrendVersionData, "source" | "faceMasking" | "faceMaskJob">): PendingFaceMaskJob | null {
  const job = data.faceMaskJob
  if (!job) return null
  const key = faceMaskSettingsKey(data)
  return { jobId: job.jobId, startedAt: job.startedAt, current: key !== null && job.settingsKey === key }
}
