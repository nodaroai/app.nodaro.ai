/**
 * A trend's clip preparation (pure): how its source clip is made ready before
 * the video model sees it (`faceMasking.source`, the server's
 * backend/src/lib/cast-swap-face-masking.ts rules).
 *
 * - Faces hidden (`"faces"`, also when left out): today's face mask, with
 *   every setting of its own; it covers the head by default, or the face, or
 *   the whole person ("body": everyone hidden under the fill).
 * - Full depth: the whole clip becomes one depth video. Only `mode` applies,
 *   and it is always "always" (made once, approved, stored).
 * - Keep people: the people stay as filmed and the rest becomes depth. Every
 *   setting but the fill applies; the mask covers the whole person by default
 *   ("body", its own target), and a box may mark the main character.
 *
 * The server refuses a depth mode without "always", the whole-person target
 * with Full depth, a main character box outside Keep people and the face mesh
 * with Keep people: switching modes here never leaves the draft in one of
 * those states.
 */
import { CAST_SWAP_FACE_MASKING_DEFAULTS } from "@nodaro/shared/models"
import { VIDEO_DEPTH_MODEL_SIZES, resolveVideoDepthModelSize, videoDepthColormaps, type VideoDepthColormap, type VideoDepthModelSize } from "@nodaro/shared/media"
import type { AdminFaceMeshParts, AdminTrendFaceMasking, AdminTrendFaceMaskingSource, AdminTrendFaceMaskingTarget, TrendEngineEnvironment } from "@/lib/api"

export const CLIP_PREPARATIONS: ReadonlyArray<{ value: AdminTrendFaceMaskingSource; label: string; hint: string }> = [
  {
    value: "faces",
    label: "Faces hidden",
    hint: "The faces in the clip are covered before the video model sees it (the settings below).",
  },
  {
    value: "full-depth",
    label: "Full depth",
    hint: "The whole clip becomes one depth video the model follows for the movement; the looks come from the slots' pictures. Made once, approved and stored: every run uses it.",
  },
  {
    value: "keep-people",
    label: "Keep people",
    hint: "The people stay as filmed and the rest of the frame becomes depth. Made once, approved and stored: every run uses it.",
  },
]

/** The admin's name for a clip preparation. */
export function clipPreparationName(source: string): string {
  return CLIP_PREPARATIONS.find((c) => c.value === source)?.label ?? source
}

/** How the setting prepares the clip; left out = Faces hidden. */
export function clipPreparationOf(m: Pick<AdminTrendFaceMasking, "source"> | undefined): AdminTrendFaceMaskingSource {
  return m?.source ?? "faces"
}

/** Full depth and Keep people: the clip is made once in depth, approved and stored. */
export function isDepthPreparation(source: AdminTrendFaceMaskingSource): boolean {
  return source !== "faces"
}

/** What the mask covers when the target is left out: the whole person in Keep people, else the head. */
export function defaultTargetFor(source: AdminTrendFaceMaskingSource): AdminTrendFaceMaskingTarget {
  return source === "keep-people" ? "body" : "head"
}

/**
 * The targets some environment's engine masks under `source` (unknown while
 * the environments are: undefined). Faces hidden reads
 * `faceMaskHideTargets` (absent: `faceMaskTargets` without "body", an engine
 * that kept whole people but could not hide them); Keep people reads
 * `faceMaskTargets` (absent: the head alone).
 */
export function supportedTargetsFor(
  envs: readonly TrendEngineEnvironment[] | undefined,
  source: AdminTrendFaceMaskingSource,
): AdminTrendFaceMaskingTarget[] | undefined {
  if (!envs) return undefined
  return [
    ...new Set(
      envs.flatMap((e) => {
        const cs = e.supports.castSwap
        const all = cs?.faceMaskTargets ?? (["head"] as AdminTrendFaceMaskingTarget[])
        return source === "faces" ? (cs?.faceMaskHideTargets ?? all.filter((t) => t !== "body")) : all
      }),
    ),
  ]
}

/**
 * The environments every Nodaro Motion setting is shared by (the server's
 * publish environments: one database, one settings row).
 */
