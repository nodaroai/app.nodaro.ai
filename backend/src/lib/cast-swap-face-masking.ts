/**
 * Cast Swap's `faceMasking` setting (camelCase, as the `/v1/cast-swap` body
 * takes it and `@nodaro/sdk`'s `CastSwapFaceMasking` types it): cover the
 * faces in the source clip before the video model sees it.
 *
 * One definition for every backend place that stores or validates it (a
 * trend version's `faceMasking`, for one). Keys left out take the engine's
 * defaults; strict objects, so a misspelt key is an error, never dropped.
 * `zone` left out is 10 % margins at the left and right
 * (`CAST_SWAP_FACE_MASKING_DEFAULTS.zone`); `zone: null`, or all four margins
 * 0, is no margins. Stored as given: a left-out zone stays left out, and the
 * default is filled in only when a run is composed (`withResolvedZone`).
 */
import { z } from "zod"
import {
  CAST_SWAP_FACE_MASKING_BOUNDS,
  CAST_SWAP_FACE_MASKING_DEFAULTS,
  CAST_SWAP_FACE_MASK_TARGETS,
  type CastSwapFaceMaskTarget,
} from "@nodaro/shared/models"
import { VIDEO_DEPTH_COLORMAPS, videoDepthColormaps, type VideoDepthColormap } from "@nodaro/shared/media"
// Internal only (render-rules, not an Apache grant): a trend face mask's marks and source modes.
import {
  CAST_SWAP_FACE_MASK_MARK_LABELS,
  CAST_SWAP_FACE_MASK_MARK_LIMITS,
  CAST_SWAP_FULL_DEPTH_SCENES,
  CAST_SWAP_FULL_DEPTH_SCENE_DEFAULT,
  CAST_SWAP_SOURCE_MODES,
  faceMaskMarkSlot,
  isErasedFaceMaskMark,
  isMainFaceMaskMark,
  type CastSwapFullDepthScene,
  type CastSwapSourceMode,
  type FaceMaskMark,
  type MaskEraseBox,
} from "@nodaro/render-rules"
import { getPluginSupports } from "./private-plugins/supports-registry.js"

export type FaceMaskingMode = "off" | "always" | "auto"
export type FaceMaskingFill = "blur" | "depth"
/** What a mask covers: `"head"` (default: hair and people seen from behind too), `"face"` (the hair stays visible) or `"body"` (the whole person: hidden with faces hidden, kept with keep people; never full depth). */
export type FaceMaskingTarget = CastSwapFaceMaskTarget
/**
 * How a trend's clip is prepared (`source`, absent = `"faces"`): the faces
 * hidden (`"faces"`), the whole clip as one grayscale depth video
 * (`"full-depth"`), or the people kept as filmed and the rest depth
 * (`"keep-people"`). The depth modes are a trend's alone (a direct run uses
 * `style`), need `mode: "always"` and run on the approved stored clip only.
 */
export type FaceMaskingSource = CastSwapSourceMode
/**
 * Where a full-depth run's scene comes from (`scene`, full depth only; left
 * out = `"description"`): a description the engine writes per run, the
 * original clip as a second video (clips up to 27.5 s on a trend), or none.
 */
export type FaceMaskingScene = CastSwapFullDepthScene
export type { FaceMaskMark, MaskEraseBox }

/**
 * The depth map's colormap (`depthColormap`, decided 2026-11-01): what the
 * depth provider Nodaro Motion draws depth with offers
 * (`videoDepthColormaps("video-depth-anything")`: grayscale, turbo, inferno,
 * magma, viridis).
 */
export type FaceMaskingDepthColormap = VideoDepthColormap

/** The provider Nodaro Motion draws its depth with: its colormaps are the ones a setting may name. */
const DEPTH_PROVIDER = "video-depth-anything"

/** The colormaps a setting may name (`FaceMaskingDepthColormap`), in display order. */
export const FACE_MASKING_DEPTH_COLORMAPS: readonly FaceMaskingDepthColormap[] = videoDepthColormaps(DEPTH_PROVIDER)

export interface FaceMaskingZone {
  leftPct?: number
  rightPct?: number
  topPct?: number
  bottomPct?: number
}

