/**
 * The provider task id a task-chained node (Extend Video, VEO upscale, the
 * Seedance 2.5 HD finalize) runs against: its own `kieTaskId` when set, else
 * the first upstream node that carries one.
 *
 * One rule for the run (execute-node) and for anything that previews the run —
 * the Seedance 2.5 HD node's price estimate names the draft by this same id,
 * so the price shown is the price of the draft the run will finalize.
 */
export function resolveUpstreamKieTaskId(
  nodeId: string,
  nodeData: Record<string, unknown> | undefined,
  nodes: ReadonlyArray<{ readonly id: string; readonly data: unknown }>,
  edges: ReadonlyArray<{ readonly source: string; readonly target: string }>,
): string | undefined {
  if (nodeData?.kieTaskId) return nodeData.kieTaskId as string
  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    const srcData = nodes.find((n) => n.id === edge.source)?.data as Record<string, unknown> | undefined
    if (srcData?.kieTaskId) return srcData.kieTaskId as string
  }
  return undefined
}
