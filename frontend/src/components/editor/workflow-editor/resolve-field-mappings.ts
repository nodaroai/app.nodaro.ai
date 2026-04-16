// frontend/src/components/editor/workflow-editor/resolve-field-mappings.ts

import { extractNodeOutput } from "./execution-graph"
import type { FieldMappings } from "@/types/nodes"
import { injectUpstream } from "@nodaro-shared/inject-upstream"
import { NODE_TEXT_FIELDS } from "@nodaro-shared/node-text-fields"

export { NODE_TEXT_FIELDS }

/**
 * Resolve fieldMappings + {} injection for all text fields on a node.
 *
 * Two resolution mechanisms:
 *   1. fieldMappings: field mapped to source node → use that node's output
 *   2. {} injection: manual field contains {} → replace with upstreamText
 *
 * Does NOT inject upstream into empty unmapped fields — that stays in
 * per-node execution code (e.g., d.prompt || inputs.prompt).
 */
export function resolveFieldMappings(
  data: Record<string, unknown>,
  nodes: ReadonlyArray<{ id: string; data: Record<string, unknown>; type?: string }>,
  upstreamText: string | undefined,
  textFieldNames: ReadonlyArray<string>,
): Record<string, unknown> {
  const fm = data.fieldMappings as FieldMappings | undefined
  const resolved = { ...data }

  for (const field of textFieldNames) {
    const mapping = fm?.[field]

    if (mapping?.sourceNodeId) {
      const sourceNode = nodes.find((n) => n.id === mapping.sourceNodeId)
      if (sourceNode) {
        const output = extractNodeOutput(sourceNode as never)
        if (output != null) resolved[field] = output
      }
    } else {
      const current = resolved[field]
      if (typeof current === "string") {
        const injected = injectUpstream(current, upstreamText)
        if (injected !== current) resolved[field] = injected
      }
    }
  }

  return resolved
}
