import { LlmLaneError, LlmStreamResponseError } from "./llm-errors.js"

/**
 * The message a person sees for a failed job or request.
 *
 * An error from a model's serving lane (`LlmLaneError`, or the usage-carrying
 * `LlmStreamResponseError` family) carries a `userMessage` that names no lane,
 * vendor or internal model id — its `message` is the full diagnostic, which
 * logs and the private plugins' retry classifier still read, and which the
 * job keeps in `error_detail`. It is found anywhere on the `cause` chain, so a
 * caller that wraps it does not leak the diagnostic. Any other error's own
 * message stands: provider classes such as `KieError` are already sanitized
 * where they are thrown.
 */
export function userFacingMessage(err: unknown, fallback: string): string {
  let cur: unknown = err
  for (let depth = 0; cur !== null && cur !== undefined && depth < 8; depth++) {
    if (cur instanceof LlmLaneError || cur instanceof LlmStreamResponseError) return cur.userMessage
    cur = (cur as { cause?: unknown }).cause
  }
  return err instanceof Error ? err.message : fallback
}