export interface FaceMasking {
  mode: FaceMaskingMode
  /**
   * How the clip is prepared; left out = `"faces"`. `"full-depth"` reads
   * `mode` only (every other key does not apply and is not sent);
   * `"keep-people"` reads all but `fill` (outside the people is always depth).
   */
  source?: FaceMaskingSource
  /**
   * Full depth only: where the run's scene comes from (`FaceMaskingScene`;
   * left out = `"description"`). Changes what a run sends, never the stored
   * clip: it is not part of the settings key, and a make is never sent it.
   */
  scene?: FaceMaskingScene
  /**
   * What a mask covers. Left out = `"head"` (`CAST_SWAP_FACE_MASKING_DEFAULTS.target`):
   * the whole head, hair included, and people seen from behind or turned away;
   * `"face"` covers the face only and leaves the hair visible. `"body"` is the
   * whole person: hidden under the fill with faces hidden (the biggest mask),
   * kept as filmed with keep people (its default); full depth refuses it.
   */
  target?: FaceMaskingTarget
  fill?: FaceMaskingFill
  /** Mask only faces at least this % of the frame's height (0–100). */
  minFaceHeightPct?: number
  /** And at most this % (0–100); 0 = no limit. Above 0 it must be ≥ `minFaceHeightPct`. */
  maxFaceHeightPct?: number
  /**
   * Frame margins (0–49 % each, a margin left out of a given zone = 0); a face
   * centred in one is not masked. Left out = 10 % at the left and right; null
   * (or all 0) = no margins.
   */
  zone?: FaceMaskingZone | null
  /** The blur's strength, 0.1–5 % of the frame's width. */
  blurStrengthPct?: number
  /** How sure the face finder must be, 0.05–0.95. */
  threshold?: number
  /**
   * The face mesh (decided 2026-10-31): thin face lines (a mesh, the lip
   * outline, the eye outlines) drawn on the masked heads (faces hidden, any
   * target and fill) or on every face found (full depth), so the video model
   * keeps the mouth and the blinks it can no longer see. Absent or `false` =
   * off, exactly the run before it existed: `false` is never sent nor hashed
   * (`faceMeshOn`). Keep people refuses it (the faces stay as filmed there:
   * `face_mesh_not_with_keep_people`). An engine draws it only when it
   * declares `castSwap.faceMesh` (`engineDrawsFaceMesh`): the key is stripped
   * for one that does not (its strict schema would refuse it), and the
   * settings every environment shares are saved with it only once every one
   * does.
   */
  faceMesh?: boolean
  /**
   * The depth map's colormap wherever the setting draws depth (decided
   * 2026-11-01): full depth, keep people, or a faces-hidden depth fill
   * (`depthColormapApplies`). Absent = today's default for the source
   * (`depthColormapDefaultOf`: grayscale for full depth and keep people,
   * turbo for a depth fill), so nothing stored before it changes meaning.
   * Read through `depthColormapSent` (the one normaliser): a value where no
   * depth is drawn, one equal to the source's default, or one under role
   * outlines (which draw a depth fill gray) is the same as absent — never
   * sent nor hashed. An engine draws it only when it declares the map in
   * `castSwap.depthColormaps` (`engineDrawsDepthColormap`): the key is
   * stripped for one that does not.
   */
  depthColormap?: FaceMaskingDepthColormap
}

/**
 * A trend's face masking setting: `FaceMasking` plus `marks`, labelled boxes
 * on its stored face mask (`FaceMaskMark`, at most 50; decided 2026-10-26).
 * `"erased"`: the faces centred in the box, on its frames, are left out of
 * the mask. `{ slot }` (decided 2026-10-27): the faces are that optional
 * person's, left out only of the mask variants made for runs that leave the
 * person empty — never of the base mask, its settings key or its make
 * (`erasedMarksOf`). Marks belong to a trend's STORED face
 * mask only: `faceMaskingWithMarksSchema` is the one schema that takes them
 * (Nodaro Motion's defaults, through `faceMaskingSchema`, refuse the key), the
 * make route sends them to the engine, and a run never does (`withoutMarks`
 * gives the `FaceMasking` a run body carries, which has no such key).
 */
export interface FaceMaskingWithMarks extends FaceMasking {
  marks?: FaceMaskMark[]
  /**
   * Role outlines (decided 2026-11-01): the stored face mask draws a coloured
   * ring just outside each person role's masked region (the colour by the
   * role's place among the trend's person slots, `roleOutlineColour`), which
   * region is whose told by that role's slot marks; a run is sent which
   * colour is which role (`storedFaceMask.outlines`) and the prompt says so.
   * Faces hidden only. While on, a slot mark may name any person slot, a
   * required one too (`slotMarkAllowed`), and a depth fill is drawn gray (so
   * every colour reads). Like `marks`, the STORED mask's alone: never part of
   * what a run's `faceMasking` carries (`withoutMarks` drops it). Absent and
   * `false` are the same (off), never hashed (`roleOutlinesOn`).
   */
  roleOutlines?: boolean
}

