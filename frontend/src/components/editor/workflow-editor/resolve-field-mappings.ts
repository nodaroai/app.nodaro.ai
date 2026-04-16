import { resolveFieldMappings as sharedResolve } from "@nodaro-shared/resolve-field-mappings"
import { extractNodeOutput } from "./execution-graph"
import type { WorkflowNode } from "@/types/nodes"

export { NODE_TEXT_FIELDS } from "@nodaro-shared/node-text-fields"

export function resolveFieldMappings(
  data: Record<string, unknown>,
  nodes: ReadonlyArray<WorkflowNode>,
  upstreamText: string | undefined,
  textFieldNames: ReadonlyArray<string>,
): Record<string, unknown> {
  return sharedResolve(data, upstreamText, textFieldNames, (sourceNodeId) => {
    const sourceNode = nodes.find((n) => n.id === sourceNodeId)
    return sourceNode ? extractNodeOutput(sourceNode) ?? undefined : undefined
  })
}
