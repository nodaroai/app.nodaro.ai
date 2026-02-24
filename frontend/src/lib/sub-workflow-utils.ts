import type { WorkflowNode, WorkflowEdge, SubWorkflowInputData, SubWorkflowOutputData } from "@/types/nodes"

export interface DiscoveredRoute {
  readonly routeId: string
  readonly inputNode: WorkflowNode
  readonly outputNode: WorkflowNode
  readonly inputData: SubWorkflowInputData
  readonly outputData: SubWorkflowOutputData
}

/**
 * Discover all valid routes in a workflow.
 * A valid route = one sub-workflow-input + one sub-workflow-output with the same routeId,
 * and a directed path exists between them.
 */
export function discoverRoutes(nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): DiscoveredRoute[] {
  const inputNodes = nodes.filter((n) => n.type === "sub-workflow-input")
  const outputNodes = nodes.filter((n) => n.type === "sub-workflow-output")

  const routes: DiscoveredRoute[] = []

  for (const inputNode of inputNodes) {
    const inputData = inputNode.data as SubWorkflowInputData
    if (!inputData.routeId) continue

    const matchingOutput = outputNodes.find((n) => {
      const od = n.data as SubWorkflowOutputData
      return od.routeId === inputData.routeId
    })
    if (!matchingOutput) continue

    // Verify directed path exists via BFS
    if (hasPath(inputNode.id, matchingOutput.id, edges)) {
      routes.push({
        routeId: inputData.routeId,
        inputNode,
        outputNode: matchingOutput,
        inputData,
        outputData: matchingOutput.data as SubWorkflowOutputData,
      })
    }
  }

  return routes
}

/**
 * BFS to check if a directed path exists from sourceId to targetId.
 */
function hasPath(
  sourceId: string,
  targetId: string,
  edges: ReadonlyArray<WorkflowEdge>,
): boolean {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const list = adjacency.get(edge.source) ?? []
    list.push(edge.target)
    adjacency.set(edge.source, list)
  }

  const visited = new Set<string>()
  const queue = [sourceId]
  visited.add(sourceId)

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === targetId) return true

    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        queue.push(neighbor)
      }
    }
  }

  return false
}

/**
 * Detect cyclic reference: would adding targetWorkflowId as a sub-workflow
 * create a cycle? Uses a loader function to fetch workflow data.
 */
export async function detectCyclicReference(
  currentWorkflowId: string,
  targetWorkflowId: string,
  loader: (workflowId: string) => Promise<{ nodes: WorkflowNode[]; edges: WorkflowEdge[] } | null>,
  visited: Set<string> = new Set(),
): Promise<boolean> {
  if (currentWorkflowId === targetWorkflowId) return true
  if (visited.has(targetWorkflowId)) return false

  visited.add(targetWorkflowId)

  const workflow = await loader(targetWorkflowId)
  if (!workflow) return false

  // Check all sub-workflow nodes in the target
  const subWorkflowNodes = workflow.nodes.filter((n) => n.type === "sub-workflow")
  for (const node of subWorkflowNodes) {
    const data = node.data as Record<string, unknown>
    const refId = data.referencedWorkflowId as string
    if (!refId) continue

    if (await detectCyclicReference(currentWorkflowId, refId, loader, visited)) {
      return true
    }
  }

  return false
}
