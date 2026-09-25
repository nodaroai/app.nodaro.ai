import type { MessageKey, TFunction } from "@/lib/i18n"
import type { VideoOverlayErrorCode, VideoOverlayIssue, VideoOverlayWarning, VideoOverlayWarningCode } from "@nodaro/shared"

/**
 * The canvas's words for the shared validator's codes and the worker's warning
 * codes (audit U7): the validator returns a CODE, never English, so the panel,
 * the node strip and the single-node Run toast all say the same thing in the
 * user's language. Exhaustive by type — a new code fails to compile here.
 */
const ERROR_KEYS: { readonly [C in VideoOverlayErrorCode]: MessageKey } = {
  no_layers: "proccfg.videoOverlay.err.no_layers",
  too_many_layers: "proccfg.videoOverlay.err.too_many_layers",
  incomplete_box: "proccfg.videoOverlay.err.incomplete_box",
  layer_without_image: "proccfg.videoOverlay.err.layer_without_image",
  time_out_of_range: "proccfg.videoOverlay.err.time_out_of_range",
  end_before_start: "proccfg.videoOverlay.err.end_before_start",
  fit_without_aspect: "proccfg.videoOverlay.err.fit_without_aspect",
  field_out_of_bounds: "proccfg.videoOverlay.err.field_out_of_bounds",
}

const WARNING_KEYS: { readonly [C in VideoOverlayWarningCode]: MessageKey } = {
  clipped: "proccfg.videoOverlay.warn.clipped",
  skipped: "proccfg.videoOverlay.warn.skipped",
  animated_first_frame: "proccfg.videoOverlay.warn.animated_first_frame",
  audio_reencoded: "proccfg.videoOverlay.warn.audio_reencoded",
}

export function videoOverlayErrorKey(code: VideoOverlayErrorCode): MessageKey {
  return ERROR_KEYS[code]
}

/** The 1-based layer number a message names: the canvas slot when known, else index + 1. */
function layerNumber(ref: { readonly layer?: number; readonly slot?: number }): number | undefined {
  return typeof ref.slot === "number" ? ref.slot : typeof ref.layer === "number" ? ref.layer + 1 : undefined
}

/** The layer-free text of a verdict ("End must be after start"). */
export function videoOverlayIssueMessage(issue: VideoOverlayIssue, t: TFunction): string {
  return t(ERROR_KEYS[issue.code], { ...issue.params })
}

/** A verdict as the canvas says it: "Layer 2: End must be after start". */
export function videoOverlayIssueText(issue: VideoOverlayIssue, t: TFunction): string {
  const text = videoOverlayIssueMessage(issue, t)
  const n = layerNumber(issue)
  return n === undefined ? text : t("proccfg.videoOverlay.layerPrefix", { n, text })
}

/** One warning of the last run, named by its layer number. */
export function videoOverlayWarningText(w: VideoOverlayWarning, t: TFunction): string {
  const n = layerNumber(w)
  return t(WARNING_KEYS[w.code], n === undefined ? {} : { n })
}
