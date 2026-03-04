/**
 * Orchestrator worker — processes workflow executions.
 * Loads workflow graph, topological sort, executes nodes level-by-level.
 *
 * Started as a separate BullMQ worker alongside video-worker and render-worker.
 */

import { Worker, type Job } from "bullmq"
import IORedis from "ioredis"
import { config } from "../lib/config.js"
import { executionEvents, type ExecutionEvent } from "../lib/execution-events.js"
import { supabase } from "../lib/supabase.js"
import {
  buildExecutionLevels,
  getEffectivelySkippedIds,
  isSourceNode,
  isSkipNode,
} from "../services/workflow-engine/execution-graph.js"
import { resolveNodeInputs } from "../services/workflow-engine/input-resolver.js"
import { extractSourceNodeOutput, extractSavedNodeOutput } from "../services/workflow-engine/output-extractor.js"
import { executeNode } from "../services/workflow-engine/node-executor.js"
import type {
  WorkflowExecutionJob,
  SimpleNode,
  SimpleEdge,
  NodeExecutionState,
  OrchestratorContext,
} from "../services/workflow-engine/types.js"
import { WORKFLOW_TIMEOUT_MS } from "../services/workflow-engine/types.js"

// ---------------------------------------------------------------------------
// Worker creation
// ---------------------------------------------------------------------------

export function createOrchestratorWorker() {
  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  })

  const worker = new Worker<WorkflowExecutionJob>(
    "workflow-orchestration",
    async (job) => {
      await processWorkflowExecution(job)
    },
    {
      connection,
      concurrency: 2,
      lockDuration: 600_000, // 10 min
      stalledInterval: 120_000, // 2 min
    },
  )

  worker.on("failed", (job, err) => {
    console.error(
      `[orchestrator] Execution ${job?.data.executionId} failed:`,
      err.message,
    )
  })

  worker.on("completed", (job) => {
    console.log(
      `[orchestrator] Execution ${job.data.executionId} completed`,
    )
  })

  return worker
}

// ---------------------------------------------------------------------------
// Main execution loop
// ---------------------------------------------------------------------------