export const SHARED_SETTING_ENVIRONMENTS = ["staging", "production"] as const

/**
 * Admin → Nodaro Motion: the environments (of `SHARED_SETTING_ENVIRONMENTS`,
 * in that order) whose engine cannot hide whole people with faces hidden —
 * none recorded, or one whose `faceMaskHideTargets` lacks "body" (absent:
 * `faceMaskTargets` without "body"). Unknown while the environments are
 * (undefined). The setting is shared, so Body is offered only when this is
 * empty; the server refuses the save otherwise (409 `engine_unsupported`).
 */
export function environmentsThatCannotHideBodies(envs: readonly TrendEngineEnvironment[] | undefined): string[] | undefined {
  if (!envs) return undefined
  return SHARED_SETTING_ENVIRONMENTS.filter((name) => {
    const env = envs.find((e) => e.env === name)
    return !env || !(supportedTargetsFor([env], "faces") ?? []).includes("body")
  })
}

/**
 * Admin → Nodaro Motion: the environments (of `SHARED_SETTING_ENVIRONMENTS`,
 * in that order) whose engine cannot draw the face mesh — none recorded, or
 * one that does not declare `castSwap.faceMesh`. Unknown while the
 * environments are (undefined). The setting is shared, so the switch is
 * offered only when this is empty; the server refuses the save otherwise
 * (409 `engine_unsupported`).
 */
export function environmentsThatCannotDrawFaceMesh(envs: readonly TrendEngineEnvironment[] | undefined): string[] | undefined {
  if (!envs) return undefined
  return SHARED_SETTING_ENVIRONMENTS.filter((name) => envs.find((e) => e.env === name)?.supports.castSwap?.faceMesh !== true)
}

/**
 * The environments (of `SHARED_SETTING_ENVIRONMENTS`, in that order) whose
 * engine cannot take the preparation steps — none recorded, or one that does
 * not declare `castSwap.steps`. Unknown while the environments are
 * (undefined). The step editors are offered only when this is empty: Admin →
 * Nodaro Motion's setting is shared (the server refuses the save otherwise,
 * 409 `engine_unsupported`), and a trend that sets steps can't be published
 * to an environment that lacks them.
 */
export function environmentsThatCannotTakeSteps(envs: readonly TrendEngineEnvironment[] | undefined): string[] | undefined {
  if (!envs) return undefined
  return SHARED_SETTING_ENVIRONMENTS.filter((name) => envs.find((e) => e.env === name)?.supports.castSwap?.steps !== true)
}

/**
 * Admin → Nodaro Motion: the environments (of `SHARED_SETTING_ENVIRONMENTS`,
 * in that order) whose engine cannot enforce a forced Style — none recorded,
 * or one that does not declare `castSwap.styleChoice`. Unknown while the
 * environments are (undefined). "Always Precise" and "Always Flex" are
 * offered only when this is empty (the setting is shared: the server refuses
 * the save otherwise, 409 `engine_unsupported`); "Users choose" always is.
 */
export function environmentsThatCannotForceStyle(envs: readonly TrendEngineEnvironment[] | undefined): string[] | undefined {
  if (!envs) return undefined
  return SHARED_SETTING_ENVIRONMENTS.filter((name) => envs.find((e) => e.env === name)?.supports.castSwap?.styleChoice !== true)
}

/**
 * The environments (of `SHARED_SETTING_ENVIRONMENTS`, in that order) whose
 * engine cannot take "Body from the clip" (`steps.clipBody`) — none
 * recorded, or one that does not declare `castSwap.steps` and
 * `castSwap.clipBodySheet`. Unknown while the environments are (undefined).
 * Off is safe everywhere (an engine without the step has it stripped); a
 * prompt of its own is offered only when this is empty: the server refuses
 * the shared setting otherwise, and a trend that sets one can't be published
 * there.
 */
export function environmentsThatCannotTakeClipBody(envs: readonly TrendEngineEnvironment[] | undefined): string[] | undefined {
  if (!envs) return undefined
  return SHARED_SETTING_ENVIRONMENTS.filter((name) => {
    const cs = envs.find((e) => e.env === name)?.supports.castSwap
    return cs?.steps !== true || cs.clipBodySheet !== true
  })
}

