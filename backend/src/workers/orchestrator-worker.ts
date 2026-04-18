/**
 * Orchestrator worker — processes workflow executions.
 * Loads workflow graph, topological sort, executes nodes level-by-level.
 *
 * Started as a separate BullMQ worker alongside video-worker and render-worker.
 */

import { Worker, type Job } from "bullmq"
import IORedis from "ioredis"
import { config, hasCredits } from "../lib/config.js"
import { TIER_PARALLELISM } from "../billing/stripe-config.js"
import { executionEvents, type ExecutionEvent } from "../lib/execution-events.js"
import { supabase } from "../lib/supabase.js"
import {
  buildExecutionLevels,
  getEffectivelySkippedIds,
  getUploadDescendantIds,
  computeRouterGatedIds,
  isSourceNode,
  isSkipNode,
} from "../services/workflow-engine/execution-graph.js"
import { resolveNodeInputs, getListInputForNode } from "../services/workflow-engine/input-resolver.js"
import { extractSourceNodeOutput, extractSavedNodeOutput } from "../services/workflow-engine/output-extractor.js"
import { executeNode, type ExecuteNodeResult } from "../services/workflow-engine/node-executor.js"
import type {
  WorkflowExecutionJob,
  SimpleNode,
  SimpleEdge,
  NodeExecutionState,
  NodeOutput,
  ResolvedInputs,
  OrchestratorContext,
} from "../services/workflow-engine/types.js"
import { WORKFLOW_TIMEOUT_MS } from "../services/workflow-engine/types.js"
import { filterCloneNodes } from "../../../packages/shared/src/clone-utils.js"
import { migrateEdgeOutputMode } from "../../../packages/shared/src/edge-range.js"
import { REPEAT_PLACEHOLDER, getEffectiveRepeatCount, REPEATABLE_NODE_TYPES, expandItemsWithRepeat } from "../../../packages/shared/src/repeat-types.js"
import { buildStatsKey, upsertExecutionStats } from "../services/execution-stats.js"
import { settledWithLimit } from "../lib/settled-with-limit.js"
import { calculateMonetizationMarkup } from "../../../packages/shared/src/monetization.js"

/** Env-var ceiling — tier limits are capped by this. */
const MAX_CONCURRENT_NODES_CEILING = config.MAX_CONCURRENT_NODES_PER_EXECUTION

/** Resolve per-execution parallelism limit from user tier (cloud) or env ceiling (self-hosted). */
function getParallelismLimit(tier: string | undefined): number {
  if (!hasCredits()) return MAX_CONCURRENT_NODES_CEILING
  const tierLimit = TIER_PARALLELISM[tier ?? "free"] ?? TIER_PARALLELISM.free
  return Math.min(tierLimit, MAX_CONCURRENT_NODES_CEILING)
}

// ---------------------------------------------------------------------------
// Stale execution cleanup
// ---------------------------------------------------------------------------

/**
 * On startup, reconcile executions that were in flight when the previous
 * process exited (e.g. Railway redeploy). The old behavior unconditionally
 * marked every "running" execution as failed — with frequent redeploys,
 * that turned successful runs into "Execution interrupted by orchestrator
 * restart" failures even when the node jobs had already completed.
 *
 * New behavior:
 *   1. If all nodes in node_states are already "completed" → mark the
 *      execution completed. The per-node work is done; only the final
 *      execution-level status write was lost to the restart.
 *   2. Otherwise, leave the execution alone. BullMQ's stalled-job detector
 *      will re-pick the orchestration job within `stalledInterval` and
 *      another worker will resume it. We only mark as failed if the
 *      execution has been "running" for much longer than any job could
 *      reasonably take (safety net for truly abandoned rows).
 */
const STALE_EXECUTION_THRESHOLD_MS = 4 * 60 * 60 * 1000 // 4 hours