async function processWorkflowExecution(job: Job<WorkflowExecutionJob>): Promise<void> {
  const { executionId, workflowId, userId, triggerType, triggerData, nodeIds, inputOverrides } = job.data
  const nodeSubset = nodeIds ? new Set(nodeIds) : null

  const ctx: OrchestratorContext = {
    executionId,
    workflowId,
    userId,
    triggerType,
    triggerData,
    cancelled: false,
  }

  try {
    // 1. Load workflow from DB
    const { data: workflow, error: wfError } = await supabase
      .from("workflows")
      .select("nodes, edges, settings")
      .eq("id", workflowId)
      .single()

    if (wfError || !workflow) {
      await failExecution(executionId, `Workflow ${workflowId} not found`)
      return
    }

    const nodes: SimpleNode[] = (workflow.nodes as SimpleNode[]) ?? []
    const edges: SimpleEdge[] = (workflow.edges as SimpleEdge[]) ?? []

    // Pass workflow settings (character definitions, prompt templates) to context
    ctx.workflowSettings = (workflow.settings as Record<string, unknown>) ?? {}

    // Apply presentation mode input overrides to source node data
    if (inputOverrides) {
      for (const node of nodes) {
        const overrides = inputOverrides[node.id]
        if (overrides) {
          node.data = { ...node.data, ...overrides }
        }
      }
    }

    if (nodes.length === 0) {
      await failExecution(executionId, "Workflow has no nodes")
      return
    }

    // 2. Initialize node states
    const nodeStates: Record<string, NodeExecutionState> = {}

    // Surface jobId on running nodes as soon as the job is created,
    // so the execution list can open the job modal before completion.
    ctx.onJobCreated = (nodeId, jobId) => {
      if (nodeStates[nodeId]) {
        nodeStates[nodeId].jobId = jobId
      }
      // Persist to DB so polling clients also see the jobId
      updateExecution(executionId, { node_states: nodeStates }).catch(() => {})
      emitExecutionEvent({
        type: "node:updated",
        executionId,
        nodeStates: { ...nodeStates },
        nodeId,
      })
    }

    // 3. Inject source node outputs + pre-complete nodes outside the subset
    for (const node of nodes) {
      if (isSourceNode(node.type)) {
        const output = extractSourceNodeOutput(node, triggerData)
        if (output) {
          nodeStates[node.id] = {
            status: "completed",
            output,
            completedAt: new Date().toISOString(),
          }
        }
      } else if (nodeSubset && !nodeSubset.has(node.id)) {
        // Node is outside the requested subset — treat as pre-completed
        // so downstream nodes can resolve inputs from its saved data.
        // Try extracting saved results from node data (e.g. generatedImageUrl)
        // which the frontend stores after each manual run.
        const output = extractSavedNodeOutput(node) ?? extractSourceNodeOutput(node, triggerData)
        nodeStates[node.id] = {
          status: "completed",
          output: output ?? undefined,
          completedAt: new Date().toISOString(),
        }
      }
    }

    // 4. Build execution levels (topological sort)
    const levels = buildExecutionLevels(nodes, edges)

    // 5. Compute effectively skipped node IDs
    const skippedIds = getEffectivelySkippedIds(nodes, edges)

    // Mark skipped nodes
    for (const nodeId of skippedIds) {
      nodeStates[nodeId] = {
        status: "skipped",
        completedAt: new Date().toISOString(),
      }
    }

    // Initialize all executable nodes as "pending" so they appear in the UI immediately
    const executableNodes = nodes.filter((n) => {
      if (isSourceNode(n.type)) return false
      if (isSkipNode(n.type)) return false
      if (skippedIds.has(n.id)) return false
      if (nodeSubset && !nodeSubset.has(n.id)) return false
      return true
    })

    for (const node of executableNodes) {
      if (!nodeStates[node.id]) {
        nodeStates[node.id] = {
          status: "pending",
          nodeType: node.type,
        }
      }
    }

    // 6. Update execution to running with accurate node count
    await supabase
      .from("workflow_executions")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        total_nodes: executableNodes.length,
        node_states: nodeStates,
      })
      .eq("id", executionId)

    emitExecutionEvent({
      type: "execution:started",
      executionId,
      nodeStates: { ...nodeStates },
      totalNodes: executableNodes.length,
      completedNodes: 0,
      failedNodes: 0,
    })

    // 7. Execute level by level
    let completedCount = 0
    let failedCount = 0
    let totalCredits = 0
    const startTime = Date.now()

    for (const level of levels) {
      // Check workflow timeout
      if (Date.now() - startTime > WORKFLOW_TIMEOUT_MS) {
        await failExecution(executionId, "Workflow execution timed out", nodeStates)
        return
      }

      // Check cancellation / stopping
      const controlStatus = await checkExecutionControl(executionId)
      if (controlStatus === "cancelled") {
        ctx.cancelled = true
        await updateExecution(executionId, {
          status: "cancelled",
          node_states: nodeStates,
          completed_at: new Date().toISOString(),
        })
        emitExecutionEvent({
          type: "execution:cancelled",
          executionId,
          nodeStates: { ...nodeStates },
          completedNodes: completedCount,
          failedNodes: failedCount,
          totalCreditsUsed: totalCredits,
        })
        return
      }
      if (controlStatus === "stopping") {
        // "Stop after current" — don't start this level, mark as cancelled
        ctx.cancelled = true
        await updateExecution(executionId, {
          status: "cancelled",
          node_states: nodeStates,
          completed_at: new Date().toISOString(),
        })
        emitExecutionEvent({
          type: "execution:cancelled",
          executionId,
          nodeStates: { ...nodeStates },
          completedNodes: completedCount,
          failedNodes: failedCount,
          totalCreditsUsed: totalCredits,
        })
        return
      }

      // Filter to executable nodes (not source, not skipped, not already done)
      const executableNodes = level.filter((node) => {
        if (isSourceNode(node.type)) return false
        if (skippedIds.has(node.id)) return false
        if (isSkipNode(node.type)) return false
        if (nodeStates[node.id]?.status === "completed") return false
        return true
      })

      if (executableNodes.length === 0) continue

      // Execute all nodes in this level in parallel
      const results = await Promise.allSettled(
        executableNodes.map(async (node) => {
          // Mark as running
          nodeStates[node.id] = {
            status: "running",
            nodeType: node.type,
            startedAt: new Date().toISOString(),
          }
          await updateExecution(executionId, { node_states: nodeStates })
          emitExecutionEvent({
            type: "node:updated",
            executionId,
            nodeStates: { ...nodeStates },
            nodeId: node.id,
            completedNodes: completedCount,
            failedNodes: failedCount,
          })

          // Resolve inputs from upstream
          const inputs = resolveNodeInputs(
            node,
            edges,
            nodeStates,
            nodes,
            triggerData,
          )

          // Execute
          const result = await executeNode(
            node,
            inputs,
            edges,
            nodes,
            nodeStates,
            ctx,
          )

          // Update state
          nodeStates[node.id] = {
            status: "completed",
            nodeType: node.type,
            output: result.output,
            jobId: result.jobId,
            usageLogId: result.usageLogId,
            creditsUsed: result.creditsUsed,
            startedAt: nodeStates[node.id]?.startedAt,
            completedAt: new Date().toISOString(),
          }

          completedCount++
          totalCredits += result.creditsUsed ?? 0

          emitExecutionEvent({
            type: "node:updated",
            executionId,
            nodeStates: { ...nodeStates },
            nodeId: node.id,
            completedNodes: completedCount,
            failedNodes: failedCount,
            totalCreditsUsed: totalCredits,
          })

          return result
        }),
      )

      // Check for failures
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        const node = executableNodes[i]

        if (result.status === "rejected") {
          const error = result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)

          nodeStates[node.id] = {
            status: "failed",
            nodeType: node.type,
            error,
            startedAt: nodeStates[node.id]?.startedAt,
            completedAt: new Date().toISOString(),
          }

          failedCount++
          emitExecutionEvent({
            type: "node:updated",
            executionId,
            nodeStates: { ...nodeStates },
            nodeId: node.id,
            completedNodes: completedCount,
            failedNodes: failedCount,
          })
          console.error(
            `[orchestrator] Node ${node.id} (${node.type}) failed:`,
            error,
          )
        }
      }

      // Persist state after each level
      await updateExecution(executionId, {
        node_states: nodeStates,
        completed_nodes: completedCount,
        failed_nodes: failedCount,
        total_credits_used: totalCredits,
      })

      emitExecutionEvent({
        type: "level:completed",
        executionId,
        nodeStates: { ...nodeStates },
        completedNodes: completedCount,
        failedNodes: failedCount,
        totalCreditsUsed: totalCredits,
      })

      // If any node failed, stop execution
      if (failedCount > 0) {
        const failedNodeErrors = Object.entries(nodeStates)
          .filter(([, s]) => s.status === "failed")
          .map(([id, s]) => `${id}: ${s.error}`)
          .join("; ")

        await failExecution(
          executionId,
          `Node execution failed: ${failedNodeErrors}`,
          nodeStates,
          completedCount,
          failedCount,
          totalCredits,
        )
        return
      }
    }

    // 8. Mark execution completed
    await updateExecution(executionId, {
      status: "completed",
      node_states: nodeStates,
      completed_nodes: completedCount,
      failed_nodes: 0,
      total_credits_used: totalCredits,
      completed_at: new Date().toISOString(),
    })

    emitExecutionEvent({
      type: "execution:completed",
      executionId,
      nodeStates: { ...nodeStates },
      completedNodes: completedCount,
      failedNodes: 0,
      totalCreditsUsed: totalCredits,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[orchestrator] Execution ${executionId} error:`, message)
    await failExecution(executionId, message)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function failExecution(
  executionId: string,
  errorMessage: string,
  nodeStates?: Record<string, NodeExecutionState>,
  completedNodes?: number,
  failedNodes?: number,
  totalCredits?: number,
): Promise<void> {
  const updates: Record<string, unknown> = {
    status: "failed",
    error_message: errorMessage,
    completed_at: new Date().toISOString(),
  }
  if (nodeStates) updates.node_states = nodeStates
  if (completedNodes !== undefined) updates.completed_nodes = completedNodes
  if (failedNodes !== undefined) updates.failed_nodes = failedNodes
  if (totalCredits !== undefined) updates.total_credits_used = totalCredits

  await supabase
    .from("workflow_executions")
    .update(updates)
    .eq("id", executionId)

  emitExecutionEvent({
    type: "execution:failed",
    executionId,
    nodeStates: nodeStates ? { ...nodeStates } : {},
    completedNodes,
    failedNodes,
    totalCreditsUsed: totalCredits,
    errorMessage,
  })
}

async function updateExecution(
  executionId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from("workflow_executions")
    .update(updates)
    .eq("id", executionId)
}

function emitExecutionEvent(event: ExecutionEvent): void {
  try {
    executionEvents.emit(event.executionId, event)
  } catch {
    // Never let event emission break the orchestrator
  }
}

async function checkExecutionControl(executionId: string): Promise<"running" | "cancelled" | "stopping"> {
  const { data } = await supabase
    .from("workflow_executions")
    .select("status")
    .eq("id", executionId)
    .single()

  if (data?.status === "cancelled") return "cancelled"
  if (data?.status === "stopping") return "stopping"
  return "running"
}