/**
 * The environments (of `SHARED_SETTING_ENVIRONMENTS`, in that order) whose
 * engine cannot take the shot list (`steps.shotList`; and so does not run
 * Flex as Full depth with a shot list) — none recorded, or one that does not
 * declare `castSwap.steps` and `castSwap.shotList`. Unknown while the
 * environments are (undefined). The defaults (Precise off, Flex on) are safe
 * everywhere; anything else is offered only when this is empty.
 */
export function environmentsThatCannotTakeShotList(envs: readonly TrendEngineEnvironment[] | undefined): string[] | undefined {
  if (!envs) return undefined
  return SHARED_SETTING_ENVIRONMENTS.filter((name) => {
    const cs = envs.find((e) => e.env === name)?.supports.castSwap
    return cs?.steps !== true || cs.shotList !== true
  })
}

/**
 * The environments (of `SHARED_SETTING_ENVIRONMENTS`, in that order) whose
 * engine cannot take "Style the role pictures" (`steps.styleRefs`) — none
 * recorded, or one that does not declare `castSwap.steps` and
 * `castSwap.styleRefs`. Unknown while the environments are (undefined). Off,
 * its default, is safe everywhere; On is offered only when this is empty.
 */
export function environmentsThatCannotTakeStyleRefs(envs: readonly TrendEngineEnvironment[] | undefined): string[] | undefined {
  if (!envs) return undefined
  return SHARED_SETTING_ENVIRONMENTS.filter((name) => {
    const cs = envs.find((e) => e.env === name)?.supports.castSwap
    return cs?.steps !== true || cs.styleRefs !== true
  })
}

/** The environments (of `SHARED_SETTING_ENVIRONMENTS`, in that order) whose engine runs "Body from the clip"; unknown while the environments are. */
export function environmentsThatTakeClipBody(envs: readonly TrendEngineEnvironment[] | undefined): string[] | undefined {
  const missing = environmentsThatCannotTakeClipBody(envs)
  return missing && SHARED_SETTING_ENVIRONMENTS.filter((name) => !missing.includes(name))
}

/**
 * Whether the setting draws role outlines: masking on (not "off"), Faces
 * hidden, and `roleOutlines: true` (the server's `roleOutlinesOn`).
 */
export function roleOutlinesOn(m: AdminTrendFaceMasking | undefined): boolean {
  return !!m && m.mode !== "off" && m.roleOutlines === true && clipPreparationOf(m) === "faces"
}

/** A trend's editor: whether some environment's engine draws role outlines (unknown while the environments are: false). */
export function someEngineDrawsRoleOutlines(envs: readonly TrendEngineEnvironment[] | undefined): boolean {
  return (envs ?? []).some((e) => e.supports.castSwap?.roleOutlines === true)
}

/**
 * The depth colormaps a setting may name: what Nodaro Motion's depth provider
 * offers (`videoDepthColormaps("video-depth-anything")`), in display order.
 */
export const DEPTH_COLORMAPS: readonly VideoDepthColormap[] = videoDepthColormaps("video-depth-anything")

/**
 * Whether the setting draws depth, where a colormap applies: Full depth, Keep
 * people, or Faces hidden with the depth fill (a fill left out is the blur).
 * The server's `depthColormapApplies`.
 */
export function depthColormapApplies(m: Pick<AdminTrendFaceMasking, "source" | "fill"> | undefined): boolean {
  return clipPreparationOf(m) !== "faces" || (m?.fill ?? CAST_SWAP_FACE_MASKING_DEFAULTS.fill) === "depth"
}

/** The colormap a clip preparation draws its depth with when the setting names none: turbo for a depth fill, else grayscale. */
export function depthColormapDefaultFor(source: AdminTrendFaceMaskingSource): VideoDepthColormap {
  return source === "faces" ? "turbo" : "grayscale"
}

/** Whether role outlines draw the setting's depth fill gray (on, with Faces hidden's depth fill): no colormap applies then. */
export function depthColormapForcedGray(m: AdminTrendFaceMasking | undefined): boolean {
  return roleOutlinesOn(m) && depthColormapApplies(m)
}

