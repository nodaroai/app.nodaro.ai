import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { holdsJsonRunResult, isJsonRunResultType } from "@/lib/json-run-result"
import { extractNodeOutput } from "./execution-graph"
import { liveExecutable } from "./run-from-here-set"

/**
 * Whether a node holds an output a later node can be fed from. This is the
 * question the server asks of a node a run leaves out
 * (`extractSavedNodeOutput`, which the editor mirrors in `extractNodeOutput`),
 * so "has run" can never mean something the server cannot read: a node that
 * reads as run here is one a run that skips it can still seed from. A failed
 * node holds an error, not an output, and counts as not run.
 */
export function nodeHasRunOutput(node: WorkflowNode): boolean {
  const out = extractNodeOutput(node)
  if (typeof out === "string" ? out.trim() !== "" : out !== undefined && out !== null) return true
  const data = (node.data ?? {}) as Record<string, unknown>
  return isJsonRunResultType(node.type) && holdsJsonRunResult(node.type, data)
}

export interface RunUpToHereSet {
  /** Every node id the run sends: the upstream region up to the nodes that already hold their output. */
  readonly ids: ReadonlySet<string>
  /** The nodes that execute, in graph order: live, executable, not run yet. */
  readonly executable: WorkflowNode[]
}

/**
 * What "Run up to here" on `startId` executes: the upstream nodes that have not
 * run yet, and never the node itself.
 *
 * The walk goes up the wires and STOPS at a node that already holds its output
 * (the server seeds the run from it), so what only feeds such a node is not
 * needed and is left alone. Nodes that are not executable (a prompt, a list)
 * are walked through and kept in `ids`, as "Run from here" keeps them in its
 * set. One set for the run, for its confirm and for the price its button
 * quotes, so they can never disagree.
 */
export function runUpToHereSet(startId: string, nodes: WorkflowNode[], edges: WorkflowEdge[]): RunUpToHereSet {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const live = new Set(liveExecutable(nodes).map((n) => n.id))
  const incoming = new Map<string, string[]>()
  for (const e of edges) incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source])

  const seen = new Set<string>([startId])
  const ids = new Set<string>()
  const queue = [startId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const source of incoming.get(current) ?? []) {
      if (seen.has(source)) continue
      seen.add(source)
      const upstream = byId.get(source)
      if (!upstream) continue
      if (live.has(source) && nodeHasRunOutput(upstream)) continue
      ids.add(source)
      queue.push(source)
    }
  }
  const executable = liveExecutable(nodes).filter((n) => ids.has(n.id) && !(n.data as { skipped?: unknown }).skipped)
  return { ids, executable }
}
