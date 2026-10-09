/**
 * Run-start refusal for a Speaker Frames that has no price (P3.6, until P3.7).
 *
 * `buildSpeakerFramesPayload` still refuses at the node's own dispatch, but by
 * then Transcribe, Edit Plan and Camera Switch upstream have run and charged.
 * The refusal is known at run start, so the orchestrator asks it BEFORE any
 * node dispatches — of the nodes the run executes and of every graph a
 * sub-workflow node in it loads — the Speaker View arrangement before C4.
 * P3.7 deletes this with the flag; the per-node refusal stays.
 */
import { SPEAKER_FRAMES_PRICED, speakerFramesRunRefusal } from "@nodaro/render-rules"
import type { NestedRunGraph } from "./sub-workflow-handler.js"
import type { SimpleNode } from "./types.js"

/** The message to fail the execution with, or `null` when the run may start. */
export function speakerFramesRunPreflight(
  runNodes: ReadonlyArray<SimpleNode>,
  nestedGraphs: ReadonlyArray<NestedRunGraph> = [],
): string | null {
  const top = speakerFramesRunRefusal(runNodes, SPEAKER_FRAMES_PRICED)
  if (top) return top.message
  for (const graph of nestedGraphs) {
    const hit = speakerFramesRunRefusal(graph.nodes, SPEAKER_FRAMES_PRICED)
    if (hit) return `${hit.message} Found inside Sub-workflow node ${graph.subWorkflowPath.join(" → ")}.`
  }
  return null
}