/** The engine's default `minFaceHeightPct`, for the `min ≤ max` check when min is left out. */
export const FACE_MASKING_DEFAULT_MIN_FACE_HEIGHT_PCT = CAST_SWAP_FACE_MASKING_DEFAULTS.minFaceHeightPct

/** A number within `[min, max]` (the bounds in `@nodaro/shared`, which the admin screen reads too). */
const within = ([min, max]: readonly [number, number]) => z.number().min(min).max(max)
const pct = within(CAST_SWAP_FACE_MASKING_BOUNDS.faceHeightPct)
const margin = within(CAST_SWAP_FACE_MASKING_BOUNDS.zonePct)

export const faceMaskingZoneSchema: z.ZodType<FaceMaskingZone> = z.strictObject({
  leftPct: margin.optional(),
  rightPct: margin.optional(),
  topPct: margin.optional(),
  bottomPct: margin.optional(),
})

const edge = within(CAST_SWAP_FACE_MASK_MARK_LIMITS.edgePct)
const frame = z.int().min(0)
const boxShape = { fromFrame: frame, toFrame: frame, leftPct: edge, topPct: edge, rightPct: edge, bottomPct: edge }
type Box = Pick<MaskEraseBox, "fromFrame" | "toFrame" | "leftPct" | "rightPct" | "topPct" | "bottomPct">
/** Whole frames, `from ≤ to`, and a box with room inside (`left < right`, `top < bottom`). */
function boxChecks<T extends z.ZodType<Box>>(schema: T) {
  return schema
    .refine((b) => b.fromFrame <= b.toFrame, { path: ["toFrame"], message: "The last frame must be at or after the first." })
    .refine((b) => b.leftPct < b.rightPct, { path: ["rightPct"], message: "The box's right edge must be right of its left edge." })
    .refine((b) => b.topPct < b.bottomPct, { path: ["bottomPct"], message: "The box's bottom edge must be below its top edge." })
}

/** One box of the core `mask-erase` job (`MaskEraseBox`), strict. */
export const maskEraseBoxSchema: z.ZodType<MaskEraseBox> = boxChecks(z.strictObject(boxShape))

/**
 * A slot mark's label, `{ slot }`: a trend slot's key (whether it names an
 * optional person slot of the same trend is the trend schema's check).
 */
const slotLabelSchema = z.strictObject({ slot: z.string().min(1).max(32) })

/** One face mask mark (`FaceMaskMark`): a label (`"erased"` or `{ slot }`) and a box (`maskEraseBoxSchema`'s checks), strict. */
export const faceMaskMarkSchema: z.ZodType<FaceMaskMark> = boxChecks(
  z.strictObject({ label: z.union([z.enum(CAST_SWAP_FACE_MASK_MARK_LABELS), slotLabelSchema]), ...boxShape }),
)

const faceMaskingShape = {
  mode: z.enum(["off", "always", "auto"]),
  source: z.enum(CAST_SWAP_SOURCE_MODES).optional(),
  scene: z.enum(CAST_SWAP_FULL_DEPTH_SCENES).optional(),
  target: z.enum(CAST_SWAP_FACE_MASK_TARGETS).optional(),
  fill: z.enum(["blur", "depth"]).optional(),
  minFaceHeightPct: pct.optional(),
  maxFaceHeightPct: pct.optional(),
  zone: faceMaskingZoneSchema.nullable().optional(),
  blurStrengthPct: within(CAST_SWAP_FACE_MASKING_BOUNDS.blurStrengthPct).optional(),
  threshold: within(CAST_SWAP_FACE_MASKING_BOUNDS.threshold).optional(),
  faceMesh: z.boolean().optional(),
  depthColormap: z
    .enum(VIDEO_DEPTH_COLORMAPS)
    .refine((c) => FACE_MASKING_DEPTH_COLORMAPS.includes(c), { message: "The depth provider does not offer this colormap." })
    .optional(),
}

const faceHeightsInOrder = (m: Pick<FaceMasking, "minFaceHeightPct" | "maxFaceHeightPct">) =>
  m.maxFaceHeightPct === undefined ||
  m.maxFaceHeightPct === 0 ||
  m.maxFaceHeightPct >= (m.minFaceHeightPct ?? FACE_MASKING_DEFAULT_MIN_FACE_HEIGHT_PCT)
const faceHeightsMessage = { path: ["maxFaceHeightPct"], message: "The largest face height must be at least the smallest (or 0 for no limit)." }

