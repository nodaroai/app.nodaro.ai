/**
 * Orchestrator worker — processes workflow executions.
 * Loads workflow graph, topological sort, executes nodes level-by-level.
 *
 * Started as a separate BullMQ worker alongside video-worker and render-worker.
 */

import { Worker, type Job } from "bullmq"
import IORedis from "ioredis"
import { config, hasCredits } from "../lib/config.js"
import { TIER_PARALLELISM } from "../ee/billing/stripe-config.js"
import { executionEvents, type ExecutionEvent } from "../lib/execution-events.js"
import { supabase } from "../lib/supabase.js"
import { reconcileNodeStatesFromJobs } from "../lib/reconcile/node-states.js"
import { cancelInFlightChildJobs } from "../lib/reconcile/cancel-inflight-jobs.js"
import { updateExecutionWithRetry } from "../lib/execution-writes.js"
import {
  buildExecutionLevels,
  getEffectivelySkippedIds,
  getUploadDescendantIds,
  computeRouterGatedIds,
  isSourceNode,
  isSkipNode,
} from "../services/workflow-engine/execution-graph.js"
import { resolveNodeInputs, getListInputForNode } from "../services/workflow-engine/input-resolver.js"
import { normalizeLegacyNodeTypes } from "../services/workflow-engine/normalize-node-types.js"
import { migrateGenerateImageHandles } from "../lib/generate-image-handle-migration.js"
import { extractSourceNodeOutput, extractSavedNodeOutput } from "../services/workflow-engine/output-extractor.js"
import { executeNode, loadCompletedFanOutIterations, type ExecuteNodeResult } from "../services/workflow-engine/node-executor.js"
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
import { filterCloneNodes, PARAMETER_NODE_TYPES, getParameterPromptHint } from "@nodaro/shared"
import { applyInputOverridesToNodes } from "./apply-input-overrides.js"
import { migrateEdgeOutputMode } from "@nodaro/shared"
import { REPEAT_PLACEHOLDER, getEffectiveRepeatCount, REPEATABLE_NODE_TYPES, expandItemsWithRepeat, decodeProviderItem } from "@nodaro/shared"
import { buildStatsKey, upsertExecutionStats } from "../services/execution-stats.js"
import { settledWithLimit } from "../lib/settled-with-limit.js"
import { assembleFanOutResult } from "./fan-out-result.js"
import { overrideInputWithListItem as applyListItem } from "./list-item-override.js"
import { calculateMonetizationMarkup } from "@nodaro/shared"

/** Env-var ceiling — tier limits are capped by this. */
const MAX_CONCURRENT_NODES_CEILING = config.MAX_CONCURRENT_NODES_PER_EXECUTION

