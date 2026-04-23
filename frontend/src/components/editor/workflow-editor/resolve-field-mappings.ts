import { resolveFieldMappings as sharedResolve } from "@nodaro-shared/resolve-field-mappings"
import { extractNodeOutput } from "./execution-graph"
import type { WorkflowNode } from "@/types/nodes"

export { NODE_MAPPABLE_FIELDS } from "@nodaro-shared/node-mappable-fields"

export function resolveFieldMappings(
  data: Record<string, unknown>,
  nodes: ReadonlyArray<WorkflowNode>,
  upstreamText: string | undefined,
  mappableFieldNames: ReadonlyArray<string>,
): Record<string, unknown> {
  return sharedResolve(data, upstreamText, mappableFieldNames, (sourceNodeId) => {
    const sourceNode = nodes.find((n) => n.id === sourceNodeId)
    return sourceNode ? extractNodeOutput(sourceNode) ?? undefined : undefined
  })
}
