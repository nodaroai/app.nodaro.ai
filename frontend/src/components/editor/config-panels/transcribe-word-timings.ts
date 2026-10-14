import { findWordlessTranscriptFeeds } from "@nodaro/shared/nodes"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * The panel-side half of the transcribe → captions word-timings check.
 *
 * A lane that cannot return per-word timings (`whisper`) still RUNS and BILLS —
 * it hands back phrase segments with `words: []`, and the Add Captions node it
 * feeds then fails on an already-paid transcription. The pre-run gate refuses
 * such a graph, but the config panel is where the user can still fix it for
 * free, so the same shared graph walk answers "does THIS node feed captions
 * wordlessly?" and the panel shows the refusal inline next to the engine picker.
 *
 * Returns the offending ENGINE id (the panel renders the localized sentence
 * from it — the shared `message` is English and this panel is translated), or
 * null when there is nothing to warn about. Lives in its own module so it is
 * testable without mounting the 140KB audio-configs panel.
 */
export function wordlessTranscriptWarning(
  nodeId: string | undefined,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge> | undefined,
): { engine: string } | null {
  if (!nodeId) return null
  const hit = findWordlessTranscriptFeeds(nodes, edges ?? []).find(
    (f) => f.transcribeNodeId === nodeId,
  )
  return hit ? { engine: hit.provider } : null
}
