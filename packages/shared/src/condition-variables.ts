/**
 * Build a label→output map for `{Node Label}` refs inside condition values
 * on filter-list and router nodes.
 *
 * Only considers edges whose `targetHandle === VARIABLES_HANDLE_ID` — the
 * dedicated condition-variables input handle. Data-flow edges (targetHandle
 * `"in"`, column handles, etc.) are ignored, so variable sources never
 * influence the filtered/routed list.
 *
 * Duplicate labels are suffixed `Same`, `Same (2)`, `Same (3)` — matches
 * the convention in `buildNodeRefMap` (frontend) / `buildNodeRefsMap`
 * (backend) for text-prompt refs.
 */

export const VARIABLES_HANDLE_ID = "variables"

type EdgeShape = {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

type NodeShape = {
  id: string
  type?: string
  data: Record<string, unknown>
}

export function buildConditionVariables<
  E extends EdgeShape,
  N extends NodeShape,
>(
  targetNodeId: string,
  edges: ReadonlyArray<E>,
  nodes: ReadonlyArray<N>,
  extractOutput: (node: N) => string | undefined,
): Map<string, string> {
  const pairs: Array<{ label: string; output: string }> = []
  for (const edge of edges) {
    if (edge.target !== targetNodeId) continue
    if (edge.targetHandle !== VARIABLES_HANDLE_ID) continue
    const src = nodes.find((n) => n.id === edge.source)
    if (!src) continue
    const output = extractOutput(src)
    if (output === undefined || output === "") continue
    const label = (src.data.label as string) || src.type || src.id
    pairs.push({ label, output })
  }

  const map = new Map<string, string>()
  const counts = new Map<string, number>()
  for (const { label } of pairs) counts.set(label, (counts.get(label) ?? 0) + 1)
  const seen = new Map<string, number>()
  for (const { label, output } of pairs) {
    let key = label
    if ((counts.get(label) ?? 0) > 1) {
      const n = (seen.get(label) ?? 0) + 1
      seen.set(label, n)
      if (n > 1) key = `${label} (${n})`
    }
    map.set(key, output)
  }
  return map
}
