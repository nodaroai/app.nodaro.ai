import { resolveFieldMappings as sharedResolve, PARAMETER_NODE_TYPES, getParameterValue } from "@nodaro/shared"
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
    (sourceNodeId) => {
      const sourceNode = allNodes.find((n) => n.id === sourceNodeId)
      const sourceType = sourceNode?.type ?? nodeStates[sourceNodeId]?.nodeType ?? ""

      // Parameter nodes don't execute — read value directly from data, bypass state.output.
      if (sourceNode && PARAMETER_NODE_TYPES.has(sourceType)) {
        return getParameterValue(sourceNode.data as Record<string, unknown>, sourceType)
      }

      const state = nodeStates[sourceNodeId]
      if (!state?.output) return undefined
      return getPrimaryOutput(state.output, sourceType) ?? undefined
    },
    // A live edge into a `field-<key>` handle wins over fieldMappings/{} —
    // mirrors the frontend resolver in workflow-editor/resolve-field-mappings.ts.
    nodeId && edges
      ? (field) => edges.find((e) => e.target === nodeId && e.targetHandle === `field-${field}`)?.source
      : undefined,
  )
}
