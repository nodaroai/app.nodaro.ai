/**
 * Frontend canvas-side audio-style hint collector. Parallel to
 * `cinematography-hints.ts`. Both this and the backend payload-builder
 * call `composeSoundHintFromConnections` from @nodaro/shared so the
 * preview the user sees is byte-identical to what the backend
 * orchestrator computes.
 */

import {
  composeSoundHintFromConnections,
  type SoundConsumerType,
  type SoundComposition,
} from "@nodaro/shared"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

// Re-export shared helpers so existing call sites keep working.
export { truncateForField, appendField } from "@nodaro/shared"

export function collectAudioStyleHints(
  consumer: WorkflowNode,
  consumerType: SoundConsumerType,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): SoundComposition {
  // Short-circuit: if no audio-style edges target this consumer, skip the
  // O(N) graph projection entirely. Preview/runtime call this on every
  // render of every audio config panel, so the empty-graph case is hot.
  const hasAudioStyleEdge = edges.some(
    (e) => e.target === consumer.id && e.targetHandle === "audio-style",
  )
  if (!hasAudioStyleEdge) {
    return { text: "", fields: {}, warnings: [] }
  }

  return composeSoundHintFromConnections(
    {
      id: consumer.id,
      type: consumer.type as string | undefined,
      data: consumer.data,
    },
    consumerType,
    {
      nodes: nodes.map((n) => ({ id: n.id, type: n.type as string | undefined, data: n.data })),
      edges: edges.map((e) => ({
        source: e.source, target: e.target,
        sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null,
      })),
    },
  )
}