/** The issue code of a face mesh asked for with keep people (`sourceModeRules`), in the issue's `params.code`. */
export const FACE_MESH_NOT_WITH_KEEP_PEOPLE = "face_mesh_not_with_keep_people"

/**
 * What a source mode allows: a depth mode needs `mode: "always"` (its clip is
 * made once, approved and stored; "auto" and "off" have no meaning there), the
 * whole-person target is never full depth's (it masks no one), a `"main"`
 * mark is keep-people's alone, and the face mesh is never keep people's (the
 * faces stay as filmed there: there is no masked head to draw on). Only
 * `faceMesh: true` is refused: `false` is the same as left out.
 */
function sourceModeRules(m: FaceMaskingWithMarks, ctx: z.RefinementCtx): void {
  const source = faceMaskingSourceOf(m)
  if (source !== "faces" && m.mode !== "always") {
    ctx.addIssue({ code: "custom", path: ["mode"], message: `Clip preparation "${source}" needs mode "always".` })
  }
  if (m.scene !== undefined && source !== "full-depth") {
    ctx.addIssue({ code: "custom", path: ["scene"], message: "Where the scene comes from is a Full depth setting only." })
  }
  if (m.target === "body" && source === "full-depth") {
    ctx.addIssue({ code: "custom", path: ["target"], message: 'Full depth masks no one: the whole-person target ("body") is for Faces hidden and Keep people.' })
  }
  if (m.faceMesh === true && source === "keep-people") {
    ctx.addIssue({
      code: "custom",
      path: ["faceMesh"],
      params: { code: FACE_MESH_NOT_WITH_KEEP_PEOPLE },
      message: "The face mesh is drawn on masked heads or on a depth clip: Keep people keeps the faces as filmed, so it takes no face mesh.",
    })
  }
  ;(m.marks ?? []).forEach((mark, i) => {
    if (isMainFaceMaskMark(mark) && source !== "keep-people") {
      ctx.addIssue({ code: "custom", path: ["marks", i, "label"], message: `Face mask box ${i + 1} marks the main character, which only Keep people takes.` })
    }
  })
}

/**
 * A face masking setting without marks: what a run takes, and Nodaro Motion's
 * defaults (`nodaro_motion_masking`). A direct run's setting masks faces only:
 * a depth mode is a trend's (a direct run picks `style` instead), so any
 * `source` but `"faces"` is refused here.
 */
export const faceMaskingSchema: z.ZodType<FaceMasking> = z
  .strictObject(faceMaskingShape)
  .refine(faceHeightsInOrder, faceHeightsMessage)
  .superRefine(sourceModeRules)
  .refine((m) => faceMaskingSourceOf(m) === "faces", { path: ["source"], message: 'A direct run masks faces only: clip preparation is a trend setting (a direct run uses "style").' })

/**
 * A direct Motion run's masking (the `nodaro_motion_motion` setting's
 * `masking`): a face mask, or full depth (with its `scene`), never keep
 * people (a trend's alone) and never marks.
 */
export const faceMaskingMotionSchema: z.ZodType<FaceMasking> = z
  .strictObject(faceMaskingShape)
  .refine(faceHeightsInOrder, faceHeightsMessage)
  .superRefine(sourceModeRules)
  .refine((m) => faceMaskingSourceOf(m) !== "keep-people", { path: ["source"], message: "A direct Motion run hides faces or uses full depth: Keep people is a trend setting." })

/** The issue code of role outlines asked for with a depth mode (`faceMaskingWithMarksSchema`), in the issue's `params.code`. */
export const ROLE_OUTLINES_NEED_FACES = "role_outlines_need_faces"

/**
 * A trend's face masking setting: the setting (any source mode) plus `marks`
 * (at most `CAST_SWAP_FACE_MASK_MARK_LIMITS.maxMarks`) and `roleOutlines`
 * (Faces hidden only: a depth mode has no masked person to outline).
 */
export const faceMaskingWithMarksSchema: z.ZodType<FaceMaskingWithMarks> = z
  .strictObject({
    ...faceMaskingShape,
    marks: z.array(faceMaskMarkSchema).max(CAST_SWAP_FACE_MASK_MARK_LIMITS.maxMarks).optional(),
    roleOutlines: z.boolean().optional(),
  })
  .refine(faceHeightsInOrder, faceHeightsMessage)
  .superRefine(sourceModeRules)
  .superRefine((m, ctx) => {
    if (m.roleOutlines === true && faceMaskingSourceOf(m) !== "faces") {
      ctx.addIssue({
        code: "custom",
        path: ["roleOutlines"],
        params: { code: ROLE_OUTLINES_NEED_FACES },
        message: "Role outlines are drawn around hidden people: they need the clip preparation Faces hidden.",
      })
    }
  })

