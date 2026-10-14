import { siteCaptureNodeOutputs } from "@nodaro/shared"

/**
 * Site Capture's node-data patches — the ONE mapping the live run, the poll
 * restored after a reload and the server-run lanes share (scrape-result-recovery.ts).
 */

/** A run starting: running, with its start time (the card's elapsed counter). */
export function siteCaptureRunStartPatch(): Record<string, unknown> {
  return { executionStatus: "running", errorMessage: undefined, lastRunStartedAt: Date.now() }
}

/**
 * A completed capture: its output on `generatedJson`, its stills in page order
 * on `__listResults` (what the `image` pip lists; the first still is its value).
 */
export function applySiteCaptureResult(output: unknown): Record<string, unknown> {
  const { json, listResults } = siteCaptureNodeOutputs(output)
  return {
    executionStatus: "completed",
    lastRunOutcome: "success",
    lastRunAt: Date.now(),
    errorMessage: undefined,
    ...(json ? { generatedJson: json } : {}),
    __listResults: listResults,
  }
}

/** A failed capture: the outcome and the message; the last good capture is kept. */
export function applySiteCaptureFailure(message: string): Record<string, unknown> {
  return { executionStatus: "failed", lastRunOutcome: "failed", lastRunAt: Date.now(), errorMessage: message }
}
