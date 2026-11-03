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
  depthColormapSent,
  faceMaskTargetOf,
  faceMaskingOn,
  faceMaskingSent,
  faceMaskingSourceOf,
  makeMarksOf,
  roleOutlinesOn,
  withResolvedZone,
  withoutMarks,
  type FaceMaskMark,
  type FaceMaskingWithMarks,
} from "../../../lib/cast-swap-face-masking.js"
import { makeOutlinesOf } from "./role-outlines.js"
import { sceneStepKeyOf } from "../../../lib/cast-swap-steps.js"
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
 *
 * The face mesh (`faceMesh`) is hashed only when it is on (`true`, faces
 * hidden or full depth: `withResolvedZone` / `faceMaskingSent` drop a
 * `false`), so every setting without it hashes exactly as before it existed
 * and every mask approved then stays up to date, while turning it on or off
 * makes a stored mask out of date. The base key (`faceMaskBaseKey`) carries it
 * too, so a raw mask made without the mesh is never the base of a mask with it
 * (`reusableFaceMaskBase`), nor the other way round.
 *
 * Role outlines (`roleOutlines`, decided 2026-11-01; faces hidden only) are
 * hashed only when on (`roleOutlinesOn`), with the outlines its make draws
 * (`outlines`: each person slot with slot marks, its colour and its boxes,
 * from `slots`), so every setting without them hashes exactly as before they
 * existed, while turning them on, editing a role's boxes or moving a person
 * slot (its colour) makes a stored mask out of date. The base key carries
 * only what changes the raw mask and its depth view: a depth fill is drawn
 * gray while outlines are on (`faceMaskBaseKey`).
 *
 * The depth colormap (`depthColormap`, decided 2026-11-01) is hashed only
 * when it changes what is drawn (`depthColormapSent`: present, where depth is
 * drawn, not the source's default, not under role outlines), so every setting
 * without one hashes exactly as before it existed, while choosing another map
 * makes a stored clip out of date.
 *
 * The depth model's size (`depthModelSize`, decided 2026-11-02) likewise, only
 * when it changes the render (`depthModelSizeSent`: where depth is drawn, not
 * `"large"`; under role outlines too), so every setting without one hashes
 * exactly as before it existed.
 *
 * Full depth's smallest face with mesh lines (`faceMeshMinFaceHeightPct`,
 * decided 2026-11-03) is hashed only when it is SET where it applies
 * (`faceMeshMinFaceHeightSent`: Full depth, the face mesh on), any value,
 * the engine's default 10 included. Left out it is not hashed, so every Full
 * depth clip with the mesh approved before it existed stays up to date (and
 * its runs go on), while setting it or changing it makes the stored clip out
 * of date. Neither the engine's `faceMaskRecipe` nor core's `VIDEO_MASK_RECIPE`
 * moves for it.
 */
export function faceMaskSettingsKeyOf(videoUrl: string, masking: FaceMaskingWithMarks, slots: TrendVersionData["slots"]): string {
  const outlines = makeOutlinesOf({ slots, faceMasking: masking }).map((o) => ({ ...o, boxes: o.boxes.map(stableJson).sort().map((b) => JSON.parse(b) as unknown) }))
  return settingsHash(videoUrl, masking, roleOutlinesOn(masking) ? { roleOutlines: true, ...(outlines.length > 0 ? { outlines } : {}) } : {})
}

/** The settings key's hash, with `extra` (faces hidden only) beside the settings. */
function settingsHash(videoUrl: string, masking: FaceMaskingWithMarks, extra: Record<string, unknown>): string {
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
    ...extra,
  }
  return keyOf({ videoUrl, faceMasking })
}

const keyOf = (v: unknown): string => `v2:${createHash("sha256").update(stableJson(v)).digest("hex")}`

/** The draft's settings key, or null when it has no source clip or does not mask. */
export function faceMaskSettingsKey(data: Pick<TrendVersionData, "source" | "faceMasking" | "slots">): string | null {
  if (!data.source || !faceMaskingOn(data.faceMasking)) return null
  return faceMaskSettingsKeyOf(data.source.videoUrl, data.faceMasking, data.slots)
}

