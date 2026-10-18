/**
 * The pure-ish halves of an app run's Retry (routes/app-run-resume.ts): which execution it
 * continues, and which nodes it considers.
 */
import { getRouteReachableNodeIds } from "@nodaro/shared/workflow"
import type { ContinuationSource } from "../services/workflow-engine/run-continuation.js"

/** How far back a Retry walks over Retries that never started. */
const MAX_UNSTARTED_RETRIES = 5

/**
 * The execution a Retry continues: the one the run points at — unless that one is a Retry that
 * failed before it started (refused at pickup: it holds no states of its own), in which case what
 * IT continued, and so on. Continuing it would run, and charge, everything again. The walk follows
 * only the run's own Retries (`resumedFrom`, written by the route) and stops at the first execution
 * that started, or after a few.
 */
export async function resumeSource(
  pointed: ContinuationSource,
  load: (executionId: string) => Promise<ContinuationSource | null>,
): Promise<ContinuationSource> {
  let source = pointed
  for (let hop = 0; hop < MAX_UNSTARTED_RETRIES; hop++) {
    if (source.status !== "failed" || source.startedAt || !source.resumedFrom) return source
    const earlier = await load(source.resumedFrom)
    // Only the same runner's execution of the same version is the run's own.
    if (!earlier || earlier.userId !== source.userId || earlier.appVersionId !== source.appVersionId) return source
    source = earlier
  }
  return source
}

type GraphNode = { readonly id: string; readonly type?: string; readonly data?: Record<string, unknown> }
type GraphEdge = { readonly source: string; readonly target: string }

/**
 * The nodes the app's run considers: the app's route when its presentation runs one (the run
 * route's `runTarget: "route"`, the same reading), else every node. In graph order.
 */
export function resumeRouteNodeIds(
  graphOrder: readonly string[],
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  snapshotSettings: Readonly<Record<string, unknown>> | null,
): string[] {
  const pres = (snapshotSettings ?? {}).presentationSettings as { runTarget?: string; selectedRouteId?: string } | undefined
  if (pres?.runTarget !== "route" || !pres.selectedRouteId) return [...graphOrder]
  const reachable = getRouteReachableNodeIds(
    nodes.map((n) => ({ id: n.id, type: n.type, data: n.data ?? {} })) as Parameters<typeof getRouteReachableNodeIds>[0],
    edges as Parameters<typeof getRouteReachableNodeIds>[1],
    pres.selectedRouteId,
  )
  // A stale route (nothing reachable) runs the whole workflow, as the run route does.
  return reachable.size > 0 ? graphOrder.filter((id) => reachable.has(id)) : [...graphOrder]
}