/** How the setting prepares the clip; left out = `"faces"`. */
export function faceMaskingSourceOf(m: Pick<FaceMasking, "source"> | undefined): FaceMaskingSource {
  return m?.source ?? "faces"
}

/** A full-depth setting's scene source, its default resolved; null for any other source. */
export function fullDepthSceneOf(m: Pick<FaceMasking, "source" | "scene"> | undefined): FaceMaskingScene | null {
  return faceMaskingSourceOf(m) === "full-depth" ? (m?.scene ?? CAST_SWAP_FULL_DEPTH_SCENE_DEFAULT) : null
}

/** The setting's marks; none (absent or empty) = `[]`. */
export function faceMaskMarksOf(m: Pick<FaceMaskingWithMarks, "marks"> | undefined): readonly FaceMaskMark[] {
  return m?.marks ?? []
}

/**
 * The setting's `"erased"` marks: the only marks the base mask, its settings
 * key, its make and its approval look at (slot marks shape the per-person
 * variants only).
 */
export function erasedMarksOf(m: Pick<FaceMaskingWithMarks, "marks"> | undefined): FaceMaskMark[] {
  return faceMaskMarksOf(m).filter(isErasedFaceMaskMark)
}

/**
 * The marks a make of this setting applies, in the setting's order: faces —
 * the `"erased"` ones (`erasedMarksOf`); keep people — the `"erased"` and the
 * `"main"` ones; full depth — none (it finds no one). Slot marks never.
 */
export function makeMarksOf(m: Pick<FaceMaskingWithMarks, "marks" | "source"> | undefined): FaceMaskMark[] {
  const source = faceMaskingSourceOf(m)
  if (source === "full-depth") return []
  return faceMaskMarksOf(m).filter((mark) => isErasedFaceMaskMark(mark) || (source === "keep-people" && isMainFaceMaskMark(mark)))
}

/** The setting's slot marks (`{ slot }`), each with the slot it names. */
export function slotMarksOf(m: Pick<FaceMaskingWithMarks, "marks"> | undefined): Array<{ slot: string; mark: FaceMaskMark }> {
  return faceMaskMarksOf(m).flatMap((mark) => {
    const slot = faceMaskMarkSlot(mark)
    return slot === null ? [] : [{ slot, mark }]
  })
}

/** A mark's box, its label dropped (a new object): what the core `mask-erase` job takes. */
export function boxOf(mark: MaskEraseBox): MaskEraseBox {
  const { fromFrame, toFrame, leftPct, topPct, rightPct, bottomPct } = mark
  return { fromFrame, toFrame, leftPct, topPct, rightPct, bottomPct }
}

/** The boxes of the setting's `"erased"` marks (labels dropped): what the core `mask-erase` job takes. */
export function erasedBoxesOf(m: Pick<FaceMaskingWithMarks, "marks"> | undefined): MaskEraseBox[] {
  return erasedMarksOf(m).map(boxOf)
}

/**
 * The setting without its marks and its role outlines (a new object): what a
 * run, and the base of a mask, are made from. Both belong to the STORED mask
 * alone (a run's strict `faceMasking` takes neither).
 */
export function withoutMarks(m: FaceMaskingWithMarks): FaceMasking {
  const { marks: _marks, roleOutlines: _outlines, ...rest } = m
  // The colormap as it is drawn (`depthColormapSent`): role outlines draw a depth fill gray, and they
  // are dropped here, so the colormap is settled before they are.
  return withDepthColormapNormalised(rest, depthColormapSent(m))
}

/**
 * Whether the setting draws depth, where a colormap applies: full depth, keep
 * people, or faces hidden with the depth fill (a fill left out is the blur).
 */
export function depthColormapApplies(m: Pick<FaceMasking, "source" | "fill">): boolean {
  return faceMaskingSourceOf(m) !== "faces" || (m.fill ?? CAST_SWAP_FACE_MASKING_DEFAULTS.fill) === "depth"
}

/**
 * The colormap a source draws its depth with when the setting names none:
 * grayscale for full depth and keep people, turbo for a faces-hidden depth
 * fill (what every make and run drew before the choice existed).
 */
export function depthColormapDefaultOf(source: FaceMaskingSource): FaceMaskingDepthColormap {
  return source === "faces" ? "turbo" : "grayscale"
}