async function cleanupStaleExecutions(): Promise<void> {
  const { data: rows, error } = await supabase
    .from("workflow_executions")
    .select("id, started_at, node_states")
    .in("status", ["running", "stopping"])

  if (error || !rows || rows.length === 0) return

  let reconciled = 0
  let abandoned = 0
  const now = Date.now()

  for (const row of rows) {
    const states = (row.node_states ?? {}) as Record<string, { status?: string }>
    const nodeStatuses = Object.values(states).map((s) => s?.status)
    const allCompleted = nodeStatuses.length > 0 && nodeStatuses.every((s) => s === "completed" || s === "skipped")

    if (allCompleted) {
      // .neq("status", "cancelled") to avoid the same overwrite race during
      // stale-execution reconciliation: row was selected with status="running"
      // but the user could cancel between SELECT and this UPDATE.
      await supabase
        .from("workflow_executions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .neq("status", "cancelled")
      reconciled++
      continue
    }

    // Only mark as failed if this row is *really* stale — otherwise let
    // BullMQ's stalled-job retry pick it back up.
    // .neq("status", "cancelled") to avoid overwriting a user cancellation.
    const startedAt = row.started_at ? new Date(row.started_at).getTime() : 0
    if (startedAt > 0 && now - startedAt > STALE_EXECUTION_THRESHOLD_MS) {
      await supabase
        .from("workflow_executions")
        .update({
          status: "failed",
          error_message: "Execution abandoned — no active orchestrator worker",
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .neq("status", "cancelled")
      abandoned++
    }
  }

  if (reconciled > 0 || abandoned > 0) {
    console.log(`[orchestrator] Startup reconcile: ${reconciled} completed, ${abandoned} abandoned, ${rows.length - reconciled - abandoned} left for retry`)
  }
}

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
      concurrency: config.ORCHESTRATOR_CONCURRENCY,
      lockDuration: 3_600_000, // 60 min — must match WORKFLOW_TIMEOUT_MS to prevent stalled-job retries
      stalledInterval: 900_000, // 15 min
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

  // Clean up orphaned executions from previous crash before processing new ones
  cleanupStaleExecutions().catch((err) => {
    console.error("[orchestrator] Failed to clean up stale executions:", err)
  })

  return worker
}

// ---------------------------------------------------------------------------
// Main execution loop
// ---------------------------------------------------------------------------

async function processWorkflowExecution(job: Job<WorkflowExecutionJob>): Promise<void> {
  const { executionId, workflowId, userId, triggerType, triggerData, nodeIds, inputOverrides, appVersionId } = job.data
  const nodeSubset = nodeIds ? new Set(nodeIds) : null

  const ctx: OrchestratorContext = {
    executionId,
    workflowId,
    userId,
    triggerType,
    triggerData,
    cancelled: false,
    isAppRun: !!appVersionId,
    componentDepth: job.data.componentDepth ?? 0,
    executingComponentIds: job.data.executingComponentIds ?? [],
  }

  try {
    // 1. Load workflow from DB (or from published app snapshot if running a specific version)
    let workflowData: { nodes: unknown; edges: unknown; settings: unknown } | null = null

    if (appVersionId) {
      const { data: appVersion, error: appError } = await supabase
        .from("published_apps")
        .select("snapshot_nodes, snapshot_edges, snapshot_settings")
        .eq("id", appVersionId)
        .single()

      if (!appError && appVersion) {
        workflowData = {
          nodes: appVersion.snapshot_nodes,
          edges: appVersion.snapshot_edges,
          settings: appVersion.snapshot_settings,
        }
      }
    }

    if (!workflowData) {
      const { data: workflow, error: wfError } = await supabase
        .from("workflows")
        .select("nodes, edges, settings")
        .eq("id", workflowId)
        .single()

      if (wfError || !workflow) {
        await failExecution(executionId, `Workflow ${workflowId} not found`)
        return
      }
      workflowData = workflow
    }

    // Migrate legacy image node types (edit-image → modify/upscale/remove-background, image-to-image → modify)
    const rawNodes = (workflowData.nodes as (SimpleNode & { hidden?: boolean })[]) ?? []
    const allNodes = rawNodes.map(node => {
      if (node.type === "edit-image") {
        const provider = (node.data as Record<string, unknown> | undefined)?.provider as string | undefined
        if (provider === "nano-banana-edit") return { ...node, type: "modify-image" }
        if (provider === "recraft-remove-bg") return { ...node, type: "remove-background" }
        return { ...node, type: "upscale-image" }
      }
      if (node.type === "image-to-image") return { ...node, type: "modify-image" }
      return node
    })

    // Filter out hidden nodes (from loop expansion) and expanded clones that were persisted
    const allEdges: SimpleEdge[] = ((workflowData.edges as SimpleEdge[]) ?? []).map(e => ({
      ...e,
      data: migrateEdgeOutputMode(e.data as Record<string, unknown> | undefined),
    }))
    const cleaned = filterCloneNodes(allNodes, allEdges)
    // Also filter nodes still marked hidden after clone cleanup
    const nodes: SimpleNode[] = cleaned.nodes.filter((n) => !(n as { hidden?: boolean }).hidden)
    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges = cleaned.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

    // Pass workflow settings (character definitions, prompt templates) to context
    // Load user-level prompt templates and tier from profiles
    const { data: userProfile } = await supabase
      .from("profiles")
      .select("prompt_templates, tier")
      .eq("id", userId)
      .single()

    const concurrencyLimit = getParallelismLimit(userProfile?.tier)

    ctx.workflowSettings = {
      ...((workflowData.settings as Record<string, unknown>) ?? {}),
      ...(userProfile?.prompt_templates ? { userPromptTemplates: userProfile.prompt_templates } : {}),
    }

    // Apply presentation mode input overrides to source node data.
    // CRITICAL: also clear stale generatedResults/generatedImageUrl from the
    // workflow snapshot so that extractSourceNodeOutput / extractSavedNodeOutput
    // never prefer a stale snapshot result over the user's fresh input.
    if (inputOverrides) {
      for (const node of nodes) {
        const overrides = inputOverrides[node.id]
        if (overrides) {
          const cleaned = { ...node.data, ...overrides }
          delete cleaned.generatedResults
          delete cleaned.activeResultIndex
          delete cleaned.generatedImageUrl
          delete cleaned.generatedVideoUrl
          delete cleaned.generatedAudioUrl
          delete cleaned.generatedText
          node.data = cleaned
        }
      }
    }

    if (nodes.length === 0) {
      await failExecution(executionId, "Workflow has no nodes")
      return
    }

    // 2. Initialize node states
    const nodeStates: Record<string, NodeExecutionState> = {}
    // Jobs → owning node. Fan-out creates one job per iteration, so the
    // scalar nodeStates[node].jobId field would only remember the last one
    // and onJobProgress couldn't find earlier iterations.
    const jobToNodeId = new Map<string, string>()

    // Surface jobId on running nodes as soon as the job is created,
    // so the execution list can open the job modal before completion.
    ctx.onJobCreated = (nodeId, jobId) => {
      jobToNodeId.set(jobId, nodeId)
      const state = nodeStates[nodeId]
      if (state) {
        // Scalar .jobId is "last created" — arbitrary under fan-out; the
        // executions UI falls back to jobIds[] when iterationTotal > 1.
        state.jobId = jobId
        ;(state.jobIds ??= []).push(jobId)
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

    // Surface job progress to nodeStates so the UI can render a progress bar
    // during backend runs. For fan-out, iteration counts (iterationCompleted/
    // iterationTotal) drive the UI instead of a single progress %.
    ctx.onJobProgress = (jobId, progress) => {
      const nodeId = jobToNodeId.get(jobId)
      if (!nodeId || !nodeStates[nodeId]) return
      if ((nodeStates[nodeId].iterationTotal ?? 0) > 1) return
      const prev = nodeStates[nodeId].progress
      if (prev === progress) return
      nodeStates[nodeId].progress = progress
      emitExecutionEvent({
        type: "node:updated",
        executionId,
        nodeStates: { ...nodeStates },
        nodeId,
      })
    }

    // 3. Inject source node outputs + pre-complete nodes outside the subset
    //    Also handle skipped/frozen nodes — they keep their saved output
    //    so downstream nodes can resolve inputs from them.
    const skippedIds = getEffectivelySkippedIds(nodes, edges)

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
      } else if (skippedIds.has(node.id)) {
        // Skipped = frozen: don't re-execute, but preserve saved output
        // so downstream nodes can still resolve inputs from this node.
        const output = extractSavedNodeOutput(node) ?? extractSourceNodeOutput(node, triggerData)
        nodeStates[node.id] = {
          status: "completed",
          output: output ?? undefined,
          completedAt: new Date().toISOString(),
        }
      } else if (nodeSubset && !nodeSubset.has(node.id)) {
        // Node is outside the requested subset — treat as pre-completed
        // so downstream nodes can resolve inputs from its saved data.
        const output = extractSavedNodeOutput(node) ?? extractSourceNodeOutput(node, triggerData)
        nodeStates[node.id] = {
          status: "completed",
          output: output ?? undefined,
          completedAt: new Date().toISOString(),
        }
      }
    }

    // 4. Build execution levels (topological sort)
    //    Pass pre-resolved node IDs so their outgoing edges don't create
    //    execution-level barriers.  This lets downstream nodes whose only
    //    dependencies are source/skipped/pre-completed nodes run earlier
    //    (in parallel with unrelated nodes at the same level).
    const preResolvedNodeIds = new Set(
      Object.entries(nodeStates)
        .filter(([, s]) => s.status === "completed")
        .map(([id]) => id),
    )
    const levels = buildExecutionLevels(nodes, edges, preResolvedNodeIds)

    // Compute nodes downstream of upload-* nodes — their jobs should be force_private
    ctx.uploadDescendantIds = getUploadDescendantIds(nodes, edges)

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

    // 5b. Pre-scan for fan-out to get accurate initial total_nodes.
    //     Source node outputs are already in nodeStates, so direct fan-out
    //     from list/loop nodes can be detected. Transitive fan-out (through
    //     text-prompts) is also detected since getListInputForNode handles it.
    let totalExecutions = executableNodes.length
    for (const node of executableNodes) {
      const listItems = getListInputForNode(
        node,
        edges,
        nodeStates,
        nodes,
        triggerData,
      )
      const repeatCount = REPEATABLE_NODE_TYPES.has(node.type)
        ? getEffectiveRepeatCount(node.data as Record<string, unknown>)
        : 1

      if (listItems && listItems.length > 1) {
        const expandedCount = listItems.length * repeatCount
        totalExecutions += expandedCount - 1
      } else if (repeatCount > 1) {
        totalExecutions += repeatCount - 1
      }
    }

    // 6. Update execution to running with accurate node count
    await supabase
      .from("workflow_executions")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        total_nodes: totalExecutions,
        node_states: nodeStates,
      })
      .eq("id", executionId)

    emitExecutionEvent({
      type: "execution:started",
      executionId,
      nodeStates: { ...nodeStates },
      totalNodes: totalExecutions,
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

      // Recompute router-gated nodes before each level (dynamic — depends on
      // which router nodes have completed and their active/inactive routes).
      const routerGatedIds = computeRouterGatedIds(nodes, edges, nodeStates)

      // Mark router-gated nodes as "skipped" so the UI reflects they were gated.
      // Also count them as completed so the progress bar stays accurate.
      for (const node of level) {
        if (routerGatedIds.has(node.id) && nodeStates[node.id]?.status !== "completed") {
          nodeStates[node.id] = {
            status: "skipped",
            nodeType: node.type,
            completedAt: new Date().toISOString(),
          }
          completedCount++
        }
      }

      // Filter to executable nodes (not source, not skipped, not gated, not already done)
      const executableNodes = level.filter((node) => {
        if (isSourceNode(node.type)) return false
        if (skippedIds.has(node.id)) return false
        if (isSkipNode(node.type)) return false
        if (routerGatedIds.has(node.id)) return false
        if (nodeStates[node.id]?.status === "completed") return false
        return true
      })

      if (executableNodes.length === 0) continue

      // Execute nodes in this level with concurrency cap to prevent starving other users
      const tasks = executableNodes.map((node) => async () => {
          // Mark as running — for component nodes, use the component's label as display name
          const displayType = node.type === "component"
            ? (node.data as Record<string, unknown>).label as string || "Component"
            : node.type
          nodeStates[node.id] = {
            status: "running",
            nodeType: displayType,
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

          // Check for list fan-out input
          const listItems = getListInputForNode(
            node,
            edges,
            nodeStates,
            nodes,
            triggerData,
          )

          const expanded = expandItemsWithRepeat(
            listItems, node.type, node.data as Record<string, unknown>,
          )

          let result: ExecuteNodeResult

          if (expanded) {
            // Per-iteration progress callback — persist to DB so polling works.
            // Only write completed_nodes (not node_states) to avoid a race where
            // this fire-and-forget write arrives after the level-end persist and
            // overwrites the completed node state with a stale "running" snapshot.
            const onIterationProgress = () => {
              completedCount++
              updateExecution(executionId, {
                completed_nodes: completedCount,
              }).catch(() => {})
              emitExecutionEvent({
                type: "node:updated",
                executionId,
                nodeStates: { ...nodeStates },
                nodeId: node.id,
                totalNodes: totalExecutions,
                completedNodes: completedCount,
                failedNodes: failedCount,
              })
            }
            result = await executeNodeForList(
              node,
              expanded,
              edges,
              nodes,
              nodeStates,
              ctx,
              executionId,
              triggerData,
              onIterationProgress,
              concurrencyLimit,
            )
          } else {
            // Normal single execution
            const inputs = resolveNodeInputs(
              node,
              edges,
              nodeStates,
              nodes,
              triggerData,
            )

            // Store resolved inputs in node state for debugging visibility
            nodeStates[node.id] = {
              ...nodeStates[node.id],
              inputs: inputs as unknown as Record<string, unknown>,
            }

            result = await executeNode(
              node,
              inputs,
              edges,
              nodes,
              nodeStates,
              ctx,
            )
          }

          // Update state
          nodeStates[node.id] = {
            status: "completed",
            nodeType: node.type,
            output: result.output,
            inputs: nodeStates[node.id]?.inputs,
            jobId: result.jobId,
            jobIds: result.jobIds,
            usageLogId: result.usageLogId,
            creditsUsed: result.creditsUsed,
            startedAt: nodeStates[node.id]?.startedAt,
            completedAt: new Date().toISOString(),
          }

          // Record execution duration for progress bar estimation
          try {
            const startedAt = nodeStates[node.id]?.startedAt
            const completedAt = nodeStates[node.id]?.completedAt
            if (startedAt && completedAt && node.type) {
              const nodeData = (node.data ?? {}) as Record<string, unknown>
              const statsKey = buildStatsKey(node.type, nodeData)
              if (statsKey) {
                const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()
                upsertExecutionStats(statsKey, durationMs).catch(() => {})
              }
            }
          } catch { /* non-critical */ }

          // For fan-out nodes, per-iteration progress was already emitted via callback;
          // for normal nodes, increment by 1 here.
          if (!result.jobIds || result.jobIds.length <= 1) {
            completedCount++
            // Persist progress + node states immediately so polling sees
            // both the counter AND the per-node status update.
            updateExecution(executionId, {
              completed_nodes: completedCount,
              node_states: nodeStates,
            }).catch(() => {})
          }
          totalCredits += result.creditsUsed ?? 0

          emitExecutionEvent({
            type: "node:updated",
            executionId,
            nodeStates: { ...nodeStates },
            nodeId: node.id,
            totalNodes: totalExecutions,
            completedNodes: completedCount,
            failedNodes: failedCount,
            totalCreditsUsed: totalCredits,
          })

          return result
      })
      // Per-level abort ref so fail-fast doesn't pollute ctx.cancelled
      // (which is checked between levels for stopping mode).
      // User cancellation still works: running tasks detect it in their poll
      // loops and throw, which triggers fail-fast on this ref.
      const levelAborted = { cancelled: ctx.cancelled }
      const results = await settledWithLimit(tasks, concurrencyLimit, levelAborted)

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
            inputs: nodeStates[node.id]?.inputs,
            jobId: nodeStates[node.id]?.jobId,
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
        total_nodes: totalExecutions,
        completed_nodes: completedCount,
        failed_nodes: failedCount,
        total_credits_used: totalCredits,
      })

      emitExecutionEvent({
        type: "level:completed",
        executionId,
        nodeStates: { ...nodeStates },
        totalNodes: totalExecutions,
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

    // --- App monetization: credit creator earnings ---
    if (ctx.isAppRun && appVersionId && hasCredits()) {
      try {
        const { data: appVersion } = await supabase
          .from("published_apps")
          .select("creator_id, monetization_enabled, monetization_flat_fee, monetization_percent")
          .eq("id", appVersionId)
          .single()

        if (
          appVersion?.monetization_enabled &&
          appVersion.creator_id !== ctx.userId &&
          totalCredits > 0
        ) {
          const flatFee = appVersion.monetization_flat_fee ?? 0
          const percent = appVersion.monetization_percent ?? 0
          const markup = calculateMonetizationMarkup(totalCredits, flatFee, percent)
          const percentFee = markup - flatFee

          if (markup > 0) {
            // Look up the app_run row for this execution
            const { data: appRun } = await supabase
              .from("app_runs")
              .select("id")
              .eq("execution_id", executionId)
              .single()

            if (appRun) {
              await supabase.rpc("process_app_monetization", {
                p_runner_id: ctx.userId,
                p_creator_id: appVersion.creator_id,
                p_markup_amount: markup,
                p_app_id: appVersionId,
                p_run_id: appRun.id,
                p_base_cost: totalCredits,
                p_flat_fee: flatFee,
                p_percent_fee: percentFee,
              })
              console.log(`[monetization] Credited ${markup} CR to creator ${appVersion.creator_id} from runner ${ctx.userId}`)
            }
          }
        }
      } catch (err) {
        // Best-effort: earnings failure must not fail the completed execution
        console.error("[monetization] Failed to process app earnings:", err)
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[orchestrator] Execution ${executionId} error:`, message)
    await failExecution(executionId, message)
  }
}

// ---------------------------------------------------------------------------
// Fan-out execution — run a node once per list item
// ---------------------------------------------------------------------------

/**
 * Execute a node once per list item sequentially, collecting results.
 * The first result becomes the primary output; all results stored in listResults.
 * Mirrors frontend executeNodeForList() logic.
 */
async function executeNodeForList(
  node: SimpleNode,
  items: string[],
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
  ctx: OrchestratorContext,
  executionId: string,
  triggerData?: Record<string, unknown>,
  onIterationComplete?: (iterationIndex: number) => void,
  maxConcurrency?: number,
): Promise<ExecuteNodeResult> {
  // Set iteration total so frontend can show "0/N" progress
  nodeStates[node.id] = {
    ...nodeStates[node.id],
    iterationTotal: items.length,
    iterationCompleted: 0,
  }

  let iterationCompleted = 0
  const cancelRef = { cancelled: false }

  const tasks = items.map((item, i) => async () => {
    if (ctx.cancelled || cancelRef.cancelled) throw new Error("Cancelled")

    const inputs = resolveNodeInputs(
      node,
      edges,
      nodeStates,
      allNodes,
      triggerData,
      i,
    )
    overrideInputWithListItem(inputs, item)

    const result = await executeNode(
      node,
      inputs,
      edges,
      allNodes,
      nodeStates,
      ctx,
    )

    const output = result.output
    const resultValue =
      output.imageUrl ||
      output.videoUrl ||
      output.audioUrl ||
      output.text ||
      ""

    iterationCompleted++
    nodeStates[node.id].iterationCompleted = iterationCompleted

    onIterationComplete?.(i)
    emitExecutionEvent({
      type: "node:updated",
      executionId,
      nodeStates: { ...nodeStates },
      nodeId: node.id,
    })

    return { index: i, result, resultValue }
  })

  const settled = await settledWithLimit(tasks, maxConcurrency ?? MAX_CONCURRENT_NODES_CEILING, cancelRef)

  // Assemble results in original index order
  const allResults: string[] = new Array(items.length).fill("")
  const allJobIds: string[] = []
  let firstOutput: NodeOutput | undefined
  let totalCreditsUsed = 0
  let lastJobId: string | undefined
  let lastUsageLogId: string | undefined

  for (let i = 0; i < settled.length; i++) {
    const entry = settled[i]
    if (entry.status === "fulfilled") {
      const { index, result, resultValue } = entry.value
      allResults[index] = resultValue
      if (index === 0) firstOutput = result.output
      totalCreditsUsed += result.creditsUsed ?? 0
      if (result.jobId) {
        lastJobId = result.jobId
        allJobIds.push(result.jobId)
      }
      if (result.usageLogId) lastUsageLogId = result.usageLogId
    } else if (!cancelRef.cancelled) {
      cancelRef.cancelled = true
    }
  }

  const combinedOutput: NodeOutput = {
    ...(firstOutput ?? {}),
    listResults: allResults,
  }

  return {
    output: combinedOutput,
    jobId: lastJobId,
    jobIds: allJobIds.length > 1 ? allJobIds : undefined,
    usageLogId: lastUsageLogId,
    creditsUsed: totalCreditsUsed,
  }
}

/**
 * Override the appropriate input field in ResolvedInputs with the current list item.
 * If the item looks like a URL, set it as the media URL; otherwise set as prompt.
 */
function overrideInputWithListItem(
  inputs: ResolvedInputs,
  item: string,
): void {
  // Skip override for repeat placeholder — use normal upstream inputs
  if (item === REPEAT_PLACEHOLDER) return

  const isUrl =
    item.startsWith("http") ||
    /\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|ogg)(\?|$)/i.test(item)

  if (isUrl) {
    // Determine media type from extension
    if (/\.(mp4|mov|webm)(\?|$)/i.test(item)) {
      inputs.videoUrl = item
    } else if (/\.(mp3|wav|ogg)(\?|$)/i.test(item)) {
      inputs.audioUrl = item
    } else {
      // Default to image for URLs (including generic http URLs)
      inputs.imageUrl = item
    }
  } else {
    inputs.prompt = item
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

  // .neq("status", "cancelled") so a fail-write doesn't overwrite a user
  // cancellation that landed in the same window. Same rationale as
  // updateExecution() — terminal states must not clobber "cancelled".
  await supabase
    .from("workflow_executions")
    .update(updates)
    .eq("id", executionId)
    .neq("status", "cancelled")

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
  const builder = supabase
    .from("workflow_executions")
    .update(updates)
    .eq("id", executionId)

  // Terminal-state transitions must NEVER overwrite a row the user already
  // cancelled. Otherwise, between checkExecutionControl and this UPDATE the
  // user can hit /v1/workflow-executions/:id/cancel — and the orchestrator
  // would silently flip status from "cancelled" back to "completed"/"failed",
  // claiming work the user actually cancelled (and which has already had its
  // child-job credits refunded by the cancel route).
  if (updates.status === "completed" || updates.status === "failed") {
    builder.neq("status", "cancelled")
  }

  await builder
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
