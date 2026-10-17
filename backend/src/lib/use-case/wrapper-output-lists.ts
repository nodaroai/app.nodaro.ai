/**
 * What a use-case wrapper reports for a run whose result is a list (a clip
 * set's clips, a run's formats) or text (chapters). Each of those types fills
 * its own branch as it ships; until then a list run reports only its
 * execution. Pure.
 */
import type { StoredInlineGraph } from "@nodaro/render-rules"
import type { UseCaseWrapperOutput } from "./wrapper-output-parts.js"

export function listOutput(
  _graph: StoredInlineGraph,
  _nodeStates: Readonly<Record<string, unknown>>,
  executionId: string,
): UseCaseWrapperOutput {
  return { quality: "final", _executionId: executionId }
}