/**
 * The colormap the setting's depth is drawn with, its default resolved: null
 * where it draws no depth (a blur fill); grayscale for a depth fill under
 * role outlines (decided 2026-11-01: every outline colour must read on it).
 */
export function depthColormapOf(m: Pick<FaceMaskingWithMarks, "source" | "fill" | "depthColormap" | "roleOutlines" | "mode">): FaceMaskingDepthColormap | null {
  if (!depthColormapApplies(m)) return null
  if (roleOutlinesOn(m)) return "grayscale"
  return depthColormapSent(m) ?? depthColormapDefaultOf(faceMaskingSourceOf(m))
}

/**
 * THE normaliser of `depthColormap`: the colormap the setting names, only
 * where it changes what is drawn — the setting draws depth
 * (`depthColormapApplies`), it is not the source's default
 * (`depthColormapDefaultOf`), and role outlines do not draw the fill gray.
 * Else (or no setting) undefined: the setting is sent and hashed exactly as
 * one without it.
 */
export function depthColormapSent(
  m: Pick<FaceMaskingWithMarks, "source" | "fill" | "depthColormap" | "roleOutlines" | "mode"> | undefined,
): FaceMaskingDepthColormap | undefined {
  const c = m?.depthColormap
  if (!m || c === undefined || !depthColormapApplies(m) || roleOutlinesOn(m)) return undefined
  return c === depthColormapDefaultOf(faceMaskingSourceOf(m)) ? undefined : c
}

/** The setting with `depthColormap` only as `colormap` (left out when undefined). A new object. */
function withDepthColormapNormalised<T extends FaceMasking>(m: T, colormap: FaceMaskingDepthColormap | undefined): T {
  const { depthColormap: _c, ...rest } = m
  return (colormap === undefined ? rest : { ...rest, depthColormap: colormap }) as T
}

/**
 * The colormaps a (loaded or recorded) Cast Swap engine draws depth with on
 * request (`castSwap.depthColormaps`). Absent ⇒ an engine from before the
 * choice, which draws every source's default and whose make body strips an
 * unknown key: it is never sent one.
 */
export function engineDepthColormapsOf(cs: { readonly depthColormaps?: readonly FaceMaskingDepthColormap[] } | undefined): readonly FaceMaskingDepthColormap[] {
  return cs?.depthColormaps ?? []
}

/** Whether a (loaded or recorded) Cast Swap engine draws depth with `colormap` (`engineDepthColormapsOf`). */
export function engineDrawsDepthColormap(
  cs: { readonly depthColormaps?: readonly FaceMaskingDepthColormap[] } | undefined,
  colormap: FaceMaskingDepthColormap,
): boolean {
  return engineDepthColormapsOf(cs).includes(colormap)
}

/** Whether this process's Cast Swap engine draws depth with `colormap` (`engineDrawsDepthColormap` its declaration). */
export function loadedEngineDrawsDepthColormap(colormap: FaceMaskingDepthColormap): boolean {
  return engineDrawsDepthColormap(getPluginSupports().castSwap, colormap)
}

/**
 * The setting as an engine is sent it, colormap-wise: `depthColormap` only
 * when it changes what is drawn (`depthColormapSent`) AND the engine draws it
 * (`engineDrawsDepthColormap`); else no key at all, exactly the setting
 * before the choice existed (the source's default). A new object.
 */
export function withDepthColormapFor<T extends FaceMasking>(
  m: T,
  cs: { readonly depthColormaps?: readonly FaceMaskingDepthColormap[] } | undefined,
): T {
  const colormap = depthColormapSent(m)
  return withDepthColormapNormalised(m, colormap !== undefined && engineDrawsDepthColormap(cs, colormap) ? colormap : undefined)
}

/**
 * Whether the setting draws role outlines on its stored mask: on (not
 * "off"), Faces hidden, and `roleOutlines: true`. Absent and `false` are the
 * same (off), so neither is ever sent nor hashed.
 */
export function roleOutlinesOn(m: Pick<FaceMaskingWithMarks, "roleOutlines" | "source" | "mode"> | undefined): boolean {
  return !!m && m.mode !== "off" && m.roleOutlines === true && faceMaskingSourceOf(m) === "faces"
}

/**
 * Whether a (loaded or recorded) Cast Swap engine draws role outlines
 * (`castSwap.roleOutlines`): its stored face mask make takes
 * `faceMasking.roleOutlines` with `outlines`, answers what it drew, and its
 * run takes `storedFaceMask.outlines`. Absent ⇒ an engine from before them,
 * whose make strips the key (it would make a mask without the rings): it is
 * never sent one.
 */
