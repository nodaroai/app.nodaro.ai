import { resolveFieldMappings as sharedResolve } from "@nodaro/shared"
import { PARAMETER_NODE_TYPES, getParameterValue } from "@nodaro/shared"
import { extractNodeOutput } from "./execution-graph"
import type { WorkflowNode } from "@/types/nodes"

export { NODE_MAPPABLE_FIELDS } from "@nodaro/shared"

export function resolveFieldMappings(
  data: Record<string, unknown>,
  nodes: ReadonlyArray<WorkflowNode>,
  upstreamText: string | undefined,
  mappableFieldNames: ReadonlyArray<string>,
): Record<string, unknown> {
  return sharedResolve(data, upstreamText, mappableFieldNames, (sourceNodeId) => {
    const sourceNode = nodes.find((n) => n.id === sourceNodeId)
    if (!sourceNode) return undefined
    // Field mappings on non-text targets (e.g. mapping a `framing` field to a
    // Framing node) need the bare picker value, not the rich prompt hint that
    // extractNodeOutput now returns for text consumers. Mirrors the backend
    // resolver in services/workflow-engine/resolve-field-mappings.ts.
    const sourceType = sourceNode.type ?? ""
    if (PARAMETER_NODE_TYPES.has(sourceType)) {
      return getParameterValue(sourceNode.data as Record<string, unknown>, sourceType)
    }
    return extractNodeOutput(sourceNode) ?? undefined
  })
}
