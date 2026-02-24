import type { WorkflowNode, SubWorkflowInputData, SubWorkflowOutputData, WorkflowEdge } from "@/types/nodes"

export interface DiscoveredRoute {
  readonly routeId: string
  readonly inputNode: WorkflowNode
  readonly outputNode: WorkflowNode
  readonly inputData: SubWorkflowInputData
  readonly outputData: SubWorkflowOutputData
}

/**
 * Discover all valid routes in a workflow.
 * A valid route = one sub-workflow-input + one sub-workflow-output with the same routeId.
 * Path connectivity is verified at execution time, not at discovery time,
 * so partially-wired workflows still appear in the picker.
 */
export function discoverRoutes(nodes: ReadonlyArray<WorkflowNode>): DiscoveredRoute[] {
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

    routes.push({
      routeId: inputData.routeId,
      inputNode,
      outputNode: matchingOutput,
      inputData,
      outputData: matchingOutput.data as SubWorkflowOutputData,
    })
  }

  return routes
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
