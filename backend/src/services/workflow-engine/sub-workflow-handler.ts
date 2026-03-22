/**
 * Sub-workflow handler — executes a referenced workflow recursively.
 * Ported from frontend sub-workflow-executor.ts.
 *
 * Constraints:
 * - Max depth: 5
 * - Cycle detection via workflowId:routeId tracking
 */

import { config } from "../../lib/config.js"
import { settledWithLimit } from "../../lib/settled-with-limit.js"
import { supabase } from "../../lib/supabase.js"
import {
  buildExecutionLevels,
  getEffectivelySkippedIds,
  isSourceNode,
  isSkipNode,
} from "./execution-graph.js"
import { resolveNodeInputs } from "./input-resolver.js"
import { extractSourceNodeOutput } from "./output-extractor.js"
import { executeNode } from "./node-executor.js"
import type {
  SimpleNode,
  SimpleEdge,
  NodeExecutionState,
  NodeOutput,
  OrchestratorContext,
  ResolvedInputs,
} from "./types.js"
import { MAX_SUB_WORKFLOW_DEPTH } from "./types.js"

/**
 * Execute a sub-workflow node.
 *
 * @param node - The sub-workflow node
 * @param resolvedInputs - Inputs wired from upstream nodes
 * @param ctx - Orchestrator context
 * @param depth - Current nesting depth
 * @param executingRouteKeys - Set of "workflowId:routeId" already executing (cycle detection)
 */
export async function executeSubWorkflow(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  ctx: OrchestratorContext,
  depth: number = 0,
  executingRouteKeys: Set<string> = new Set(),
): Promise<NodeOutput> {
  // Check depth limit
  if (depth >= MAX_SUB_WORKFLOW_DEPTH) {
    throw new Error(`Sub-workflow depth limit exceeded (max ${MAX_SUB_WORKFLOW_DEPTH})`)
  }

  const data = node.data
  const referencedWorkflowId = data.workflowId as string | undefined
  const routeId = (data.selectedRouteId as string) ?? "default"

  if (!referencedWorkflowId) {
    throw new Error("Sub-workflow node has no referenced workflow")
  }

  // Cycle detection
  const routeKey = `${referencedWorkflowId}:${routeId}`
  if (executingRouteKeys.has(routeKey)) {
    throw new Error(`Cycle detected in sub-workflows: ${routeKey}`)
  }
  const newRouteKeys = new Set(executingRouteKeys)
  newRouteKeys.add(routeKey)

  // Load referenced workflow
  const { data: workflow, error: wfError } = await supabase
    .from("workflows")
    .select("nodes, edges")
    .eq("id", referencedWorkflowId)
    .single()

  if (wfError || !workflow) {
    throw new Error(`Referenced workflow ${referencedWorkflowId} not found`)
  }

  let subNodes: SimpleNode[] = (workflow.nodes as SimpleNode[]) ?? []
  let subEdges: SimpleEdge[] = (workflow.edges as SimpleEdge[]) ?? []

  // Filter to reachable nodes for the selected route (if route filtering is configured)
  const routeSnapshot = data.routeSnapshot as {
    inputPorts?: Array<{ id: string; mediaType: string }>
    outputPorts?: Array<{ id: string; mediaType: string }>
    inputNodeId?: string
    outputNodeId?: string
  } | undefined

  if (routeSnapshot?.inputNodeId && routeSnapshot?.outputNodeId) {
    const reachable = getReachableNodes(
      routeSnapshot.inputNodeId,
      routeSnapshot.outputNodeId,
      subEdges,
    )
    subNodes = subNodes.filter((n) => reachable.has(n.id))
    subEdges = subEdges.filter(
      (e) => reachable.has(e.source) && reachable.has(e.target),
    )
  }

  // Initialize node states for the sub-workflow
  const nodeStates: Record<string, NodeExecutionState> = {}

  // Inject inputs from the parent into the sub-workflow input node
  for (const subNode of subNodes) {
    if (subNode.type === "sub-workflow-input") {
      // Build output from resolved inputs
      const output: NodeOutput = {}
      if (resolvedInputs.imageUrl) output.imageUrl = resolvedInputs.imageUrl
      if (resolvedInputs.videoUrl) output.videoUrl = resolvedInputs.videoUrl
      if (resolvedInputs.audioUrl) output.audioUrl = resolvedInputs.audioUrl
      if (resolvedInputs.prompt) output.text = resolvedInputs.prompt

      nodeStates[subNode.id] = {
        status: "completed",
        output,
        completedAt: new Date().toISOString(),
      }
    } else if (isSourceNode(subNode.type)) {
      const sourceOutput = extractSourceNodeOutput(subNode)
      if (sourceOutput) {
        nodeStates[subNode.id] = {
          status: "completed",
          output: sourceOutput,
          completedAt: new Date().toISOString(),
        }
      }
    }
  }

  // Build execution levels
  const levels = buildExecutionLevels(subNodes, subEdges)
  const skippedIds = getEffectivelySkippedIds(subNodes, subEdges)

  for (const nodeId of skippedIds) {
    nodeStates[nodeId] = { status: "skipped", completedAt: new Date().toISOString() }
  }

  // Execute level by level
  for (const level of levels) {
    if (ctx.cancelled) throw new Error("Execution cancelled")

    const executableNodes = level.filter((n) => {
      if (isSourceNode(n.type)) return false
      if (skippedIds.has(n.id)) return false
      if (isSkipNode(n.type)) return false
      if (nodeStates[n.id]?.status === "completed") return false
      // Recursive sub-workflow nodes are handled specially
      if (n.type === "sub-workflow") return true
      return true
    })

    const tasks = executableNodes.map((subNode) => async () => {
        nodeStates[subNode.id] = {
          status: "running",
          startedAt: new Date().toISOString(),
        }

        const inputs = resolveNodeInputs(subNode, subEdges, nodeStates, subNodes)

        let result
        if (subNode.type === "sub-workflow") {
          // Recursive sub-workflow execution
          const output = await executeSubWorkflow(
            subNode,
            inputs,
            ctx,
            depth + 1,
            newRouteKeys,
          )
          result = { output }
        } else {
          result = await executeNode(
            subNode,
            inputs,
            subEdges,
            subNodes,
            nodeStates,
            ctx,
          )
        }

        nodeStates[subNode.id] = {
          status: "completed",
          output: result.output,
          startedAt: nodeStates[subNode.id]?.startedAt,
          completedAt: new Date().toISOString(),
        }

        return result
    })
    const levelAborted = { cancelled: ctx.cancelled }
    const results = await settledWithLimit(tasks, config.MAX_CONCURRENT_NODES_PER_EXECUTION, levelAborted)

    // Check for failures
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === "rejected") {
        const error = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
        throw new Error(`Sub-workflow node ${executableNodes[i].id} failed: ${error}`)
      }
    }
  }

  // Collect outputs from the sub-workflow output node
  const output: NodeOutput = {}

  // Find the output node and collect its upstream outputs
  for (const subNode of subNodes) {
    if (subNode.type === "sub-workflow-output") {
      // Get inputs to the output node (these are the sub-workflow's outputs)
      const outputInputs = resolveNodeInputs(subNode, subEdges, nodeStates, subNodes)
      if (outputInputs.imageUrl) output.imageUrl = outputInputs.imageUrl
      if (outputInputs.videoUrl) output.videoUrl = outputInputs.videoUrl
      if (outputInputs.audioUrl) output.audioUrl = outputInputs.audioUrl
      if (outputInputs.prompt) output.text = outputInputs.prompt
    }
  }

  // Fallback: if no output node, collect from all terminal nodes
  if (!output.imageUrl && !output.videoUrl && !output.audioUrl && !output.text) {
    const terminalNodes = findTerminalNodes(subNodes, subEdges)
    for (const termNode of terminalNodes) {
      const state = nodeStates[termNode.id]
      if (state?.output) {
        if (state.output.imageUrl && !output.imageUrl) output.imageUrl = state.output.imageUrl
        if (state.output.videoUrl && !output.videoUrl) output.videoUrl = state.output.videoUrl
        if (state.output.audioUrl && !output.audioUrl) output.audioUrl = state.output.audioUrl
        if (state.output.text && !output.text) output.text = state.output.text
      }
    }
  }

  return output
}