/**
 * The colormap the setting saves (the server's `depthColormapSent`): the one
 * it names, only where it draws depth, when it is not the source's default,
 * and not under role outlines; else undefined (no key).
 */
export function depthColormapSaved(m: AdminTrendFaceMasking | undefined): VideoDepthColormap | undefined {
  const c = m?.depthColormap
  if (!m || c === undefined || !depthColormapApplies(m) || depthColormapForcedGray(m)) return undefined
  return c === depthColormapDefaultFor(clipPreparationOf(m)) ? undefined : c
}

/** A trend's editor: the colormaps some environment's engine draws (`castSwap.depthColormaps`; unknown while the environments are: none). */
export function depthColormapsSomeEngineDraws(envs: readonly TrendEngineEnvironment[] | undefined): VideoDepthColormap[] {
  return DEPTH_COLORMAPS.filter((c) => (envs ?? []).some((e) => (e.supports.castSwap?.depthColormaps ?? []).includes(c)))
}

/**
 * Admin → Nodaro Motion: for each colormap, the environments (of
 * `SHARED_SETTING_ENVIRONMENTS`, in that order) whose engine cannot draw it —
 * none recorded, or one whose `castSwap.depthColormaps` lacks it. Unknown
 * while the environments are (undefined). The setting is shared, so a map is
 * offered only when its list is empty; the server refuses the save otherwise
 * (409 `engine_unsupported`).
 */
export function environmentsThatCannotDrawColormaps(
  envs: readonly TrendEngineEnvironment[] | undefined,
): Readonly<Record<VideoDepthColormap, string[]>> | undefined {
  if (!envs) return undefined
  return Object.fromEntries(
    DEPTH_COLORMAPS.map((c) => [
      c,
      SHARED_SETTING_ENVIRONMENTS.filter((name) => !(envs.find((e) => e.env === name)?.supports.castSwap?.depthColormaps ?? []).includes(c)),
    ]),
  ) as Record<VideoDepthColormap, string[]>
}

/** The depth model sizes a setting may name: the Video Depth node's (`VIDEO_DEPTH_MODEL_SIZES`), in display order. */
export const DEPTH_MODEL_SIZES: readonly VideoDepthModelSize[] = VIDEO_DEPTH_MODEL_SIZES

/** The depth model size a setting that names none draws with (what every make and run drew with before the choice). */
export const DEPTH_MODEL_SIZE_DEFAULT: VideoDepthModelSize = "large"

/**
 * The depth model size the setting saves (the server's `depthModelSizeSent`):
 * the one it names, only where it draws depth (`depthColormapApplies`; role
 * outlines or not), when it is not large (an unknown value reads as large);
 * else undefined (no key).
 */
export function depthModelSizeSaved(m: AdminTrendFaceMasking | undefined): VideoDepthModelSize | undefined {
  if (!m || m.depthModelSize === undefined || !depthColormapApplies(m)) return undefined
  const size = resolveVideoDepthModelSize(m.depthModelSize)
  return size === DEPTH_MODEL_SIZE_DEFAULT ? undefined : size
}

/** A trend's editor: the model sizes some environment's engine draws depth with (`castSwap.depthModelSizes`; unknown while the environments are: none). */
export function depthModelSizesSomeEngineDraws(envs: readonly TrendEngineEnvironment[] | undefined): VideoDepthModelSize[] {
  return DEPTH_MODEL_SIZES.filter((s) => (envs ?? []).some((e) => (e.supports.castSwap?.depthModelSizes ?? []).includes(s)))
}

/**
 * Admin → Nodaro Motion: for each model size, the environments (of
 * `SHARED_SETTING_ENVIRONMENTS`, in that order) whose engine cannot draw with
 * it — none recorded, or one whose `castSwap.depthModelSizes` lacks it.
 * Unknown while the environments are (undefined). The setting is shared, so a
 * size is offered only when its list is empty; the server refuses the save
 * otherwise (409 `engine_unsupported`).
 */
