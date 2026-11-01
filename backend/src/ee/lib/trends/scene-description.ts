/**
 * A full-depth trend's stored scene descriptions (pure; decided 2026-10-28).
 *
 * The depth clip carries no scene, so the make job (`POST /v1/cast-swap/face-mask`)
 * also describes the ORIGINAL clip once: the whole clip (`sceneDescription`).
 * Approving stores it on the face mask (`faceMask.sceneDescription`,
 * server-owned); the admin may edit it. Each run then sends the stored text
 * with the window of the source it covers (`sceneDescription`,
 * `sceneDescriptionWindow`), and the engine rewrites it for the new cast and
 * the run's window in one text-and-images call instead of describing the
 * clip again.
 *
 * One text for every run (decided 2026-11-01): a preview run sends the whole
 * clip's text too, with the whole clip's window, and the engine cuts it to
 * the 4 s it runs and re-times it. The make is no longer asked for a preview text of its own (no
 * `previewStart`: one call fewer per make); a preview text an older make
 * stored (`previewSceneDescription`) stays in storage, never sent or shown.
 *
 * All of it is gated on the engine declaring `castSwap.storedSceneDescription`:
 * the make sends its `roles` only then (the make route), and
 * a run's two keys are stripped for any other engine
 * (`withoutUnsupportedSceneDescription`, run-helpers.ts), which then gets
 * exactly the body it got before.
 */
import { faceMaskingSourceOf, fullDepthSceneOf, type FaceMasking } from "../../../lib/cast-swap-face-masking.js"
import { fullDepthSceneDescribes } from "@nodaro/render-rules"
import { pickText } from "./localize.js"
import { SCENE_DESCRIPTION_MAX } from "./schemas.js"
import type { TrendFaceMask, TrendSlotKind, TrendVersionData } from "./types.js"

/** Which stored description the admin edits: the whole clip's, the one every run sends. */
export type SceneDescriptionWhich = "full"

/** The face mask field that holds `which`. */
export const SCENE_DESCRIPTION_FIELD = {
  full: "sceneDescription",
} as const satisfies Record<SceneDescriptionWhich, keyof TrendFaceMask>

/** A stored description from an engine's output: a string, trimmed and capped; anything else (or empty) is none. */
export function sceneDescriptionText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value.trim().slice(0, SCENE_DESCRIPTION_MAX).trim()
  return text.length > 0 ? text : undefined
}

/**
 * The description a full-depth make's completion carries, ready to store on
 * the face mask (left out when absent): the whole clip's. A preview text an
 * older make answered with (`previewSceneDescription`) is not stored: no run
 * sends one.
 */
export function sceneDescriptionsOf(output: Record<string, unknown>): Pick<TrendFaceMask, "sceneDescription"> {
  const full = sceneDescriptionText(output.sceneDescription)
  return full ? { sceneDescription: full } : {}
}

/** A role as the make names it to the describer: its hidden role name (else its English label) and its kind. */
export interface SceneMakeRole {
  name: string
  kind: TrendSlotKind
}

/**
 * What a full-depth make adds for the describer on an engine that declares
 * `castSwap.storedSceneDescription`: the trend's roles (in slot order). Never
 * the trend's `previewStart`: the engine's make reads it only to describe the
 * preview window too, and a preview run cuts the whole clip's text instead.
 * Slots carry no in-preview flag, so a role's `inPreview` is never sent.
 */
export function sceneMakeFields(data: Pick<TrendVersionData, "slots">): { roles: SceneMakeRole[] } {
  return { roles: data.slots.map((slot) => ({ name: slot.roleName || pickText(slot.label, "en") || slot.key, kind: slot.kind })) }
}

/** The window of the SOURCE clip a stored description covers (seconds). */
export interface SceneDescriptionWindow {
  fromSec: number
  toSec: number
}

/**
 * What a run sends of the stored description, or undefined: only a full-depth
 * run whose scene comes from a description (the default), on the trend's
 * stored clip. Every run sends the whole clip's text with the stretch it
 * really covers, `0` to the clip's length; a preview run too (a trend with a
 * preview), and the engine cuts the text to the 4 s it runs (its own window,
 * `previewStart` + 4 s, or a prepared preview's `sourceAsset.startSec`) and
 * re-times it. Sending the text's own window, never the preview's, makes the
 * engine cut it for every clip length: given the preview's window, it takes a
 * text whose shots end within 1.5 s past 4 s (a clip of about 5 s) as cut
 * already. A stored preview text is never sent. No text at all (a clip made
 * before descriptions existed) sends nothing: the engine then describes the
 * clip itself, as before.
 */
export function storedSceneDescriptionFor(
  data: Pick<TrendVersionData, "faceMask" | "source" | "previewStart">,
  masking: FaceMasking | undefined,
  preview: boolean,
): { sceneDescription: string; sceneDescriptionWindow: SceneDescriptionWindow } | undefined {
  if (!masking || faceMaskingSourceOf(masking) !== "full-depth" || !fullDepthSceneDescribes(fullDepthSceneOf(masking) ?? undefined)) return undefined
  if (!data.source || !data.faceMask) return undefined
  if (preview && data.previewStart === null) return undefined
  const text = data.faceMask.sceneDescription
  return text ? { sceneDescription: text, sceneDescriptionWindow: { fromSec: 0, toSec: data.source.durationSec } } : undefined
}

