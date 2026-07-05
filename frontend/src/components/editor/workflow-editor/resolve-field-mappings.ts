import { resolveFieldMappings as sharedResolve, PARAMETER_NODE_TYPES, getParameterValue } from "@nodaro/shared"
export { NODE_MAPPABLE_FIELDS } from "@nodaro/shared"
import { extractNodeOutput } from "./execution-graph"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"


export function resolveFieldMappings(
  data: Record<string, unknown>,
  nodes: ReadonlyArray<WorkflowNode>,
  upstreamText: string | undefined,
  mappableFieldNames: ReadonlyArray<string>,
  nodeId?: string,
  edges?: ReadonlyArray<WorkflowEdge>,
): Record<string, unknown> {
  return sharedResolve(
    data,
    upstreamText,
    mappableFieldNames,
    (sourceNodeId) => {
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
    },
    // A live edge into a `field-<key>` handle wins over fieldMappings/{} —
    // the user explicitly wired this field, so route that source's output to it.
    nodeId && edges
      ? (field) => edges.find((e) => e.target === nodeId && e.targetHandle === `field-${field}`)?.source
      : undefined,
  )
}
