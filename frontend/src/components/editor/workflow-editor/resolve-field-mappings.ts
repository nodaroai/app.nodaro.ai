import { resolveFieldMappings as sharedResolve, PARAMETER_NODE_TYPES, getParameterValue, settingsSourceForField } from "@nodaro/shared"
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
    (sourceNodeId, sourceHandle) => {
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
      // The wire's own output (a Router's route, a trigger's named output),
      // not the source's primary value. Mirrors the backend resolver.
      return extractNodeOutput(sourceNode, sourceHandle ?? undefined) ?? undefined
    },
    // A live edge into a `field-<key>` handle, or a Generation Settings node
    // wired into the node's Settings input for this field, wins over
    // fieldMappings/{} — the user explicitly wired this field, so route that
    // source's output to it.
    nodeId && edges
      ? (field) => {
          const edge = edges.find((e) => e.target === nodeId && e.targetHandle === `field-${field}`)
          if (edge) return { sourceNodeId: edge.source, sourceHandle: edge.sourceHandle }
          const consumerType = nodes.find((n) => n.id === nodeId)?.type ?? ""
          return settingsSourceForField(nodeId, consumerType, field, edges, (id) => nodes.find((n) => n.id === id)?.type)
        }
      : undefined,
  )
}
