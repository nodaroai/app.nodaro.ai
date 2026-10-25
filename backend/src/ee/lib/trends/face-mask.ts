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
 *     masking settings as a run sends them (`withResolvedZone`), all but
 *     `mode` (always and auto mask the same clip);
 *   - the recipes: core's `VIDEO_MASK_RECIPE` (Video Mask's algorithm) and the
 *     engine's `faceMaskRecipe` (its own masking parameters), per environment.
 * Editing the source or the settings, or a recipe bump, makes it OUT OF DATE
 * (`faceMaskState`). Publishing a masked trend needs an approved, up-to-date
 * one (publish-check.ts); a run sends it while its settings key matches
 * (compose.ts), and masks per run otherwise.
 */
import { createHash } from "node:crypto"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import { faceMaskingOn, withResolvedZone, type FaceMasking } from "../../../lib/cast-swap-face-masking.js"
import type { EngineEnvironment } from "../engine-environments.js"
import type { TrendFaceMask, TrendVersionData } from "./types.js"

/** The engine's job type for a trend's face mask. */
export const FACE_MASK_JOB_TYPE = "cast-swap-face-mask"

/** JSON with every object's keys sorted and undefined values left out: equal settings, equal text. */
function stableJson(v: unknown): string {
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
 */
export function faceMaskSettingsKeyOf(videoUrl: string, masking: FaceMasking): string {
  const { mode: _mode, ...settings } = withResolvedZone(masking)
  const text = stableJson({ videoUrl, faceMasking: settings })
  return `v2:${createHash("sha256").update(text).digest("hex")}`
}

/** The draft's settings key, or null when it has no source clip or does not mask. */
export function faceMaskSettingsKey(data: Pick<TrendVersionData, "source" | "faceMasking">): string | null {
  if (!data.source || !faceMaskingOn(data.faceMasking)) return null
  return faceMaskSettingsKeyOf(data.source.videoUrl, data.faceMasking)
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
 * (`engine_unknown` / `engine_unsupported`).
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
  if (mask.recipe.core !== VIDEO_MASK_RECIPE) reasons.push({ why: "core_recipe" })
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

/** A finished face mask job's stats, each a number (one the engine left out is 0). */
export function faceMaskStats(v: unknown): TrendFaceMask["stats"] {
  const s = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  return { shots: count(s.shots), heldFrames: count(s.heldFrames), coverage: count(s.coverage), droppedRegions: count(s.droppedRegions) }
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
