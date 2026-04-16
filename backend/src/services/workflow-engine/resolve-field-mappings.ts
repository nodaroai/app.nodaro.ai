import { resolveFieldMappings as sharedResolve } from "../../../../packages/shared/src/resolve-field-mappings.js"
import { getPrimaryOutput } from "./output-extractor.js"
import type { NodeExecutionState, SimpleNode } from "./types.js"

export { NODE_TEXT_FIELDS } from "../../../../packages/shared/src/node-text-fields.js"

export function resolveFieldMappings(
  data: Record<string, unknown>,
  nodeStates: Record<string, NodeExecutionState>,
  allNodes: ReadonlyArray<SimpleNode>,
  upstreamText: string | undefined,
  textFieldNames: ReadonlyArray<string>,
): Record<string, unknown> {
  return sharedResolve(data, upstreamText, textFieldNames, (sourceNodeId) => {
    const state = nodeStates[sourceNodeId]
    if (!state?.output) return undefined
    const sourceNode = allNodes.find((n) => n.id === sourceNodeId)
    const sourceType = sourceNode?.type ?? state.nodeType ?? ""
    return getPrimaryOutput(state.output, sourceType) ?? undefined
  })
}
