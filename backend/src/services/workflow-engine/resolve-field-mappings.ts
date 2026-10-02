import { resolveFieldMappings as sharedResolve, PARAMETER_NODE_TYPES, getParameterValue, settingsSourceForField } from "@nodaro/shared"
export { NODE_MAPPABLE_FIELDS } from "@nodaro/shared"
import { getPrimaryOutput } from "./output-extractor.js"
import type { NodeExecutionState, SimpleNode, SimpleEdge } from "./types.js"


export function resolveFieldMappings(
  data: Record<string, unknown>,
  nodeStates: Record<string, NodeExecutionState>,
  allNodes: ReadonlyArray<SimpleNode>,
  upstreamText: string | undefined,
  mappableFieldNames: ReadonlyArray<string>,
  nodeId?: string,
  edges?: ReadonlyArray<SimpleEdge>,
): Record<string, unknown> {
  return sharedResolve(
    data,
    upstreamText,
    mappableFieldNames,
    (sourceNodeId, sourceHandle) => {
      const sourceNode = allNodes.find((n) => n.id === sourceNodeId)
      const sourceType = sourceNode?.type ?? nodeStates[sourceNodeId]?.nodeType ?? ""

      // Parameter nodes don't execute — read value directly from data, bypass state.output.
      if (sourceNode && PARAMETER_NODE_TYPES.has(sourceType)) {
        return getParameterValue(sourceNode.data as Record<string, unknown>, sourceType)
      }

      const state = nodeStates[sourceNodeId]
      if (!state?.output) return undefined
      // The wire's own output (a Router's route, a trigger's named output),
      // not the source's primary value.
      return getPrimaryOutput(state.output, sourceType, sourceHandle) ?? undefined
    },
    // A live edge into a `field-<key>` handle, or a Generation Settings node
    // wired into the node's Settings input for this field, wins over
    // fieldMappings/{} — mirrors the frontend resolver in
    // workflow-editor/resolve-field-mappings.ts.
    nodeId && edges
      ? (field) => {
          const edge = edges.find((e) => e.target === nodeId && e.targetHandle === `field-${field}`)
          if (edge) return { sourceNodeId: edge.source, sourceHandle: edge.sourceHandle }
          const consumerType = allNodes.find((n) => n.id === nodeId)?.type ?? ""
          return settingsSourceForField(nodeId, consumerType, field, edges, (id) => allNodes.find((n) => n.id === id)?.type)
        }
      : undefined,
  )
}