export function engineDrawsRoleOutlines(cs: { readonly roleOutlines?: boolean } | undefined): boolean {
  return cs?.roleOutlines === true
}

/** Whether this process's Cast Swap engine draws role outlines (`engineDrawsRoleOutlines` its declaration). */
export function loadedEngineDrawsRoleOutlines(): boolean {
  return engineDrawsRoleOutlines(getPluginSupports().castSwap)
}

/** Whether this setting masks anything at all (absent or "off" = today's pipeline). */
export function faceMaskingOn(m: FaceMasking | undefined): m is FaceMasking {
  return !!m && m.mode !== "off"
}

/**
 * What this setting's mask covers, its default resolved: left out = the whole
 * head (faces) or the whole person (keep people). Null for full depth, which
 * masks no one.
 */
export function faceMaskTargetOf(m: Pick<FaceMasking, "target" | "source">): FaceMaskingTarget | null {
  const source = faceMaskingSourceOf(m)
  if (source === "full-depth") return null
  return m.target ?? (source === "keep-people" ? "body" : CAST_SWAP_FACE_MASKING_DEFAULTS.target)
}

/**
 * What a (loaded or recorded) Cast Swap engine's masks can cover. One that
 * predates the choice (`castSwap.faceMaskTargets` absent) masks heads alone,
 * as every 0.392.0 engine does, and drops a `target` it does not know (its
 * schema strips unknown keys), so a setting naming another target must be
 * held back rather than sent, or it would silently mask heads.
 */
export function faceMaskTargetsOf(
  cs: { readonly faceMaskTargets?: readonly FaceMaskingTarget[] } | undefined,
): readonly FaceMaskingTarget[] {
  return cs?.faceMaskTargets ?? [CAST_SWAP_FACE_MASKING_DEFAULTS.target]
}

/**
 * What a (loaded or recorded) Cast Swap engine can hide with faces hidden
 * (`source` `"faces"`): its `castSwap.faceMaskHideTargets`, else
 * `faceMaskTargetsOf` without `"body"`. An engine from before the
 * declaration listed `"body"` in `faceMaskTargets` for keep people while
 * refusing it with faces hidden, so that list alone cannot say it.
 */
export function faceMaskHideTargetsOf(
  cs: { readonly faceMaskTargets?: readonly FaceMaskingTarget[]; readonly faceMaskHideTargets?: readonly FaceMaskingTarget[] } | undefined,
): readonly FaceMaskingTarget[] {
  return cs?.faceMaskHideTargets ?? faceMaskTargetsOf(cs).filter((t) => t !== "body")
}

/** Whether an engine masks `target` under `source` (faces hidden: `faceMaskHideTargetsOf`; keep people: `faceMaskTargetsOf`). */
export function engineMasksTarget(
  cs: { readonly faceMaskTargets?: readonly FaceMaskingTarget[]; readonly faceMaskHideTargets?: readonly FaceMaskingTarget[] } | undefined,
  target: FaceMaskingTarget,
  source: FaceMaskingSource,
): boolean {
  return (source === "faces" ? faceMaskHideTargetsOf(cs) : faceMaskTargetsOf(cs)).includes(target)
}

/**
 * Whether the setting draws the face mesh: `faceMesh: true` with faces hidden
 * or full depth (keep people never draws it). Absent and `false` are the same
 * (off), so neither is ever sent nor hashed.
 */
export function faceMeshOn(m: Pick<FaceMasking, "faceMesh" | "source"> | undefined): boolean {
  return m?.faceMesh === true && faceMaskingSourceOf(m) !== "keep-people"
}

/**
 * The setting with `faceMesh` only when it is on (`faceMeshOn`): absent, or
 * `true`; never `false`, and never with keep people. A new object.
 */
export function withFaceMeshNormalised<T extends FaceMasking>(m: T): T {
  const { faceMesh: _faceMesh, ...rest } = m
  return (faceMeshOn(m) ? { ...rest, faceMesh: true } : rest) as T
}

/**
 * Whether a (loaded or recorded) Cast Swap engine draws the face mesh
 * (`castSwap.faceMesh`). Absent ⇒ an engine from before it, whose strict
 * schema refuses a `faceMesh` key: it is never sent one.
 */
export function engineDrawsFaceMesh(cs: { readonly faceMesh?: boolean } | undefined): boolean {
  return cs?.faceMesh === true
}

/** Whether this process's Cast Swap engine draws the face mesh (`engineDrawsFaceMesh` its declaration). */
export function loadedEngineDrawsFaceMesh(): boolean {
  return engineDrawsFaceMesh(getPluginSupports().castSwap)
}