export function environmentsThatCannotDrawModelSizes(
  envs: readonly TrendEngineEnvironment[] | undefined,
): Readonly<Record<VideoDepthModelSize, string[]>> | undefined {
  if (!envs) return undefined
  return Object.fromEntries(
    DEPTH_MODEL_SIZES.map((size) => [
      size,
      SHARED_SETTING_ENVIRONMENTS.filter((name) => !(envs.find((e) => e.env === name)?.supports.castSwap?.depthModelSizes ?? []).includes(size)),
    ]),
  ) as Record<VideoDepthModelSize, string[]>
}

/**
 * Admin → Nodaro Motion: the environments (of `SHARED_SETTING_ENVIRONMENTS`,
 * in that order) whose engine cannot blur a full-depth map — none recorded,
 * or one that does not declare `castSwap.depthBlur` (a Cast Swap engine
 * before 0.430.0). Unknown while the environments are (undefined). The
 * setting is shared, so a blur above 0 is saved only when this is empty (the
 * server refuses the save otherwise, 409 `engine_unsupported`).
 */
export function environmentsThatCannotBlurDepth(envs: readonly TrendEngineEnvironment[] | undefined): string[] | undefined {
  if (!envs) return undefined
  return SHARED_SETTING_ENVIRONMENTS.filter((name) => envs.find((e) => e.env === name)?.supports.castSwap?.depthBlur !== true)
}

/**
 * Admin → Nodaro Motion: the environments (of `SHARED_SETTING_ENVIRONMENTS`,
 * in that order) whose engine cannot blur a Faces hidden depth fill — none
 * recorded, or one that does not declare `castSwap.depthFillBlur` (apart from
 * Full depth's `castSwap.depthBlur`). Unknown while the environments are
 * (undefined). A blur above 0 on a depth fill is saved only when this is
 * empty (the server refuses the save otherwise, 409 `engine_unsupported`).
 */
export function environmentsThatCannotBlurDepthFill(envs: readonly TrendEngineEnvironment[] | undefined): string[] | undefined {
  if (!envs) return undefined
  return SHARED_SETTING_ENVIRONMENTS.filter((name) => envs.find((e) => e.env === name)?.supports.castSwap?.depthFillBlur !== true)
}

/**
 * Admin → Nodaro Motion: the environments (of `SHARED_SETTING_ENVIRONMENTS`,
 * in that order) whose engine cannot keep the faces as filmed with only the
 * face mesh (the fill "none") — none recorded, or one that does not declare
 * `castSwap.maskFillNone`, or does not draw the face mesh it needs
 * (`castSwap.faceMesh`). Unknown while the environments are (undefined).
 * "None" is offered only when this is empty (the server refuses the save
 * otherwise, 409 `engine_unsupported`).
 */
export function environmentsThatCannotFillNone(envs: readonly TrendEngineEnvironment[] | undefined): string[] | undefined {
  if (!envs) return undefined
  return SHARED_SETTING_ENVIRONMENTS.filter((name) => {
    const cs = envs.find((e) => e.env === name)?.supports.castSwap
    return cs?.maskFillNone !== true || cs.faceMesh !== true
  })
}

/**
 * Which depth a depth blur would blur (the server's `depthBlurKindOf`): Full
 * depth's map, a Faces hidden depth fill, or none (null: a blur fill, the
 * fill "none", Keep people).
 */
export function depthBlurKindOf(m: Pick<AdminTrendFaceMasking, "source" | "fill"> | undefined): "full-depth" | "depth-fill" | null {
  const source = clipPreparationOf(m)
  if (source === "full-depth") return "full-depth"
  return source === "faces" && (m?.fill ?? CAST_SWAP_FACE_MASKING_DEFAULTS.fill) === "depth" ? "depth-fill" : null
}

/** The face mesh's parts other than the full mesh, in display order. */
export const FACE_MESH_PARTIAL = ["features", "mouth"] as const satisfies readonly AdminFaceMeshParts[]

/**
 * Admin → Nodaro Motion: for each face mesh part other than the full mesh,
 * the environments (of `SHARED_SETTING_ENVIRONMENTS`, in that order) whose
 * engine cannot draw it — none recorded, or one whose `castSwap.faceMeshParts`
 * lacks it (a Cast Swap engine before 0.430.0). Unknown while the environments
 * are (undefined). A part is offered only while its list is empty (the server
 * refuses the save otherwise, 409 `engine_unsupported`).
 */
