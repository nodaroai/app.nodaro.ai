import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { createClient } from "@/lib/supabase"
import type { WorkflowNode, WorkflowEdge, SubWorkflowData, SubWorkflowInputData, SubWorkflowOutputData } from "@/types/nodes"
import { buildExecutionLevels, extractNodeOutput } from "./execution-graph"
import { isExecutableNode, type ExecutionContext } from "./types"
import { executeNode } from "./execute-node"
import { getListInputForNode } from "./node-input-resolver"
import { executeNodeForList } from "./list-execution"

const MAX_DEPTH = 5

/**
 * Execute a sub-workflow node.
 *
 * 1. Load the referenced workflow from Supabase
 * 2. Namespace all node IDs to avoid conflicts
 * 3. Inject inputs from parent edges
 * 4. Add namespaced nodes to the store as hidden
 * 5. Execute using the standard engine
 * 6. Extract outputs from the output node
 * 7. Clean up namespaced nodes
 * 8. Update the parent node with results
 */
export async function executeSubWorkflow(
  node: WorkflowNode,
  ctx: ExecutionContext,
  executingWorkflowIds: Set<string> = new Set(),
  depth: number = 0,
): Promise<void> {
  const { updateNodeData, nodes: parentNodes, edges: parentEdges } = useWorkflowStore.getState()
  const data = node.data as SubWorkflowData

  // Validate configuration
  if (!data.referencedWorkflowId) {
    toast.error(`Node "${data.label}": No workflow selected`)
    updateNodeData(node.id, { executionStatus: "failed", errorMessage: "No workflow selected" })
    return Promise.reject(new Error("No workflow selected"))
  }

  if (!data.routeSnapshot) {
    toast.error(`Node "${data.label}": No route configured`)
    updateNodeData(node.id, { executionStatus: "failed", errorMessage: "No route configured" })
    return Promise.reject(new Error("No route configured"))
  }

  // Depth check
  if (depth >= MAX_DEPTH) {
    toast.error(`Node "${data.label}": Maximum sub-workflow nesting depth (${MAX_DEPTH}) exceeded`)
    updateNodeData(node.id, { executionStatus: "failed", errorMessage: `Max nesting depth (${MAX_DEPTH}) exceeded` })
    return Promise.reject(new Error("Max nesting depth exceeded"))
  }

  // Cycle detection
  if (executingWorkflowIds.has(data.referencedWorkflowId)) {
    toast.error(`Node "${data.label}": Circular reference detected`)
    updateNodeData(node.id, { executionStatus: "failed", errorMessage: "Circular reference detected" })
    return Promise.reject(new Error("Circular reference detected"))
  }

  const prefix = `__sub_${node.id}_`

  try {
    // Mark as running
    updateNodeData(node.id, {
      executionStatus: "running",
      errorMessage: undefined,
      outputResults: undefined,
      generatedResults: [],
      subWorkflowProgress: { currentNode: "", completed: 0, total: 0 },
    })

    // 1. Load the referenced workflow
    const supabase = createClient()
    const { data: wfData, error } = await supabase
      .from("workflows")
      .select("id, nodes, edges")
      .eq("id", data.referencedWorkflowId)
      .single()

    if (error || !wfData) {
      throw new Error("Referenced workflow not found")
    }

    const subNodes = (wfData.nodes as unknown as WorkflowNode[]) ?? []
    const subEdges = (wfData.edges as unknown as WorkflowEdge[]) ?? []

    // Find the route's input and output nodes
    const inputNode = subNodes.find(
      (n) => n.type === "sub-workflow-input" && (n.data as SubWorkflowInputData).routeId === data.selectedRouteId,
    )
    const outputNode = subNodes.find(
      (n) => n.type === "sub-workflow-output" && (n.data as SubWorkflowOutputData).routeId === data.selectedRouteId,
    )

    if (!inputNode || !outputNode) {
      throw new Error("Route input/output nodes not found in referenced workflow")
    }

    // 2. Namespace all node IDs and edges
    const namespacedNodes: WorkflowNode[] = subNodes.map((n) => {
      let nodeData: Record<string, unknown> = { ...n.data, hidden: true }

      // Inject port values into the input node at creation time (no mutation)
      if (n.id === inputNode.id) {
        const injected: Record<string, string> = {}
        for (const port of data.routeSnapshot!.inputPorts) {
          const parentEdge = parentEdges.find(
            (e) => e.target === node.id && e.targetHandle === `in_${port.id}`,
          )
          if (!parentEdge) continue
          const sourceNode = parentNodes.find((nd) => nd.id === parentEdge.source)
          if (!sourceNode) continue
          const output = extractNodeOutput(sourceNode, parentEdge.sourceHandle ?? undefined)
          if (output) injected[port.id] = output
        }
        nodeData = {
          ...nodeData,
          __injectedPortValues: injected,
          executionStatus: "completed",
        }
      }

      return { ...n, id: `${prefix}${n.id}`, data: nodeData } as WorkflowNode
    })

    const namespacedEdges: WorkflowEdge[] = subEdges.map((e) => ({
      ...e,
      id: `${prefix}${e.id}`,
      source: `${prefix}${e.source}`,
      target: `${prefix}${e.target}`,
    }))

    const namespacedInputId = `${prefix}${inputNode.id}`

    // 3. Add namespaced nodes/edges to the store (using setState like collapseExpandedClones)
    const storeState = useWorkflowStore.getState()
    useWorkflowStore.setState({
      nodes: [...storeState.nodes, ...namespacedNodes],
      edges: [...storeState.edges, ...namespacedEdges],
    })

    // 5. Execute — build levels from the namespaced sub-graph and execute
    const subLevels = buildExecutionLevels(namespacedNodes, namespacedEdges)
    const totalNodes = subLevels.reduce(
      (sum, level) => sum + level.filter((n) => isExecutableNode(n) && n.id !== namespacedInputId).length,
      0,
    )

    updateNodeData(node.id, {
      subWorkflowProgress: { currentNode: "", completed: 0, total: totalNodes },
    })

    // Track the current workflow ID in the executing set
    const childExecutingIds = new Set(executingWorkflowIds)
    childExecutingIds.add(data.referencedWorkflowId)

    let completedCount = 0

    for (const level of subLevels) {
      const toRun = level.filter((n) => {
        // Skip the input node (already has injected values) and non-executable
        if (n.id === namespacedInputId) return false
        return isExecutableNode(n)
      })

      if (toRun.length === 0) continue

      const results = await Promise.allSettled(
        toRun.map(async (subNode) => {
          // If this is a nested sub-workflow, pass through the cycle detection
          if (subNode.type === "sub-workflow") {
            return executeSubWorkflow(subNode, ctx, childExecutingIds, depth + 1)
          }

          const { nodes: latestNodes, edges: latestEdges } = useWorkflowStore.getState()
          const listItems = getListInputForNode(subNode, latestNodes, latestEdges)
          if (listItems && listItems.length > 1) {
            return executeNodeForList(subNode, listItems, ctx)
          }
          return executeNode(subNode, ctx)
        }),
      )

      // Count all fulfilled results before checking for failures
      completedCount += results.filter((r) => r.status === "fulfilled").length
      const firstRejection = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined
      if (firstRejection) {
        throw firstRejection.reason
      }

      updateNodeData(node.id, {
        subWorkflowProgress: {
          currentNode: (toRun[toRun.length - 1]?.data as Record<string, unknown>)?.label as string ?? "",
          completed: completedCount,
          total: totalNodes,
        },
      })
    }

    // 6. Extract outputs from the namespaced output node (read from final store state, not stale original)
    const namespacedOutputId = `${prefix}${outputNode.id}`
    const outputResults: Record<string, string> = {}

    const finalState = useWorkflowStore.getState()
    const finalOutputNode = finalState.nodes.find((n) => n.id === namespacedOutputId)
    const finalOutputData = (finalOutputNode?.data ?? outputNode.data) as SubWorkflowOutputData

    for (const port of finalOutputData.ports) {
      // Find the edge that connects to this output port in the namespaced graph
      const incomingEdge = finalState.edges.find(
        (e) => e.target === namespacedOutputId && e.targetHandle === port.id,
      )
      if (!incomingEdge) continue

      const sourceNode = finalState.nodes.find((n) => n.id === incomingEdge.source)
      if (!sourceNode) continue

      const output = extractNodeOutput(sourceNode)
      if (output) {
        outputResults[port.id] = output
      }
    }

    // Build generatedResults for the visible output
    const visiblePortId = data.routeSnapshot.visibleOutputPortId
    const visibleOutput = outputResults[visiblePortId]
    const generatedResults = visibleOutput
      ? [{ url: visibleOutput, timestamp: new Date().toISOString(), jobId: "" }]
      : []

    // 7. Update the parent node with results
    updateNodeData(node.id, {
      executionStatus: "completed",
      errorMessage: undefined,
      outputResults,
      generatedResults,
      activeResultIndex: 0,
      subWorkflowProgress: { currentNode: "", completed: totalNodes, total: totalNodes },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sub-workflow execution failed"
    updateNodeData(node.id, {
      executionStatus: "failed",
      errorMessage: msg,
      subWorkflowProgress: undefined,
    })
    throw err
  } finally {
    // 8. Clean up — remove all namespaced nodes and edges
    const { nodes: allNodes, edges: allEdges } = useWorkflowStore.getState()
    useWorkflowStore.setState({
      nodes: allNodes.filter((n) => !n.id.startsWith(prefix)),
      edges: allEdges.filter((e) => !e.id.startsWith(prefix)),
    })
  }
}
