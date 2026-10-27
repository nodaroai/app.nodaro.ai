/**
 * A full-depth trend's stored scene descriptions (pure; decided 2026-10-28).
 *
 * The depth clip carries no scene, so the make job (`POST /v1/cast-swap/face-mask`)
 * also describes the ORIGINAL clip once, in two texts: the whole clip
 * (`sceneDescription`) and the trend's 4 s preview window
 * (`previewSceneDescription`, only the roles in it). Approving stores both on
 * the face mask (`faceMask.sceneDescription`, `previewSceneDescription`,
 * server-owned); the admin may edit either. Each run then sends the stored
 * text with the window of the source it covers (`sceneDescription`,
 * `sceneDescriptionWindow`), and the engine rewrites it for the new cast and
 * the run's window in one text-and-images call instead of describing the
 * clip again.
 *
 * All of it is gated on the engine declaring `castSwap.storedSceneDescription`:
 * the make sends its `roles` and `previewStart` only then (the make route), and
 * a run's two keys are stripped for any other engine
 * (`withoutUnsupportedSceneDescription`, run-helpers.ts), which then gets
 * exactly the body it got before.
 */
import { faceMaskingSourceOf, fullDepthSceneOf, type FaceMasking } from "../../../lib/cast-swap-face-masking.js"
import { pickText } from "./localize.js"
import { PREVIEW_SECONDS, SCENE_DESCRIPTION_MAX } from "./schemas.js"
import type { TrendFaceMask, TrendSlotKind, TrendVersionData } from "./types.js"

/** Which stored description: a full run's (the whole clip) or a preview run's (the 4 s window). */
export type SceneDescriptionWhich = "full" | "preview"

/** The face mask field that holds `which`. */
export const SCENE_DESCRIPTION_FIELD = {
  full: "sceneDescription",
  preview: "previewSceneDescription",
} as const satisfies Record<SceneDescriptionWhich, keyof TrendFaceMask>

/** A stored description from an engine's output: a string, trimmed and capped; anything else (or empty) is none. */
export function sceneDescriptionText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value.trim().slice(0, SCENE_DESCRIPTION_MAX).trim()
  return text.length > 0 ? text : undefined
}

/**
 * The descriptions a full-depth make's completion carries, ready to store on
 * the face mask (absent ones left out), with the `previewStart` the preview's
 * text was made for: the make's recorded input (`input.previewStart`), kept
 * only beside a preview text.
 */
export function sceneDescriptionsOf(
  output: Record<string, unknown>,
  input: Record<string, unknown> = {},
): Pick<TrendFaceMask, "sceneDescription" | "previewSceneDescription" | "previewSceneDescriptionStart"> {
  const full = sceneDescriptionText(output.sceneDescription)
  const preview = sceneDescriptionText(output.previewSceneDescription)
  const start = input.previewStart
  const madeFor = typeof start === "number" && Number.isFinite(start) && start >= 0 ? start : undefined
  return {
    ...(full ? { sceneDescription: full } : {}),
    ...(preview ? { previewSceneDescription: preview, ...(madeFor !== undefined ? { previewSceneDescriptionStart: madeFor } : {}) } : {}),
  }
}

/** Whether the stored preview text was made for the trend's current `previewStart` (else a preview run cuts the full text). */
export function previewSceneDescriptionCurrent(data: Pick<TrendVersionData, "faceMask" | "previewStart">): boolean {
  const fm = data.faceMask
  return !!fm?.previewSceneDescription && data.previewStart !== null && fm.previewSceneDescriptionStart === data.previewStart
}

/** A role as the make names it to the describer: its hidden role name (else its English label) and its kind. */
export interface SceneMakeRole {
  name: string
  kind: TrendSlotKind
}

/**
 * What a full-depth make adds for the describer on an engine that declares
 * `castSwap.storedSceneDescription`: the trend's roles (in slot order) and its
 * `previewStart` (left out when the trend has no preview). Slots carry no
 * in-preview flag, so a role's `inPreview` is never sent.
 */
export function sceneMakeFields(data: Pick<TrendVersionData, "slots" | "previewStart">): { roles: SceneMakeRole[]; previewStart?: number } {
  const roles = data.slots.map((slot) => ({ name: slot.roleName || pickText(slot.label, "en") || slot.key, kind: slot.kind }))
  return { roles, ...(data.previewStart !== null ? { previewStart: data.previewStart } : {}) }
}

/** The window of the SOURCE clip a stored description covers (seconds). */
export interface SceneDescriptionWindow {
  fromSec: number
  toSec: number
}

/**
 * What a run sends of the stored description, or undefined: only a full-depth
 * run whose scene comes from a description (the default), on the trend's
 * stored clip. A preview run sends its window (`previewStart` to
 * `previewStart` + 4 s, held to the clip) with the preview's text while it was
 * made for this very start (`previewSceneDescriptionCurrent`), else — the
 * start moved, or there is no preview text — the whole clip's text, which the
 * engine cuts to the window and re-times. A full run sends the whole clip's
 * text with `0` to the clip's length. No text at all (a clip made before
 * descriptions existed) sends nothing: the engine then describes the clip
 * itself, as before.
 */
export function storedSceneDescriptionFor(
  data: Pick<TrendVersionData, "faceMask" | "source" | "previewStart">,
  masking: FaceMasking | undefined,
  preview: boolean,
): { sceneDescription: string; sceneDescriptionWindow: SceneDescriptionWindow } | undefined {
  if (!masking || faceMaskingSourceOf(masking) !== "full-depth" || fullDepthSceneOf(masking) !== "description") return undefined
  if (!data.source || !data.faceMask) return undefined
  const durationSec = data.source.durationSec
  if (preview) {
    if (data.previewStart === null) return undefined
    const text = previewSceneDescriptionCurrent(data) ? data.faceMask.previewSceneDescription : data.faceMask.sceneDescription
    if (!text) return undefined
    return { sceneDescription: text, sceneDescriptionWindow: { fromSec: data.previewStart, toSec: Math.min(durationSec, data.previewStart + PREVIEW_SECONDS) } }
  }
  const text = data.faceMask.sceneDescription
  return text ? { sceneDescription: text, sceneDescriptionWindow: { fromSec: 0, toSec: durationSec } } : undefined
}
