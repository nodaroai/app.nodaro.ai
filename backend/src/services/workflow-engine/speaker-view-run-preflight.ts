/**
 * Run-start refusal for a Speaker View that has no price (C3.2, until C4).
 *
 * `buildSpeakerViewPayload` still refuses at the node's own dispatch, but by
 * then Transcribe, Edit Plan and Camera Switch upstream have run and charged
 * for a render that cannot succeed. The refusal is deterministic and known at
 * run start, so the orchestrator asks it BEFORE any node dispatches, of the
 * nodes the run will execute and of every graph a sub-workflow node in it will
 * load, and fails the execution with the nodes named. C4 deletes this with the
 * flag; the per-node refusal stays as defence in depth.
 */
import { SPEAKER_VIEW_PRICED, speakerViewRunRefusal } from "@nodaro/render-rules"
import type { NestedRunGraph } from "./sub-workflow-handler.js"
import type { SimpleNode } from "./types.js"

/** The message to fail the execution with, or `null` when the run may start. */
export function speakerViewRunPreflight(
  runNodes: ReadonlyArray<SimpleNode>,
  nestedGraphs: ReadonlyArray<NestedRunGraph> = [],
): string | null {
  const top = speakerViewRunRefusal(runNodes, SPEAKER_VIEW_PRICED)
  if (top) return top.message
  for (const graph of nestedGraphs) {
    const hit = speakerViewRunRefusal(graph.nodes, SPEAKER_VIEW_PRICED)
    if (hit) return `${hit.message} Found inside Sub-workflow node ${graph.subWorkflowPath.join(" → ")}.`
  }
  return null
}