// ---------------------------------------------------------------------------
// Graph utilities
// ---------------------------------------------------------------------------

/**
 * BFS from inputNodeId to outputNodeId, returning all reachable node IDs.
 */
function getReachableNodes(
  inputId: string,
  outputId: string,
  edges: SimpleEdge[],
): Set<string> {
  const forwardReachable = bfs(inputId, edges, "forward")
  const backwardReachable = bfs(outputId, edges, "backward")

  // Intersection
  const reachable = new Set<string>()
  for (const id of forwardReachable) {
    if (backwardReachable.has(id)) reachable.add(id)
  }

  // Always include input and output
  reachable.add(inputId)
  reachable.add(outputId)

  return reachable
}

function bfs(
  startId: string,
  edges: SimpleEdge[],
  direction: "forward" | "backward",
): Set<string> {
  const visited = new Set<string>()
  const queue = [startId]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)

    for (const edge of edges) {
      if (direction === "forward" && edge.source === current && !visited.has(edge.target)) {
        queue.push(edge.target)
      } else if (direction === "backward" && edge.target === current && !visited.has(edge.source)) {
        queue.push(edge.source)
      }
    }
  }

  return visited
}

function findTerminalNodes(
  nodes: SimpleNode[],
  edges: SimpleEdge[],
): SimpleNode[] {
  const hasOutgoing = new Set(edges.map((e) => e.source))
  return nodes.filter((n) => !hasOutgoing.has(n.id))
}
