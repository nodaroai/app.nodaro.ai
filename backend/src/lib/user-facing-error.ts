import { LlmAdvancedModeUnavailableError, LlmLaneError, LlmStreamResponseError } from "./llm-errors.js"
import { BOX_SHORTAGE_MESSAGE, causedByResourceShortage } from "../providers/video/ffmpeg-shortage-retry.js"

/**
 * The message a person sees for a failed job or request.
 *
 * An error from a model's serving lane (`LlmLaneError`, or the usage-carrying
 * `LlmStreamResponseError` family) carries a `userMessage` that names no lane,
 * vendor or internal model id — its `message` is the full diagnostic, which
 * logs and the private plugins' retry classifier still read, and which the
 * job keeps in `error_detail`. It is found anywhere on the `cause` chain, so a
 * caller that wraps it does not leak the diagnostic. A failure the server's
 * own passing shortage caused (a program it could not start, a thread it could
 * not create — marked by the runners, `ffmpeg-shortage-retry.ts`) reads as the
 * server being busy, never as the program's words for it ("spawn ffmpeg
 * EAGAIN", "Error while opening encoder — maybe incorrect parameters"), which
 * send a person looking for a fault in their own file. Any other error's own
 * message stands: provider classes such as `KieError` are already sanitized
 * where they are thrown.
 */
export function userFacingMessage(err: unknown, fallback: string): string {
  return laneUserMessage(err) ?? (causedByResourceShortage(err) ? BOX_SHORTAGE_MESSAGE : undefined) ?? (err instanceof Error ? err.message : fallback)
}

/**
 * Only the model-lane sentence: the `userMessage` of an `LlmLaneError` /
 * `LlmStreamResponseError` anywhere on the `cause` chain, or undefined when
 * there is none. For an answer that must otherwise keep its own fixed
 * sentence rather than pass another error's message through.
 */
export function laneUserMessage(err: unknown): string | undefined {
  let cur: unknown = err
  for (let depth = 0; cur !== null && cur !== undefined && depth < 8; depth++) {
    if (cur instanceof LlmLaneError || cur instanceof LlmStreamResponseError) return cur.userMessage
    cur = (cur as { cause?: unknown }).cause
  }
  return undefined
}

/**
 * The wire code for a failed model call: `advanced_mode_unavailable` when
 * Advanced mode could not run on the model's own provider (anywhere on the
 * `cause` chain), else `fallback`. The message is `userFacingMessage`'s, and a
 * route refunds either way.
 */
export function llmErrorCode(err: unknown, fallback = "llm_error"): string {
  let cur: unknown = err
  for (let depth = 0; cur !== null && cur !== undefined && depth < 8; depth++) {
    if (cur instanceof LlmAdvancedModeUnavailableError) return cur.code
    cur = (cur as { cause?: unknown }).cause
  }
  return fallback
}