/**
 * The draft's BASE key: its settings key with the marks (and role outlines)
 * left out (with neither, its settings key), or null like
 * `faceMaskSettingsKey`. A mask's raw mask (before any mark) is made from
 * exactly this. With role outlines on and a depth fill, the depth view is
 * drawn gray (decided 2026-11-01), so that is hashed too
 * (`depthColormap: "grayscale"`): a turbo depth view is never the base of a
 * mask with outlines, nor the other way round; a blur fill's raw mask is the
 * same either way, so it stays the base.
 *
 * A chosen depth colormap (`depthColormapSent`) is never hashed here: an
 * engine that draws one renders the depth GRAY once and colours it with the
 * map for the clip it makes, so its depth view is the gray render whatever
 * the map (Full depth and Keep people render gray today too), and another map
 * re-colours the same base. A faces-hidden depth fill with a colormap is
 * therefore the gray view, hashed as role outlines' (`depthColormap:
 * "grayscale"`): today's turbo depth view (no colormap) is never the base of
 * one with a colormap, nor the other way round.
 *
 * The depth model's size (`depthModelSizeSent`) IS hashed here, unlike the
 * colormap: it changes the depth render itself, so a raw mask and depth view
 * drawn with one size are never the base of a mask with another. `withoutMarks`
 * keeps it (normalised: `"large"` is no key), so the base key of a setting
 * without one is exactly as before it existed.
 */
export function faceMaskBaseKey(data: Pick<TrendVersionData, "source" | "faceMasking">): string | null {
  if (!data.source || !faceMaskingOn(data.faceMasking)) return null
  const m = data.faceMasking
  const depthFill = faceMaskingSourceOf(m) === "faces" && (m.fill ?? CAST_SWAP_FACE_MASKING_DEFAULTS.fill) === "depth"
  const grayDepth = depthFill && (roleOutlinesOn(m) || depthColormapSent(m) !== undefined)
  const { depthColormap: _colormap, ...base } = withoutMarks(m)
  return settingsHash(data.source.videoUrl, base, grayDepth ? { depthColormap: "grayscale" } : {})
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
 * approved, never per run), a face mask with erased marks, or one with role
 * outlines (a mask made per run draws none, decided 2026-11-01: a box edited
 * after approval makes runs refuse `face_mask_required` until it is made again).
 */
