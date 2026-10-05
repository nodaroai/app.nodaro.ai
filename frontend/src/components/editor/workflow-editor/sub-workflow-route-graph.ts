import { readWorkflowContent } from "@/lib/workflow-content"
import type { WorkflowNode, WorkflowEdge, SubWorkflowData, SubWorkflowInputData, SubWorkflowOutputData } from "@/types/nodes"

/** Nesting limit for sub-workflow execution (and for any walk that mirrors it). */
export const SUB_WORKFLOW_MAX_DEPTH = 5

/**
 * The workflow+route pair a sub-workflow node executes. The cycle guard keys on
 * this, not on the workflow alone, so the same workflow may be called again
 * through a DIFFERENT route (self-referencing is allowed).
 */
export function subWorkflowRouteKey(data: Pick<SubWorkflowData, "referencedWorkflowId" | "selectedRouteId">): string {
  return `${data.referencedWorkflowId}:${data.selectedRouteId}`
}

/**
 * BFS to collect all node IDs reachable from a source in a directed graph.
 * Used to prune the subgraph to only the route's reachable nodes.
 */
export function getReachableNodeIds(sourceId: string, edges: WorkflowEdge[]): Set<string> {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const list = adjacency.get(edge.source) ?? []
    list.push(edge.target)
    adjacency.set(edge.source, list)
  }
  const visited = new Set<string>([sourceId])
  const queue = [sourceId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        queue.push(neighbor)
      }
    }
  }
  return visited
}

/** The graph a sub-workflow node will run: the referenced workflow filtered to
 *  the nodes its route reaches, plus that route's input/output nodes. */
export interface SubWorkflowRouteGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  inputNode: WorkflowNode
  outputNode: WorkflowNode
}

/**
 * Load the workflow a sub-workflow node references and filter it to the route's
 * reachable nodes — the ONE step the executor and the pre-run word-timings walk
 * share, so a check made before the run sees exactly the graph the run will
 * execute (and a route filter fixed in one place stays fixed for both).
 *
 * Throws the executor's own messages; callers that only INSPECT a nested graph
 * (a preflight) swallow the throw and let the run surface it.
 */
export async function loadSubWorkflowRouteGraph(data: SubWorkflowData): Promise<SubWorkflowRouteGraph> {
  // The referenced workflow may be somebody else's: read it as THIS caller may
  // hold it (lib/workflow-content.ts). A failed read is the same "not found"
  // the executor has always reported.
  const content = await readWorkflowContent(data.referencedWorkflowId, "id, nodes, edges").catch(() => null)
  if (!content) {
    throw new Error("Referenced workflow not found")
  }
  const wfData = content.row

  const allSubNodes = (wfData.nodes as unknown as WorkflowNode[]) ?? []
  const allSubEdges = (wfData.edges as unknown as WorkflowEdge[]) ?? []

  // The route's input and output nodes
  const inputNode = allSubNodes.find(
    (n) => n.type === "sub-workflow-input" && (n.data as SubWorkflowInputData).routeId === data.selectedRouteId,
  )
  const outputNode = allSubNodes.find(
    (n) => n.type === "sub-workflow-output" && (n.data as SubWorkflowOutputData).routeId === data.selectedRouteId,
  )

  if (!inputNode || !outputNode) {
    throw new Error("Route input/output nodes not found in referenced workflow")
  }

  // Only nodes reachable from the route's input node. This prevents unrelated
  // sub-workflow nodes (e.g. in self-referencing workflows) from being included
  // in the execution graph.
  const reachableIds = getReachableNodeIds(inputNode.id, allSubEdges)
  return {
    nodes: allSubNodes.filter((n) => reachableIds.has(n.id)),
    edges: allSubEdges.filter((e) => reachableIds.has(e.source) && reachableIds.has(e.target)),
    inputNode,
    outputNode,
  }
}