/** Resolve per-execution parallelism limit from user tier (cloud) or env ceiling (self-hosted). */
export function getParallelismLimit(tier: string | undefined): number {
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

/** Cap per-restart sweep so a large backlog (e.g., several hundred stuck
 *  rows after a prolonged outage) doesn't hold up worker startup. Each row
 *  costs a reconcile-node-states query + a retry-aware UPDATE; at 3-retry
 *  exhaustion this can take ~500ms per row sequentially. The
 *  workflow-executions reconcile cron (90s interval) picks up the
 *  remainder on subsequent ticks. */
const STARTUP_RECONCILE_BATCH_LIMIT = 100

async function cleanupStaleExecutions(): Promise<void> {
  const { data: rows, error } = await supabase
    .from("workflow_executions")
    .select("id, started_at, node_states")
    .in("status", ["running", "stopping"])
    // ORDER BY started_at ASC so oldest stuck rows are processed first.
    // Without an explicit order, PostgREST returns heap-order rows —
    // a deployment with a persistent backlog and write failures could
    // re-process the same front-of-the-list rows on every restart and
    // never advance past them. Oldest-first ordering also prioritizes
    // the executions most likely to be genuinely abandoned. Nulls last
    // so a row with NULL started_at doesn't monopolize the head.
    .order("started_at", { ascending: true, nullsFirst: false })
    .limit(STARTUP_RECONCILE_BATCH_LIMIT)

  if (error || !rows || rows.length === 0) return

  // Counter outcomes:
  //   reconciledCompleted — write succeeded with status='completed'
  //   reconciledFailed    — write succeeded with status='failed'
  //   abandoned           — write succeeded with status='failed' (>4h stale or null started_at)
  //   cancelledRaces      — write returned cancelledRace=true (user cancelled mid-flight)
  //   writeFailures       — write threw after 3-retry exhaustion
  //   skipped             — row didn't meet any terminal-write condition (genuinely-active execution)
  // Invariant: every row increments exactly one counter; rows.length == sum.
  let reconciledCompleted = 0
  let reconciledFailed = 0
  let abandoned = 0
  let cancelledRaces = 0
  let writeFailures = 0
  let skipped = 0
  const now = Date.now()

  /**
   * Run a terminal updateExecutionWithRetry call and update the right
   * counter based on the outcome. Single source of truth for the 3
   * branches below — keeps error message format consistent and ensures
   * cancelledRace is always counted separately from a successful write.
   */
  async function tryTerminalWrite(
    rowId: string,
    updates: Record<string, unknown>,
    action: string,
    onSuccess: () => void,
  ): Promise<void> {
    try {
      const result = await updateExecutionWithRetry(rowId, updates)
      if (result.cancelledRace) {
        // The user cancelled between SELECT and UPDATE; the row was NOT
        // written. Track separately from successful reconciliation so
        // ops can distinguish "user cancellations during recovery" from
        // genuine reconciliation throughput.
        cancelledRaces++
        return
      }
      onSuccess()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      console.error(
        `[orchestrator] cleanupStaleExecutions: failed to ${action} ${rowId}: ${detail}`,
      )
      writeFailures++
    }
  }

  for (const row of rows) {
    const rawStates = (row.node_states ?? {}) as Record<string, NodeExecutionState>

    // Reconcile node_states from the jobs table before deciding what to do.
    // If the previous orchestrator died after the worker marked a child
    // job completed but before it could write node_states[X]="completed",
    // this catches that case and lets us close out the execution cleanly.
    const { next: states, changed } = await reconcileNodeStatesFromJobs(rawStates, row.id)

    const nodeStatuses = Object.values(states).map((s) => s?.status)
    const allCompleted = nodeStatuses.length > 0 && nodeStatuses.every((s) => s === "completed" || s === "skipped")
    const anyFailed = nodeStatuses.some((s) => s === "failed")
    const anyActive = nodeStatuses.some((s) => s === "pending" || s === "running")

    if (allCompleted) {
      const updates: Record<string, unknown> = {
        status: "completed",
        completed_at: new Date().toISOString(),
      }
      if (changed) updates.node_states = states
      await tryTerminalWrite(row.id, updates, "flip to completed", () => { reconciledCompleted++ })
      continue
    }

    // If reconciliation reveals a terminal failure AND no nodes are still
    // pending/running in DB, mark the execution as failed. This recovers
    // executions where the orchestrator died after a child failure but
    // before propagating it to the execution row.
    if (anyFailed && !anyActive) {
      const updates: Record<string, unknown> = {
        status: "failed",
        error_message: "Execution failed — child job error (reconciled on orchestrator restart)",
        completed_at: new Date().toISOString(),
      }
      if (changed) updates.node_states = states
      await tryTerminalWrite(row.id, updates, "flip to failed", () => { reconciledFailed++ })
      continue
    }

    // A null started_at means the row was INSERTed but the orchestrator
    // died before its first `UPDATE … SET status='running', started_at=now()`.
    // The worker never claimed it; treat as immediately abandoned so the
    // user can re-run instead of waiting 4h for the threshold.
    // For non-null started_at, only abandon when past the >4h threshold —
    // otherwise let BullMQ's stalled-job retry pick it back up.
    const startedAt = row.started_at ? new Date(row.started_at).getTime() : 0
    const isAbandonable =
      startedAt === 0 ||
      (startedAt > 0 && now - startedAt > STALE_EXECUTION_THRESHOLD_MS)

    if (isAbandonable) {
      await tryTerminalWrite(
        row.id,
        {
          status: "failed",
          error_message:
            startedAt === 0
              ? "Execution failed — orchestrator never claimed this row (never started)"
              : "Execution abandoned — no active orchestrator worker",
          completed_at: new Date().toISOString(),
        },
        "mark abandoned",
        () => { abandoned++ },
      )
      continue
    }

    // Row is genuinely active — left for BullMQ stalled-retry.
    skipped++
  }

  const reconciled = reconciledCompleted + reconciledFailed
  if (reconciled > 0 || abandoned > 0 || cancelledRaces > 0 || writeFailures > 0 || skipped > 0) {
    // leftForRetry = rows that NEITHER reconciled-terminal-state NOR were
    // attempted-but-failed. writeFailures rows will be re-tried by the
    // 90s reconcile cron, so they're not "left for BullMQ retry" — but
    // they're not resolved either. Surface them as a separate field
    // rather than burying them in leftForRetry, and don't double-count
    // them in the formula.
    const leftForRetry = rows.length - reconciled - abandoned - cancelledRaces - writeFailures - skipped
    console.log(
      `[orchestrator] Startup reconcile: ${reconciledCompleted} completed, ${reconciledFailed} failed, ${abandoned} abandoned, ${cancelledRaces} cancelled-races, ${writeFailures} write-failures, ${skipped} skipped, ${leftForRetry} left for retry`,
    )
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

/**
 * Freeze-on-exposure gate (design F16): true when this run carries a lottie
 * motionPlan override for `node` AND the node is a motion-graphics node whose
 * (already override-merged) plan is a lottie-graphic. Such a node must be
 * pre-completed with its overridden plan instead of re-generated — the creator
 * exposed slot fields, so end-users edit the published animation rather than
 * re-rolling it (no re-generation, no 5cr re-charge). The PRESENCE of a
 * `motionPlan` key in the override is the freeze signal; the frontend
 * (composeLottieSlotOverrides) emits one for EVERY slot-exposed lottie node,
 * even when the user touched nothing.
 *
 * Covers BOTH the presentation route and the app route: both enqueue the same
 * orchestrator job with `inputOverrides`, so this one gate fires for both.
 */
function isFrozenLottieOverride(
  node: SimpleNode,
  inputOverrides: Record<string, Record<string, unknown>> | undefined,
): boolean {
  if (node.type !== "motion-graphics") return false
  const override = inputOverrides?.[node.id]
  if (!override || !("motionPlan" in override)) return false
  const plan = node.data?.motionPlan as Record<string, unknown> | undefined
  return plan?.planType === "lottie-graphic"
}

/**
 * @internal Exported for the orchestrator integration test (freeze-on-exposure
 * guard) so it can drive the real seeding + level-execution path. Not part of
 * the module's public surface — production callers use `createOrchestratorWorker`.
 */
export async function processWorkflowExecution(job: Job<WorkflowExecutionJob>): Promise<void> {
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
    // 1. Load workflow from DB (or from published app snapshot if running a specific version).
    //    Also capture the workflow owner (distinct from `userId` for shared/app runs);
    //    `ctx.workflowOwnerId` scopes sub-workflow resolution so a shared/app viewer
    //    can run the owner's sub-flows without re-opening the IDOR path.
    let workflowData: { nodes: unknown; edges: unknown; settings: unknown } | null = null

    if (appVersionId) {
      const { data: appVersion, error: appError } = await supabase
        .from("published_apps")
        .select("snapshot_nodes, snapshot_edges, snapshot_settings, creator_id")
        .eq("id", appVersionId)
        .is("deleted_at", null)
        .single()

      if (appError || !appVersion) {
        // App was provided in the job but is missing or has been soft-deleted.
        // Do NOT fall through to the workflows-table fetch — that would execute
        // the live (un-published) workflow instead of the published snapshot,
        // letting lingering webhook/schedule triggers bypass deletion.
        await failExecution(executionId, `App version ${appVersionId} not found or has been deleted`)
        return
      }

      workflowData = {
        nodes: appVersion.snapshot_nodes,
        edges: appVersion.snapshot_edges,
        settings: appVersion.snapshot_settings,
      }
      ctx.workflowOwnerId = (appVersion.creator_id as string | null) ?? undefined
    }

    if (!workflowData) {
      const { data: workflow, error: wfError } = await supabase
        .from("workflows")
        .select("nodes, edges, settings, user_id")
        .eq("id", workflowId)
        .single()

      if (wfError || !workflow) {
        await failExecution(executionId, `Workflow ${workflowId} not found`)
        return
      }
      workflowData = workflow
      ctx.workflowOwnerId = (workflow.user_id as string | null) ?? undefined
    }

    // Normalize legacy node types (edit-image → modify/upscale/remove-background,
    // image-to-image → modify, old collect → reduce, loop → list) BEFORE the
    // engine reads node.type. See normalize-node-types.ts.
    const rawNodes = (workflowData.nodes as (SimpleNode & { hidden?: boolean })[]) ?? []
    const allNodes = normalizeLegacyNodeTypes(rawNodes)

    // Filter out hidden nodes (from loop expansion) and expanded clones that were persisted
    const allEdges: SimpleEdge[] = ((workflowData.edges as SimpleEdge[]) ?? []).map(e => ({
      ...e,
      data: migrateEdgeOutputMode(e.data as Record<string, unknown> | undefined),
    }))
    const cleaned = filterCloneNodes(allNodes, allEdges)
    // Also filter nodes still marked hidden after clone cleanup
    const nodes: SimpleNode[] = cleaned.nodes
      .filter((n) => !(n as { hidden?: boolean }).hidden)
      .map((n) => ({
        id: n.id,
        type: n.type,
        data: n.data,
        parentId: (n as { parentId?: string }).parentId,
      }))
    const nodeIds = new Set(nodes.map((n) => n.id))
    const filteredEdges = cleaned.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    // Defensive Generate Image handles v2 migration — catches workflows
    // persisted before the migration deployed, or those created by external
    // clients (SDK, CLI, direct DB writes).
    const edges = migrateGenerateImageHandles(nodes, filteredEdges as unknown as ReadonlyArray<{ id: string; source: string; target: string; targetHandle?: string | null }>) as unknown as typeof filteredEdges

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

    // Apply presentation / published-app input overrides to source node data.
    // SHALLOW merge per node — a top-level override key replaces the snapshot's
    // value wholesale (this is what makes the lottie full-plan `motionPlan`
    // override work; see apply-input-overrides). Also clears stale generated*
    // results so the user's fresh input wins over a cached snapshot result.
    applyInputOverridesToNodes(nodes, inputOverrides)

    if (nodes.length === 0) {
      await failExecution(executionId, "Workflow has no nodes")
      return
    }

    // 2. Initialize node states — RESUME-AWARE.
    //
    // A BullMQ stalled re-pick (the documented recovery path: worker died
    // mid-run on a Railway redeploy / OOM / SIGKILL, lock expired) re-invokes
    // this function for the SAME execution. Rebuilding `nodeStates = {}` here
    // would re-derive every node as executable and re-run + RE-RESERVE credits
    // for nodes that already completed-and-committed on the prior attempt
    // (double-charge + duplicate provider spend + duplicate outputs).
    //
    // Load the persisted state and carry forward terminal progress so completed
    // work is neither re-executed nor re-charged. Reconcile against the jobs
    // table first to catch nodes whose job finished after the crash but before
    // node_states could be written. This is a pure no-op on a fresh run (no
    // prior progress → nodeStates stays empty → identical to the old behavior).
    const { data: execRow } = await supabase
      .from("workflow_executions")
      .select("status, node_states")
      .eq("id", executionId)
      .single()

    // A stalled re-pick of an already-finished execution must not re-run it.
    // Includes every TERMINAL status (completed_at is set): re-running a
    // discarded/timed-out run would re-execute nodes and re-charge credits for
    // a run the user/system already closed.
    if (execRow && ["completed", "failed", "cancelled", "timed_out", "discarded"].includes(execRow.status as string)) {
      console.log(
        `[orchestrator] Execution ${executionId} already ${execRow.status} — skipping re-run (stalled re-pick of a closed execution)`,
      )
      return
    }

    const nodeStates: Record<string, NodeExecutionState> = {}
    let resumedNodeCount = 0
    {
      const persisted = (execRow?.node_states ?? {}) as Record<string, NodeExecutionState>
      // ALWAYS reconcile "running"/"pending" entries against the jobs table —
      // NOT only when some node already reached completed/skipped. The crash
      // window that double-charges is: a node's job completes+commits AFTER the
      // level-start persist wrote it as "running", but BEFORE the orchestrator's
      // fire-and-forget node_states flush lands, then the process dies. On
      // re-pick that node sits as "running" (no completed/skipped anywhere), so
      // a `hasPriorProgress` gate keyed on completed/skipped would SKIP recovery
      // and re-execute the node → second reservation + second provider call +
      // second commit. reconcileNodeStatesFromJobs is a ZERO-query no-op when no
      // node is running/pending (fresh first pick), so always calling it is free
      // on the common path. Carry forward only TERMINAL-DONE states; genuinely
      // in-flight or failed nodes are not carried and re-attempt on resume.
      const { next } = await reconcileNodeStatesFromJobs(persisted, executionId)
      for (const [id, st] of Object.entries(next)) {
        if (st?.status === "completed" || st?.status === "skipped") {
          nodeStates[id] = st
          resumedNodeCount++
        }
      }
      if (resumedNodeCount > 0) {
        console.log(
          `[orchestrator] Resuming execution ${executionId}: ${resumedNodeCount} node(s) already done — skipped (no re-charge)`,
        )
      }
    }
    // Neutralize any in-flight child jobs left by a prior (dead) attempt BEFORE
    // re-deriving + re-executing non-carried nodes. Pre-provider jobs are
    // cancelled + refunded (re-running them is free); post-provider jobs
    // (provider_task_id set) are ADOPTED — the node executor polls the
    // existing job instead of creating a new one, so the provider is never
    // paid twice for the same node (audit A2). MUST run after the
    // carry-forward above (cancelling earlier would make reconcile map these
    // to "skipped" and carry their nodes forward as done). No-op on a first
    // pick. See cancelInFlightChildJobs for the residual-race note.
    const { adoptable } = await cancelInFlightChildJobs(executionId)
    if (adoptable.size > 0) ctx.adoptableJobs = adoptable
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
      if (isFrozenLottieOverride(node, inputOverrides)) {
        // Freeze-on-exposure (design F16): an app/presentation run that carries a
        // lottie motionPlan override means the creator exposed slot fields — the
        // end-user edits the PUBLISHED animation rather than re-rolling it. Seed the
        // node as completed with the overridden plan as its output so the DAG skips
        // re-generation (and the 5cr re-charge) and render-video consumes the edited
        // plan via nodeStates.output.plan.
        //
        // node.data.motionPlan already carries the user's shallow-merged override
        // (applyInputOverridesToNodes ran above). Mirror the completed-state shape
        // used by the source/parameter/skip seeds below: status "completed" +
        // output + completedAt. preResolvedNodeIds (built next) picks it up, the
        // executable filter excludes it (status === "completed"), and the
        // render-video payload reads output.plan FIRST (payload-builder §render-video),
        // so the frozen plan — not a re-roll — drives the render.
        nodeStates[node.id] = {
          status: "completed",
          output: { plan: node.data.motionPlan as Record<string, unknown> },
          completedAt: new Date().toISOString(),
        }
      } else if (isSourceNode(node.type)) {
        const output = extractSourceNodeOutput(node, triggerData)
        if (output) {
          nodeStates[node.id] = {
            status: "completed",
            output,
            completedAt: new Date().toISOString(),
          }
        }
      } else if (node.type && PARAMETER_NODE_TYPES.has(node.type)) {
        // Parameter pickers (mood, action-fx, loop-subject, person, etc.) emit
        // a prompt fragment via FieldMappings — they never make API calls and
        // have no executable handler. Mark them completed up-front so they
        // (a) don't end up in any execution level, (b) never reach executeNode
        // (which would fall through to executeWorkerNode → create a stale jobs
        // row → buildPayload throw "Unknown node type"), and (c) still expose
        // their prompt hint as output for {Label} ref resolution downstream.
        const hint = getParameterPromptHint(node)
        nodeStates[node.id] = {
          status: "completed",
          output: hint ? { text: hint } : {},
          completedAt: new Date().toISOString(),
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
      if (n.type && PARAMETER_NODE_TYPES.has(n.type)) return false
      if (skippedIds.has(n.id)) return false
      // Freeze-on-exposure (design F16): a lottie node pre-completed with its
      // overridden plan is NOT executable — exclude it exactly like a source /
      // parameter / skipped pre-completed node so it stays out of totalExecutions
      // (no phantom +1 the progress bar can never reach) and is never dispatched.
      if (isFrozenLottieOverride(n, inputOverrides)) return false
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

      // Mirror expandItemsWithRepeat resolution order: list × repeats win, then
      // providers (when no list), then repeats alone.
      const providerCount = (() => {
        const raw = (node.data as Record<string, unknown>)?.providers
        if (!Array.isArray(raw)) return 1
        const cleaned = raw.filter(p => typeof p === "string" && p.length > 0)
        return cleaned.length >= 2 ? cleaned.length : 1
      })()

      if (listItems && listItems.length > 1) {
        const expandedCount = listItems.length * repeatCount
        totalExecutions += expandedCount - 1
      } else if (providerCount > 1) {
        const expandedCount = providerCount * repeatCount
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

    // 7. Execute level by level. On a resume, the carried-forward done nodes
    // already count toward progress (they're in totalExecutions) — seed the
    // counter so the progress bar isn't under-reported after a re-pick.
    let completedCount = resumedNodeCount
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
      // "stopping" = "Stop after current" — don't start this level; same effect
      // as an explicit cancel (mark cancelled + emit the same event), so the two
      // control states are handled together.
      if (controlStatus === "cancelled" || controlStatus === "stopping") {
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

      // "discarded" = Discard Run. Stop scheduling new levels, but DO NOT
      // cancel in-flight jobs (they finish into My Library) and DO NOT rewrite
      // the status to "cancelled" — the frontend needs the "discarded" status
      // to detach the canvas. Deliberately a SEPARATE branch from
      // cancelled||stopping: we don't set ctx.cancelled (so iteration tasks
      // don't bail) and never call cancelJobAndThrow.
      if (controlStatus === "discarded") {
        await updateExecution(executionId, {
          status: "discarded",
          node_states: nodeStates,
          completed_at: new Date().toISOString(),
        })
        emitExecutionEvent({
          type: "execution:discarded",
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

      // Filter to executable nodes (not source, not parameter picker, not
      // skipped, not gated, not already done)
      const executableNodes = level.filter((node) => {
        if (isSourceNode(node.type)) return false
        if (node.type && PARAMETER_NODE_TYPES.has(node.type)) return false
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
              (toleratedFailures: number) => {
                // Tolerated fan-out failures: node is completed, so count toward
                // completed_nodes (NOT failed_nodes — that trips the fail-fast).
                // Lets the progress bar reach 100% on partial fan-out success.
                completedCount += toleratedFailures
                updateExecution(executionId, { completed_nodes: completedCount }).catch(() => {})
              },
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

          // Fan-out nodes already counted their iterations via the
          // onIterationProgress (successes) + onToleratedFailures (tolerated)
          // callbacks; normal single-execution nodes increment by 1 here. Gate on
          // `expanded` (the true fan-out discriminator). The old
          // `jobIds.length <= 1` heuristic was wrong both ways: it double-counted a
          // 1-success fan-out (jobIds.length === 1) AND under-counted a
          // multi-candidate normal node (numImages > 1 → jobIds.length > 1 → never
          // counted, though totalExecutions counts it as 1).
          if (!expanded) {
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
          .is("deleted_at", null)
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
  onToleratedFailures?: (count: number) => void,
): Promise<ExecuteNodeResult> {
  // Set iteration total so frontend can show "0/N" progress
  nodeStates[node.id] = {
    ...nodeStates[node.id],
    iterationTotal: items.length,
    iterationCompleted: 0,
  }
  // Durably persist iterationTotal BEFORE any iteration job is created. The
  // reconcile gate (reconcile/node-states.ts) keys on iterationTotal > 1 to
  // recognize a crashed-mid-fan-out node and leave it running for re-run, instead
  // of marking it "completed" from partial iteration jobs (which drops items).
  // Without this, a crash before the level-end node_states write would hide the
  // fan-out shape from reconcile. Best-effort: a write hiccup just falls back to
  // the old timing for this one node.
  await updateExecutionWithRetry(executionId, { node_states: nodeStates }).catch(() => {})

  // Per-iteration resume: on a crash + BullMQ re-pick this fan-out node re-runs
  // (reconcile leaves it "running"). Reuse the iterations that ALREADY completed
  // (+ committed) on the prior attempt instead of re-running them, so the re-run
  // doesn't double-charge or double-spend at the provider. Empty on a first run.
  const priorIterations = await loadCompletedFanOutIterations(executionId, node.id, node.type ?? "")

  let iterationCompleted = 0
  const cancelRef = { cancelled: false }

  const tasks = items.map((item, i) => async () => {
    if (ctx.cancelled || cancelRef.cancelled) throw new Error("Cancelled")

    // Reuse a prior-attempt completed iteration (crash resume) — no re-charge,
    // no duplicate provider call. Otherwise execute this iteration fresh.
    let result = priorIterations.get(i)
    if (!result) {
      const inputs = resolveNodeInputs(
        node,
        edges,
        nodeStates,
        allNodes,
        triggerData,
        i,
      )
      overrideInputWithListItem(inputs, item)

      // For provider-fanout iterations, swap data.provider for this run only.
      const providerOverride = decodeProviderItem(item)
      const iterationNode: SimpleNode = providerOverride
        ? { ...node, data: { ...(node.data ?? {}), provider: providerOverride } }
        : node

      result = await executeNode(
        iterationNode,
        inputs,
        edges,
        allNodes,
        nodeStates,
        ctx,
        i,
      )
    }

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

  // Assemble per-iteration results + apply failure propagation. Throws the
  // first genuine failure when NOTHING succeeded (so the orchestrator marks
  // this node failed and the run fail-fasts) instead of the old behavior of
  // always returning success with empty/partial output. See assembleFanOutResult.
  const assembly = assembleFanOutResult(settled, items.length)
  // Report tolerated (non-fatal) iteration failures. assembleFanOutResult throws
  // when NOTHING succeeded, so reaching here means succeededCount >= 1 and the
  // fan-out NODE is marked completed. These failures count toward completed_nodes
  // (done), NOT failed_nodes — incrementing failedCount would trip the level
  // fail-fast at the call site and turn a partial success into a hard failure.
  const toleratedFailures = items.length - assembly.succeededCount
  if (toleratedFailures > 0) onToleratedFailures?.(toleratedFailures)
  if (assembly.genuineFailure !== undefined) {
    console.warn(
      `[orchestrator] Fan-out node ${node.id} (${node.type}): ` +
      `${assembly.succeededCount}/${items.length} iterations succeeded; continuing with partial results.`,
    )
  }

  return {
    output: assembly.output,
    jobId: assembly.jobId,
    jobIds: assembly.jobIds,
    usageLogId: assembly.usageLogId,
    creditsUsed: assembly.creditsUsed,
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
  // Provider-fanout sentinel — provider swap happens at the executeNode call site;
  // here we just avoid touching prompt/media inputs.
  if (decodeProviderItem(item) !== undefined) return
  // URL/text routing (incl. overridePrompt for text items) lives in the
  // testable pure module; the two guards above stay here since they depend on
  // worker-local helpers.
  applyListItem(inputs, item)
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

  // Use the retry-aware helper so a transient DB error doesn't strand the
  // row in "running" with no terminal status — the prior fire-and-forget
  // UPDATE silently swallowed errors. cancelledRace is fine to ignore
  // here (the cancellation stands; we don't want to fail-overwrite it).
  try {
    await updateExecutionWithRetry(executionId, updates)
  } catch (err) {
    // Final terminal write failed even after retries. Log loudly so the
    // workflow_executions reconciler (added in this PR) can sweep it up
    // on the next 5-min tick. Do NOT re-throw — failExecution is itself
    // the failure-handling path and we don't want to recursively fail.
    const detail = err instanceof Error ? err.message : String(err)
    console.error(
      `[orchestrator] failExecution: persistent write failure for ${executionId} (${detail}). Row will be reconciled by cron.`,
    )
  }

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
  // Delegate to the retry-aware helper. Terminal writes (status=completed/
  // failed) retry 3× with exponential backoff and THROW on persistent
  // failure — that's the load-bearing fix for the "stuck at 100%" bug,
  // where the prior fire-and-forget UPDATE silently swallowed transient
  // DB errors and left the row in "running" forever.
  //
  // Per-level (non-terminal) writes don't retry: the next level's write
  // will catch up, so wasting cycles on transient retries here is
  // pointless. We log the error so it's visible in Railway logs.
  //
  // The .neq("status", "cancelled") guard for terminal writes is inside
  // updateExecutionWithRetry — it returns { ok: false, cancelledRace: true }
  // when the row was concurrently cancelled, which we just respect (no
  // throw) since the cancellation is the correct outcome.
  try {
    const result = await updateExecutionWithRetry(executionId, updates)
    if (!result.ok && !result.cancelledRace) {
      console.error(
        `[orchestrator] non-terminal updateExecution failed for ${executionId} after ${result.attempts} attempts`,
      )
    }
  } catch (err) {
    // Terminal write exhausted all retries. Re-throw so the orchestrator's
    // outer try/catch flags the execution as failed AND BullMQ records the
    // job as failed. The stalled-job handler + cleanupStaleExecutions on
    // next restart will pick it back up.
    throw err
  }
}

function emitExecutionEvent(event: ExecutionEvent): void {
  try {
    executionEvents.emit(event.executionId, event)
  } catch {
    // Never let event emission break the orchestrator
  }
}

export async function checkExecutionControl(
  executionId: string,
): Promise<"running" | "cancelled" | "stopping" | "discarded"> {
  const { data } = await supabase
    .from("workflow_executions")
    .select("status")
    .eq("id", executionId)
    .single()

  if (data?.status === "cancelled") return "cancelled"
  if (data?.status === "stopping") return "stopping"
  if (data?.status === "discarded") return "discarded"
  return "running"
}