export function faceMaskStoredRequired(data: Pick<TrendVersionData, "faceMasking">): boolean {
  return (
    faceMaskingOn(data.faceMasking) &&
    (faceMaskingSourceOf(data.faceMasking) !== "faces" || faceMaskHasErasedMarks(data) || roleOutlinesOn(data.faceMasking))
  )
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

/**
 * The face mesh recipe (core's `VIDEO_FACE_MESH_RECIPE`, which a stored mask
 * records as `meshRecipe`) of MediaPipe's refined landmark model before the
 * stray-face fixes (decided 2026-11-03). A mesh drawn by it could take a tiny
 * or false face for a frame or two (a few % of the frame tall, or a shape in
 * a dark gap), and on a Full depth clip the video model renders such a lone
 * mesh as an object. The fixes: the drawer draws a face only when its track
 * finds it in 3 frames or more (the recipe after this one), and Full depth's
 * mesh skips the faces under its smallest face and in the side margins (Cast
 * Swap engine 0.436.1). The basic model's recipes before it ("2026-10-31",
 * "2026-11-01") never drew those strays, and none after it does. Named here
 * alone: a stored mask with it is flagged to make again (`FaceMaskFlag`).
 */
export const FACE_MESH_RECIPE_BEFORE_STRAY_FIX = "2026-11-02"

/**
 * Why a stored mask is worth making again although nothing makes it out of
 * date: its face mesh was drawn before the stray-face fix
 * (`FACE_MESH_RECIPE_BEFORE_STRAY_FIX`). A separate, non-blocking kind: never
 * one of `reasons`, so it never makes the mask out of date, holds back an
 * approval or a publish, or stops a run (a run keeps using the stored clip).
 */
export type FaceMaskFlag = { why: "face_mesh_before_stray_fix" }

export interface FaceMaskState {
  /** `none`: no mask stored; `approved`: stored and up to date; `out_of_date`: see `reasons`. */
  status: "none" | "approved" | "out_of_date"
  reasons: FaceMaskOutOfDate[]
  /**
   * The stored scene texts were made with another scene description step
   * than the draft's (`sceneStepChanged`). Present (true) only then: the
   * texts are still sent, so it never makes the mask out of date.
   */
  sceneStepChanged?: true
  /** What the editor flags to make again (`FaceMaskFlag`), never a reason: present only when there is one. */
  flags?: FaceMaskFlag[]
}

/** The stored mask's flags (`FaceMaskFlag`): its face mesh drawn by the recipe before the stray-face fix. */
export function faceMaskFlagsOf(mask: Pick<TrendFaceMask, "meshRecipe"> | undefined): FaceMaskFlag[] {
  return mask?.meshRecipe === FACE_MESH_RECIPE_BEFORE_STRAY_FIX ? [{ why: "face_mesh_before_stray_fix" }] : []
}

/**
 * Whether the draft's stored mask is up to date. `environments` null = not
 * known (a failed read): the engine recipes are then not checked. An
 * environment in `required` with no row, or whose engine makes no stored
 * masks, is not compared either: publishing already refuses it
 * (`engine_unknown` / `engine_unsupported`). A full-depth clip is made with
 * no Video Mask step, so core's recipe is not compared for it.
 *
 * A mask with stored scene texts made with another scene description step
 * than the draft's (`sceneStepChanged`) is said so (`sceneStepChanged:
 * true`), never out of date: the stored texts are still sent, and the editor
 * offers a remake.
 *
 * A mask whose face mesh was drawn before the stray-face fix is flagged
 * (`flags`, `faceMaskFlagsOf`), whatever its source mode and status, never
 * out of date: the publish check and the approval read `status` and
 * `reasons` only, and a run reads the settings key (`storedFaceMaskFor`).
 */
export function faceMaskState(
  data: Pick<TrendVersionData, "source" | "faceMasking" | "faceMask" | "steps" | "slots">,
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
  const flags = faceMaskFlagsOf(mask)
  return {
    status: reasons.length > 0 ? "out_of_date" : "approved",
    reasons,
    ...(sceneStepChanged(data) ? { sceneStepChanged: true as const } : {}),
    ...(flags.length > 0 ? { flags } : {}),
  }
}

/**
 * Whether the approved mask's stored scene text (`sceneDescription`, the one
 * every run sends) was made with another scene description step
 * than the draft's `steps.sceneDescription`: the key its make recorded
 * (`sceneStepKey`, absent = none sent) against the draft's (`sceneStepKeyOf`,
 * absent = unset). Both absent is the same step. False with no stored text.
 */
export function sceneStepChanged(data: Pick<TrendVersionData, "faceMask" | "steps">): boolean {
  const mask = data.faceMask
  if (!mask || mask.sceneDescription === undefined) return false
  return mask.sceneStepKey !== sceneStepKeyOf(data.steps?.sceneDescription)
}

/**
 * What a run sends of the stored mask: `{ url, frames }` when the trend masks
 * and its mask was made from these exact settings, else undefined (the run
 * masks per run, as before stored masks). With the faces its make drew the
 * face mesh on (`facesDrawn`) and the mesh's recipe (`meshRecipe`) when it
 * reported them; only an engine that draws the mesh is sent those
 * (`withoutUnsupportedStoredMask`).
 */
export function storedFaceMaskFor(
  data: Pick<TrendVersionData, "source" | "faceMasking" | "faceMask" | "slots">,
): { url: string; frames: number; facesDrawn?: number; meshRecipe?: string } | undefined {
  const mask = data.faceMask
  const key = faceMaskSettingsKey(data)
  if (!mask || key === null || mask.settingsKey !== key) return undefined
  return {
    url: mask.url,
    frames: mask.frames,
    ...(typeof mask.facesDrawn === "number" ? { facesDrawn: mask.facesDrawn } : {}),
    ...(mask.meshRecipe ? { meshRecipe: mask.meshRecipe } : {}),
  }
}

/**
 * The recipe a finished face mask job's face mesh was drawn by
 * (`output_data.faceMesh.recipe`, core's `VIDEO_FACE_MESH_RECIPE`): a string
 * of 1–40 characters, else undefined (no mesh, or an engine that does not
 * report it).
 */
export function faceMeshRecipeOf(output: unknown): string | undefined {
  const mesh = output && typeof output === "object" ? (output as Record<string, unknown>).faceMesh : undefined
  const r = mesh && typeof mesh === "object" ? (mesh as Record<string, unknown>).recipe : undefined
  return typeof r === "string" && r.length >= 1 && r.length <= 40 ? r : undefined
}

/**
 * The faces a finished face mask job drew the face mesh on
 * (`output_data.faceMesh.facesDrawn`): a whole number ≥ 0, else undefined (no
 * mesh, or an engine that does not report it).
 */
export function faceMeshFacesDrawnOf(output: unknown): number | undefined {
  const mesh = output && typeof output === "object" ? (output as Record<string, unknown>).faceMesh : undefined
  const n = mesh && typeof mesh === "object" ? (mesh as Record<string, unknown>).facesDrawn : undefined
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : undefined
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

export function pendingFaceMaskJob(data: Pick<TrendVersionData, "source" | "faceMasking" | "faceMaskJob" | "slots">): PendingFaceMaskJob | null {
  const job = data.faceMaskJob
  if (!job) return null
  const key = faceMaskSettingsKey(data)
  return { jobId: job.jobId, startedAt: job.startedAt, current: key !== null && job.settingsKey === key }
}
