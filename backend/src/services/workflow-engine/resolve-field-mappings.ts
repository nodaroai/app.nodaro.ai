import { resolveFieldMappings as sharedResolve } from "../../../../packages/shared/src/resolve-field-mappings.js"
import { getPrimaryOutput } from "./output-extractor.js"
import {
  PARAMETER_NODE_TYPES,
  getParameterValue,
} from "../../../../packages/shared/src/parameter-node-value.js"
import type { NodeExecutionState, SimpleNode } from "./types.js"

export { NODE_MAPPABLE_FIELDS } from "../../../../packages/shared/src/node-mappable-fields.js"

export function resolveFieldMappings(
  data: Record<string, unknown>,
  nodeStates: Record<string, NodeExecutionState>,
  allNodes: ReadonlyArray<SimpleNode>,
  upstreamText: string | undefined,
  mappableFieldNames: ReadonlyArray<string>,
): Record<string, unknown> {
  return sharedResolve(data, upstreamText, mappableFieldNames, (sourceNodeId) => {
    const sourceNode = allNodes.find((n) => n.id === sourceNodeId)
    const sourceType = sourceNode?.type ?? nodeStates[sourceNodeId]?.nodeType ?? ""

    // Parameter nodes don't execute — read value directly from data, bypass state.output.
    if (sourceNode && PARAMETER_NODE_TYPES.has(sourceType)) {
      return getParameterValue(sourceNode.data as Record<string, unknown>, sourceType)
    }

    const state = nodeStates[sourceNodeId]
    if (!state?.output) return undefined
    return getPrimaryOutput(state.output, sourceType) ?? undefined
  })
}
