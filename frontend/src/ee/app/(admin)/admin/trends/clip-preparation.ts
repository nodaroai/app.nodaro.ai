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
import type { AdminTrendFaceMasking, AdminTrendFaceMaskingSource, AdminTrendFaceMaskingTarget, TrendEngineEnvironment } from "@/lib/api"

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
  // The scene source is Full depth's alone.
  if (source !== "full-depth") delete next.scene
  // The face mesh is never Keep people's; role outlines are Faces hidden's alone.
  if (source === "keep-people") delete next.faceMesh
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
