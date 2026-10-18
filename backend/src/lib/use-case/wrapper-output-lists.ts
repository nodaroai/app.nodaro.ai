/**
 * What a use-case wrapper reports for a run whose result is a list (a clip
 * set's clips, a run's formats) or text (chapters), and why a completed run of
 * a kind delivered nothing. Each of those types fills its own branch as it
 * ships; until then a list run reports only its execution. Pure.
 *
 * Chapters (decided 2026-10-14): `text` is the plan's chapters as show notes
 * (one "M:SS Title" line per chapter), `json` the bare chapter list
 * (`{ startMs, title }[]`), `plan` the plan as Edit Plan made it.
 */
import { chapterRowsOf, formatChapterListText, usecaseResultKind, type StoredInlineGraph } from "@nodaro/render-rules"
import { completedOutput, failedStepOf, isRecord, type UseCaseWrapperOutput } from "./wrapper-output-parts.js"

export function listOutput(
  graph: StoredInlineGraph,
  nodeStates: Readonly<Record<string, unknown>>,
  executionId: string,
): UseCaseWrapperOutput {
  const map = graph.outputMap
  const planOut = completedOutput(nodeStates, map.planNodeId)
  const transcriptOut = completedOutput(nodeStates, map.transcript.nodeId)
  const common = {
    ...(transcriptOut?.json !== undefined ? { transcript: transcriptOut.json } : {}),
    ...(isRecord(graph.settings) ? { useCaseSettings: graph.settings } : {}),
    _executionId: executionId,
    ...failedStepOf(graph, nodeStates),
  }
  switch (map.kind) {
    case "chapters": {
      const rows = chapterRowsOf(planOut?.json)
      const text = formatChapterListText(rows)
      return { ...(planOut ? { json: rows, plan: planOut.json } : {}), ...(text ? { text } : {}), quality: "final", ...common }
    }
    default:
      // Clips and formats fill their own branches as they ship.
      return { quality: "final", ...common }
  }
}

/** Why a completed run of this kind delivered nothing, in the user's words. */
export function usecaseNoResultMessage(graph: StoredInlineGraph | null): string {
  switch (graph ? usecaseResultKind(graph.outputMap) : "episode") {
    case "chapters":
      return "The plan found no chapters in this recording."
    case "clips":
      return "The plan found no clips in this recording."
    default:
      return "The run finished without a result"
  }
}
