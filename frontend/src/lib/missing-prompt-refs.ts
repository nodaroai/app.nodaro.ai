import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { NODE_REF_PATTERN, NODE_MAPPABLE_FIELDS, parseNodeRef } from "@nodaro/shared"
import { getUpstreamNodes } from "@/lib/node-refs"
import { isExcludedToken } from "@/lib/prompt-ref-scan"

/**
 * A prompt reference that has no providing node — it would be left unresolved at
 * execution. Phase 1 covers `kind: "text"` ({Label}) only; Phase 2 will add
 * identity kinds ("character" | "location").
 */
export interface MissingRef {
  readonly kind: "text"
  /** The token name exactly as written inside `{ }`, trimmed (e.g. "Hero"). */
  readonly name: string
}

/**
 * Returns the `{Label}` references in `nodeId`'s mappable text fields that have
 * NO upstream ancestor whose label matches — exactly the tokens resolveNodeRefs
 * would leave unresolved. Reuses NODE_REF_PATTERN / RESERVED_TEMPLATE_VARS /
 * getUpstreamNodes / NODE_MAPPABLE_FIELDS so it can't drift from execution.
 *
 * `getUpstreamNodes` labels carry the same "(2)"/"(3)" suffixing the {-typeahead
 * shows, so the resolvable set matches what the user can actually reference.
 * `String.matchAll` clones the regex internally, so sharing the global
 * NODE_REF_PATTERN object here is safe (no lastIndex corruption).
 */
export function computeMissingPromptRefs(
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  nodeId: string,
): MissingRef[] {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return []
  const fields = NODE_MAPPABLE_FIELDS[node.type ?? ""] ?? []
  if (fields.length === 0) return []

  const resolvable = new Set(getUpstreamNodes(nodeId, nodes, edges).map((u) => u.label))

  const data = node.data as Record<string, unknown>
  const seen = new Set<string>()
  const missing: MissingRef[] = []
  for (const field of fields) {
    const value = data[field]
    if (typeof value !== "string" || value.length === 0) continue
    for (const match of value.matchAll(NODE_REF_PATTERN)) {
      const { name } = parseNodeRef(match[1] ?? "")
      if (isExcludedToken(name) || resolvable.has(name) || seen.has(name)) continue
      seen.add(name)
      missing.push({ kind: "text", name })
    }
  }
  return missing
}
