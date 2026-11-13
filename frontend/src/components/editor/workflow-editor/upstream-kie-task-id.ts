import { handedOnTaskOf, ownTaskInputOf } from "@nodaro/render-rules"

/**
 * The provider task id a task-chained node (Extend Video on VEO / Runway /
 * Grok, Upscale Video on VEO or Seedance 2.5 HD) runs against: the task a
 * WIRED node hands on (`handedOnTaskOf` — its own run's output task, when
 * what made it fits: a generation's `kieTaskId`, an extension's
 * `outputKieTaskId` or, in a graph saved before that, its `kieTaskId` when it
 * differs from what its own source hands it), else the node's own `kieTaskId`
 * — only when no source that fits is wired (`ownTaskInputOf`: wired to one, a
 * task it holds may be its own old output, never run against). The order the
 * server's workflow run reads them in.
 *
 * One rule for the run (execute-node) and for anything that previews the run —
 * the Seedance 2.5 HD node's price estimate names the draft by this same id,
 * so the price shown is the price of the draft the run will finalize.
 */
export function resolveUpstreamKieTaskId(
  nodeId: string,
  nodeData: Record<string, unknown> | undefined,
  nodes: ReadonlyArray<{ readonly id: string; readonly type?: string; readonly data: unknown }>,
  edges: ReadonlyArray<{ readonly source: string; readonly target: string }>,
): string | undefined {
  const graph = { nodes, edges }
  const target = { id: nodeId, type: nodes.find((n) => n.id === nodeId)?.type, data: nodeData }
  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    const src = nodes.find((n) => n.id === edge.source)
    const handed = src ? handedOnTaskOf(target, src, graph) : undefined
    if (handed) return handed
  }
  return ownTaskInputOf(target, graph)
}
