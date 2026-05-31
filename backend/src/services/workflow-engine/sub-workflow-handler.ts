/**
 * Sub-workflow handler — executes a referenced workflow recursively.
 * Ported from frontend sub-workflow-executor.ts.
 *
 * Constraints:
 * - Max depth: 5
 * - Cycle detection via workflowId:routeId tracking
 */

import { PARAMETER_NODE_TYPES, getParameterPromptHint } from "@nodaro/shared"
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
import { normalizeLegacyNodeTypes } from "./normalize-node-types.js"
import { extractSourceNodeOutput, getPrimaryOutput } from "./output-extractor.js"
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
 * Prepare a referenced workflow's raw nodes for sub-workflow execution.
 *
 * Runs the shared legacy-type migration (`normalizeLegacyNodeTypes` — the single
 * source of truth, incl. edit-image/image-to-image/old-collect AND loop → list).
 * The helper preserves every field it doesn't rewrite, `parentId` included, so
 * group children keep their parent inside the sub-workflow execution graph
 * without any extra re-threading. Non-mutating (the helper copies on rewrite and
 * passes untouched nodes through by reference). Exported for direct regression
 * testing of the per-node normalization.
 */
export function prepareSubWorkflowNodes(
  rawNodes: ReadonlyArray<SimpleNode>,
): SimpleNode[] {
  return normalizeLegacyNodeTypes(rawNodes)
}

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

  // Load referenced workflow. `supabase` here is the service-role client
  // (bypasses RLS) and the node's workflowId is user-controlled, so we must
  // scope by owner to prevent referencing arbitrary workflows (IDOR).
  //
  // Scope to `ctx.workflowOwnerId` when set: sub-workflow references point at
  // workflows owned by the *author* of the containing workflow, which can
  // differ from `ctx.userId` for shared-workflow presentation runs (viewer
  // pays) and app runs (creator's snapshot, runner's identity). Fall back to
  // `ctx.userId` when owner is unknown so legacy callers stay protected.
  const ownerId = ctx.workflowOwnerId ?? ctx.userId
  const { data: workflow, error: wfError } = await supabase
    .from("workflows")
    .select("nodes, edges")
    .eq("id", referencedWorkflowId)
    .eq("user_id", ownerId)
    .single()

  if (wfError || !workflow) {
    throw new Error(`Referenced workflow ${referencedWorkflowId} not found`)
  }

  // Migrate legacy node types before processing, via the shared helper (single
  // source of truth). Re-threads parentId so group children flow into the
  // sub-workflow execution graph — see prepareSubWorkflowNodes.
  let subNodes: SimpleNode[] = prepareSubWorkflowNodes((workflow.nodes as SimpleNode[]) ?? [])
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
    } else if (subNode.type && PARAMETER_NODE_TYPES.has(subNode.type)) {
      // Parameter pickers (mood, action-fx, lens, person, etc.) emit a prompt
      // fragment via FieldMappings — they have no executable handler. Mirror the
      // main orchestrator: pre-complete them so they never reach executeNode
      // (which would create a stale jobs row → buildPayload throw "Unknown node
      // type" → fail the whole sub-workflow), while still exposing their hint.
      const hint = getParameterPromptHint(subNode)
      nodeStates[subNode.id] = {
        status: "completed",
        output: hint ? { text: hint } : {},
        completedAt: new Date().toISOString(),
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
      // Parameter pickers are pre-completed above and have no job handler.
      if (n.type && PARAMETER_NODE_TYPES.has(n.type)) return false
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

  // Collect outputs from the sub-workflow output node.
  //
  // Emits BOTH:
  //   - `_outputResults: Record<portId, value>` for handle-based downstream
  //     routing via `out_{portId}` (matches frontend behaviour — without this,
  //     per-port routing on backend-run sub-workflows was broken)
  //   - `_visibleOutputPortId` so output-extractor's fallback picks the
  //     user-selected visible port when no specific `out_{portId}` handle is
  //     wired downstream
  //   - Flat `{imageUrl, videoUrl, audioUrl, text}` for legacy callers and
  //     for the final execution-result collection
  const output: NodeOutput = {}
  const outputResults: Record<string, string> = {}
  let visiblePortId: string | undefined

  for (const subNode of subNodes) {
    if (subNode.type !== "sub-workflow-output") continue
    const outNodeData = subNode.data as Record<string, unknown>
    const ports = (outNodeData.ports as Array<{ id: string }> | undefined) ?? []
    if (!visiblePortId) {
      visiblePortId = outNodeData.visibleOutputPortId as string | undefined
    }

    for (const port of ports) {
      const incomingEdge = subEdges.find(
        (e) => e.target === subNode.id && e.targetHandle === port.id,
      )
      if (!incomingEdge) continue
      const srcNode = subNodes.find((n) => n.id === incomingEdge.source)
      if (!srcNode) continue
      const srcState = nodeStates[srcNode.id]
      if (!srcState?.output) continue
      const value = getPrimaryOutput(srcState.output, srcNode.type, incomingEdge.sourceHandle)
      if (value) outputResults[port.id] = value
    }

    // Also fill the flat NodeOutput slots from the output node's upstream
    // inputs, so callers that consume the sub-workflow without a port-handle
    // (legacy path + fallback) still see a typed media URL.
    const outputInputs = resolveNodeInputs(subNode, subEdges, nodeStates, subNodes)
    if (outputInputs.imageUrl && !output.imageUrl) output.imageUrl = outputInputs.imageUrl
    if (outputInputs.videoUrl && !output.videoUrl) output.videoUrl = outputInputs.videoUrl
    if (outputInputs.audioUrl && !output.audioUrl) output.audioUrl = outputInputs.audioUrl
    if (outputInputs.prompt && !output.text) output.text = outputInputs.prompt
  }

  if (Object.keys(outputResults).length > 0) {
    output._outputResults = outputResults
    if (visiblePortId && outputResults[visiblePortId]) {
      output._visibleOutputPortId = visiblePortId
    }
  }

  // Fallback: if no output node was found, collect from all terminal nodes
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
