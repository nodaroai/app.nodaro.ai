import { OUTPUT_FIELD_MAP, parseHandleId } from "@nodaro/shared"
import type { ComponentMetadata } from "@nodaro/shared"
import { getPrimaryOutput } from "../services/workflow-engine/output-extractor.js"
import type { NodeOutput } from "../services/workflow-engine/types.js"

type NodeStates = Record<string, { output?: Record<string, unknown> }>
type SnapshotNode = { id: string; type?: string }
type SnapshotEdge = {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

/**
 * Collect the output values for each component handle after the inner workflow
 * has completed. Handles two shapes:
 *
 * - Plain handles (id = nodeId): read directly from `nodeStates[nodeId].output[fieldKey]`,
 *   where fieldKey falls back to `OUTPUT_FIELD_MAP[handle.type]` then `handle.type`.
 *
 * - Compound handles (id = nodeId::portId): the target node is a
 *   `sub-workflow-output` which is skipped at runtime, so trace the snapshot
 *   edge into the port (target=nodeId, targetHandle=portId), then resolve via
 *   `getPrimaryOutput(srcOutput, srcType, edge.sourceHandle)` — same routing
 *   sub-workflow-handler uses when this workflow is invoked as a child.
 *
 * Extracted as a pure function so the route stays slim and the routing logic
 * is testable without spinning up Fastify + DB + executeAppRun mocks.
 */
export function collectComponentOutputs(
  metadata: ComponentMetadata,
  nodeStates: NodeStates,
  snapshotNodes: SnapshotNode[],
  snapshotEdges: SnapshotEdge[],
): Record<string, string> {
  const nodeTypeById = new Map(snapshotNodes.map((n) => [n.id, n.type] as const))
  const outputData: Record<string, string> = {}

  for (const handle of metadata.outputs) {
    const { nodeId, portId } = parseHandleId(handle.id)

    if (portId) {
      const edge = snapshotEdges.find((e) => e.target === nodeId && e.targetHandle === portId)
      if (!edge) continue
      const srcState = nodeStates[edge.source]
      if (!srcState?.output) continue
      const srcType = nodeTypeById.get(edge.source) ?? ""
      const value = getPrimaryOutput(srcState.output as NodeOutput, srcType, edge.sourceHandle)
      if (value) outputData[handle.id] = value
      continue
    }

    const nodeState = nodeStates[handle.id]
    const fieldKey = handle.fieldKey || OUTPUT_FIELD_MAP[handle.type] || handle.type
    const value = nodeState?.output?.[fieldKey]
    if (value && typeof value === "string") {
      outputData[handle.id] = value
    }
  }

  return outputData
}
