import { COMPOSER_PLAN_MAP } from "@nodaro/shared"

/** The connected scene is the edit input; the node's own scene is its last output. */
export function scene3DEditInput(
  nodeId: string | undefined,
  ownPlan: Record<string, unknown> | undefined,
  nodes: ReadonlyArray<{ id: string; type?: string; data: unknown }>,
  edges: ReadonlyArray<{ source: string; target: string; targetHandle?: string | null }>,
): Record<string, unknown> | undefined {
  for (const edge of edges) {
    if (edge.target !== nodeId || edge.targetHandle !== "scene") continue
    const source = nodes.find((node) => node.id === edge.source)
    const mapping = COMPOSER_PLAN_MAP[source?.type ?? ""]
    if (!source || !mapping) continue
    const plan = (source.data as Record<string, unknown> | undefined)?.[mapping.planField]
    if (plan && typeof plan === "object" && !Array.isArray(plan)) return plan as Record<string, unknown>
  }
  return ownPlan
}
