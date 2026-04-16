// backend/src/services/workflow-engine/resolve-field-mappings.ts

import { injectUpstream } from "../../../../packages/shared/src/inject-upstream.js"
import { NODE_TEXT_FIELDS } from "../../../../packages/shared/src/node-text-fields.js"
import { getPrimaryOutput } from "./output-extractor.js"
import type { NodeExecutionState, SimpleNode } from "./types.js"

export { NODE_TEXT_FIELDS }

export function resolveFieldMappings(
  data: Record<string, unknown>,
  nodeStates: Record<string, NodeExecutionState>,
  allNodes: ReadonlyArray<SimpleNode>,
  upstreamText: string | undefined,
  textFieldNames: ReadonlyArray<string>,
): Record<string, unknown> {
  const fm = data.fieldMappings as Record<string, { sourceNodeId: string }> | undefined
  const resolved = { ...data }

  for (const field of textFieldNames) {
    const mapping = fm?.[field]

    if (mapping?.sourceNodeId) {
      const state = nodeStates[mapping.sourceNodeId]
      if (state?.output) {
        const sourceNode = allNodes.find((n) => n.id === mapping.sourceNodeId)
        const sourceType = sourceNode?.type ?? state.nodeType ?? ""
        const output = getPrimaryOutput(state.output, sourceType)
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
