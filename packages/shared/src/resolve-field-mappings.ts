import { injectUpstream } from "./inject-upstream.js"

/**
 * Resolve fieldMappings + {} injection for all text fields on a node.
 *
 * Two resolution mechanisms:
 *   1. fieldMappings: field mapped to source node → use that node's output
 *   2. {} injection: manual field contains {} → replace with upstreamText
 *
 * Does NOT inject upstream into empty unmapped fields — that stays in
 * per-node execution code (e.g., d.prompt || inputs.prompt).
 *
 * The `getSourceOutput` callback abstracts how source node output is
 * extracted — frontend reads from live React Flow state, backend reads
 * from NodeExecutionState.output. Same pattern as ancestor-refs.ts.
 */
export function resolveFieldMappings(
  data: Record<string, unknown>,
  upstreamText: string | undefined,
  mappableFieldNames: ReadonlyArray<string>,
  getSourceOutput: (sourceNodeId: string) => string | undefined,
): Record<string, unknown> {
  const fm = data.fieldMappings as Record<string, { sourceNodeId: string }> | undefined
  const resolved = { ...data }

  for (const field of mappableFieldNames) {
    const mapping = fm?.[field]

    if (mapping?.sourceNodeId) {
      const output = getSourceOutput(mapping.sourceNodeId)
      if (output != null) resolved[field] = output
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