export function environmentsThatCannotDrawFaceMeshParts(
  envs: readonly TrendEngineEnvironment[] | undefined,
): Readonly<Record<(typeof FACE_MESH_PARTIAL)[number], string[]>> | undefined {
  if (!envs) return undefined
  return Object.fromEntries(
    FACE_MESH_PARTIAL.map((p) => [
      p,
      SHARED_SETTING_ENVIRONMENTS.filter((name) => !(envs.find((e) => e.env === name)?.supports.castSwap?.faceMeshParts ?? []).includes(p)),
    ]),
  ) as Record<(typeof FACE_MESH_PARTIAL)[number], string[]>
}

/** A trend's editor: whether some environment's engine draws the face mesh (unknown while the environments are: false). */
export function someEngineDrawsFaceMesh(envs: readonly TrendEngineEnvironment[] | undefined): boolean {
  return (envs ?? []).some((e) => e.supports.castSwap?.faceMesh === true)
}

/**
 * The setting prepared another way (a new object; undefined stays undefined
 * for Faces hidden, the default). A depth mode is mode "always". Leaving Keep
 * people drops what only it takes: its whole-person target (kept there, it
 * would be HIDDEN with Faces hidden), and the main character boxes
 * (`removedMain` counts them, for the screen to say so). Full depth drops the
 * whole person too (it masks no one). Keep people drops the face mesh (the
 * faces stay as filmed there: nothing to draw on).
 */
export function withClipPreparation(
  m: AdminTrendFaceMasking | undefined,
  source: AdminTrendFaceMaskingSource,
): { masking: AdminTrendFaceMasking | undefined; removedMain: number } {
  if (!m && source === "faces") return { masking: undefined, removedMain: 0 }
  const { source: _was, ...rest } = m ?? { mode: "always" as const }
  const next: AdminTrendFaceMasking = isDepthPreparation(source) ? { ...rest, mode: "always", source } : { ...rest }
  // The scene source is Full depth's alone; so is the depth blur.
  if (source !== "full-depth") {
    delete next.scene
    delete next.depthBlur
  }
  // The face mesh (and what it draws) is never Keep people's; role outlines are Faces hidden's alone.
  if (source === "keep-people") {
    delete next.faceMesh
    delete next.faceMeshParts
  }
  if (source !== "faces") delete next.roleOutlines
  let removedMain = 0
  if (next.target === "body" && (source === "full-depth" || (source === "faces" && clipPreparationOf(m) === "keep-people"))) delete next.target
  if (source !== "keep-people") {
    if (next.marks) {
      const kept = next.marks.filter((mark) => mark.label !== "main")
      removedMain = next.marks.length - kept.length
      if (kept.length > 0) next.marks = kept
      else delete next.marks
    }
  }
  return { masking: next, removedMain }
}

/** What the server would refuse in the clip preparation, as sentences (Save is held on any). */
export function clipPreparationIssues(m: AdminTrendFaceMasking): string[] {
  const out: string[] = []
  const source = clipPreparationOf(m)
  if (isDepthPreparation(source) && m.mode !== "always") out.push(`Clip preparation: ${clipPreparationName(source)} runs every time (mode Always).`)
  if (source === "full-depth" && m.target === "body") out.push("Clip preparation: Full depth masks no one, so it has no whole-person target.")
  if (source === "keep-people" && m.faceMesh === true) out.push("Clip preparation: Keep people keeps the faces as filmed, so it takes no face mesh.")
  if (source !== "faces" && m.roleOutlines === true) out.push("Clip preparation: role outlines are drawn around hidden people, so they need Faces hidden.")
  const main = (m.marks ?? []).filter((mark) => mark.label === "main").length
  if (source !== "keep-people" && main > 0) {
    out.push(`Face masking: ${main} box${main === 1 ? " marks" : "es mark"} the main character, which only Keep people takes. Remove ${main === 1 ? "it" : "them"} first (6. Face masking).`)
  }
  return out
}