/**
 * The setting as an engine that may not draw the face mesh is sent it: with
 * `faceMesh: true` only when the setting draws it AND `drawsFaceMesh`; else
 * no `faceMesh` key at all, exactly the setting before the mesh existed. A
 * new object.
 */
export function withFaceMeshFor<T extends FaceMasking>(m: T, drawsFaceMesh: boolean): T {
  const normalised = withFaceMeshNormalised(m)
  if (drawsFaceMesh || normalised.faceMesh === undefined) return normalised
  const { faceMesh: _faceMesh, ...rest } = normalised
  return rest as T
}

/** Whether this process's Cast Swap engine masks `target` under `source` (`engineMasksTarget` its declaration). */
export function loadedEngineMasksTarget(target: FaceMaskingTarget, source: FaceMaskingSource): boolean {
  return engineMasksTarget(getPluginSupports().castSwap, target, source)
}

/** The margins a face masking setting that leaves `zone` out gets (10 % at the left and right). */
export function defaultFaceMaskingZone(): Required<FaceMaskingZone> {
  return { ...CAST_SWAP_FACE_MASKING_DEFAULTS.zone }
}

/**
 * The setting with its zone resolved, as a run sends it: a zone left out
 * becomes the default margins; `null` becomes all four margins 0 (no margins,
 * spelt so an engine that predates `null` reads it the same); any zone given
 * stays as it is. So "no margins" is never read as "the default". The face
 * mesh is kept only when on (`withFaceMeshNormalised`: a `faceMesh: false`
 * is dropped, so it is sent and hashed exactly as a setting without it), and
 * the colormap only where it changes what is drawn (`depthColormapSent`). A
 * new object; the input is not changed.
 */
export function withResolvedZone(m: FaceMasking): FaceMasking {
  const mesh = withFaceMeshNormalised(m)
  const n = withDepthColormapNormalised(mesh, depthColormapSent(mesh))
  if (n.zone === undefined) return { ...n, zone: defaultFaceMaskingZone() }
  if (n.zone === null) return { ...n, zone: { leftPct: 0, rightPct: 0, topPct: 0, bottomPct: 0 } }
  return { ...n, zone: { ...n.zone } }
}

/**
 * The setting as the engine is sent it (a new object; marks are the caller's):
 *
 * - faces: `withResolvedZone`, with no `source` key — exactly what a run and
 *   a make sent before source modes existed;
 * - full depth: `{ mode, source }` only (nothing else applies), plus
 *   `faceMesh: true` when it draws the face mesh and `depthColormap` when
 *   it names one (`depthColormapSent`);
 * - keep people: `withResolvedZone` without `fill` (and never a face mesh),
 *   with `source` and the target resolved (`"body"` when left out), named so
 *   an engine never applies a default of its own.
 *
 * `faceMesh` only ever as `true` (`withFaceMeshNormalised`), so a setting
 * without the mesh is sent exactly as before it existed. Whether the engine
 * draws it is the caller's to check (`withFaceMeshFor`).
 */
export function faceMaskingSent(m: FaceMasking): FaceMasking {
  const source = faceMaskingSourceOf(m)
  // The colormap as the source draws it, read before `source` is dropped below (`depthColormapSent`).
  const colormap = depthColormapSent(m)
  const withColormap = colormap === undefined ? {} : { depthColormap: colormap }
  // The scene is a run's, never a make's or the key's (`faceMaskingRunSent`).
  const { source: _source, scene: _scene, ...rest } = m
  if (source === "faces") return withResolvedZone(rest)
  if (source === "full-depth") return { mode: m.mode, source, ...(faceMeshOn(m) ? { faceMesh: true } : {}), ...withColormap }
  const { fill: _fill, faceMesh: _faceMesh, depthColormap: _colormap, ...kept } = withResolvedZone(rest)
  return { ...kept, source, target: faceMaskTargetOf(m)!, ...withColormap }
}

/**
 * The setting as a RUN is sent it: `faceMaskingSent`, plus full depth's
 * `scene`, resolved (`"description"` when left out) so an engine never
 * applies a default of its own. The scene shapes the run, not the clip, so
 * the settings key and a make (both `faceMaskingSent`) never see it. A
 * caller sending to an engine that does not declare scenes drops it
 * (`withoutUnsupportedFields`, trends/run-helpers.ts).
 */
export function faceMaskingRunSent(m: FaceMasking): FaceMasking {
  const sent = faceMaskingSent(m)
  const scene = fullDepthSceneOf(m)
  return scene ? { ...sent, scene } : sent
}
