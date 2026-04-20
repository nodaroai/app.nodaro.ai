/**
 * Workflow execution routes.
 * POST /v1/workflows/:id/run — Create execution (trigger_type: manual)
 * GET  /v1/workflow-executions/:id — Get execution status + node_states
 * POST /v1/workflow-executions/:id/cancel — Cancel execution
 * GET  /v1/workflows/:id/executions — List executions for a workflow
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { tryRemoveFromQueue } from "../lib/queue.js"
import { orchestrationQueue } from "../lib/orchestration-queue.js"
import { createSSEStream } from "../lib/sse.js"
import { executionEvents, type ExecutionEvent } from "../lib/execution-events.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"
import { ACTIVE_EXECUTION_STATUSES } from "../lib/request-helpers.js"
import { checkIsAdmin } from "../lib/admin-check.js"
import { CreditsService } from "../billing/credits.js"
import { invalidateBalanceCache } from "./credits.js"

/**
 * Refund any reserved credit holds for the given job IDs. Best-effort —
 * `CreditsService.refundCredits` short-circuits on rows that aren't
 * `status='reserved'` (per PR #1502), so it's safe if the worker happens to
 * commit/refund the same row concurrently.
 *
 * Without this, cancelling a workflow execution leaves every child job's
 * `usage_logs` row stuck at `status='reserved'` — the user's balance was
 * decremented when each node was reserved but never restored. Same shape
 * as the per-job leak fixed in PR #1508; this closes the workflow-level
 * variant for all queued/running children.
 */
async function refundReservedCreditsForJobs(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return
  const { data: usageLogs } = await supabase
    .from("usage_logs")
    .select("id")
    .in("job_id", jobIds)
    .eq("status", "reserved")

  if (!usageLogs || usageLogs.length === 0) return

  await Promise.all(
    usageLogs.map((row) =>
      CreditsService.refundCredits(row.id).catch((err) =>
        console.error(`[workflow-cancel] Failed to refund usage_log ${row.id}:`, err),
      ),
    ),
  )
}

const workflowIdParams = z.object({
  id: z.string().uuid(),
})

const executionIdParams = z.object({
  id: z.string().uuid(),
})

const listExecutionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
  status: z.string().optional(),
  /** "editor" excludes app_run / component / webhook / schedule executions */
  source: z.enum(["editor", "all"]).optional(),
})

const globalExecutionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
  status: z.string().optional(),
  viewAll: z.enum(["true", "false"]).optional(),
})

export async function workflowExecutionRoutes(app: FastifyInstance) {
  // --- Run workflow ---
  app.post("/v1/workflows/:id/run", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = workflowIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsParsed.error.issues[0]?.message ?? "Invalid workflow ID",
        },
      })
    }

    const { id: workflowId } = paramsParsed.data

    // Parse optional body (nodeIds for partial execution)
    const body = (req.body ?? {}) as Record<string, unknown>
    const nodeIds = Array.isArray(body.nodeIds)
      ? (body.nodeIds as string[]).filter((id) => typeof id === "string")
      : undefined

    // Verify workflow exists and belongs to user
    const { data: workflow, error: wfError } = await supabase
      .from("workflows")
      .select("id, user_id")
      .eq("id", workflowId)
      .eq("user_id", req.userId)
      .single()

    if (wfError || !workflow) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Workflow not found" },
      })
    }

    // Check for already-running execution
    const { data: activeExec } = await supabase
      .from("workflow_executions")
      .select("id")
      .eq("workflow_id", workflowId)
      .in("status", ACTIVE_EXECUTION_STATUSES as unknown as string[])
      .limit(1)

    if (activeExec && activeExec.length > 0) {
      return reply.status(409).send({
        error: {
          code: "already_running",
          message: "This workflow already has an active execution",
        },
        executionId: activeExec[0].id,
      })
    }

    // Create execution record
    const { data: execution, error: execError } = await supabase
      .from("workflow_executions")
      .insert({
        workflow_id: workflowId,
        user_id: req.userId,
        status: "pending",
        trigger_type: "manual",
      })
      .select("id")
      .single()

    if (execError || !execution) {
      return reply.status(500).send({
        error: { code: "internal_error", message: execError?.message ?? "Failed to create execution" },
      })
    }

    // Enqueue orchestration job
    const jobData: WorkflowExecutionJob = {
      executionId: execution.id,
      workflowId,
      userId: req.userId,
      triggerType: "manual",
      nodeIds,
    }

    await orchestrationQueue.add("workflow-execution", jobData, {
      jobId: execution.id,
    })

    return reply.status(202).send({
      executionId: execution.id,
      status: "pending",
    })
  })

  // --- Get execution ---
  app.get("/v1/workflow-executions/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = executionIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid execution ID",
        },
      })
    }

    const { data: execution, error } = await supabase
      .from("workflow_executions")
      .select("*")
      .eq("id", parsed.data.id)
      .eq("user_id", req.userId)
      .single()

    if (!error && execution) {
      return {
        data: toExecutionResponse(execution),
      }
    }

    // Execution-history lists intentionally merge workflow_executions with
    // standalone single-node jobs (`workflow_execution_id IS NULL`). Detail
    // lookup needs the same fallback so a list row's `id` works uniformly.
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id, workflow_id, user_id, workflow_execution_id, status, provider, input_data, credits, error_message, started_at, completed_at, created_at, updated_at")
      .eq("id", parsed.data.id)
      .eq("user_id", req.userId)
      .is("workflow_execution_id", null)
      .single()

    if (jobError || !job) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Execution not found" },
      })
    }

    return {
      data: jobToExecutionResponse(job),
    }
  })

  // --- Stream execution via SSE ---
  app.get("/v1/workflow-executions/:id/stream", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = executionIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid execution ID",
        },
      })
    }

    const execId = parsed.data.id

    // Load current state from DB
    const { data: execution, error } = await supabase
      .from("workflow_executions")
      .select("*")
      .eq("id", execId)
      .eq("user_id", req.userId)
      .single()

    if (error || !execution) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Execution not found" },
      })
    }

    const sse = createSSEStream(req, reply)

    // Send current DB state as initial metadata so late-connecting clients
    // never miss state that was written before the SSE connection opened.
    sse.sendEvent({
      type: "metadata",
      data: toExecutionResponse(execution) as unknown as Record<string, unknown>,
    })

    // If already terminal, send done immediately and close
    const terminalStatuses = new Set(["completed", "failed", "cancelled", "timed_out"])
    if (terminalStatuses.has(execution.status as string)) {
      sse.sendEvent({
        type: "done",
        data: toExecutionResponse(execution) as unknown as Record<string, unknown>,
      })
      sse.close()
      return reply
    }

    // Subscribe to in-memory events from the orchestrator worker
    const handler = (event: ExecutionEvent) => {
      if (sse.isClosed) return

      const isTerminal =
        event.type === "execution:completed" ||
        event.type === "execution:failed" ||
        event.type === "execution:cancelled"

      sse.sendEvent({
        type: isTerminal ? "done" : "execution",
        data: {
          eventType: event.type,
          nodeStates: event.nodeStates,
          completedNodes: event.completedNodes,
          failedNodes: event.failedNodes,
          totalNodes: event.totalNodes,
          totalCreditsUsed: event.totalCreditsUsed,
          errorMessage: event.errorMessage,
          nodeId: event.nodeId,
        },
      })

      if (isTerminal) {
        executionEvents.off(execId, handler)
        sse.close()
      }
    }

    executionEvents.on(execId, handler)

    // Clean up listener on client disconnect
    req.raw.on("close", () => {
      executionEvents.off(execId, handler)
    })

    // Return reply to prevent Fastify from sending another response
    return reply
  })

  // --- Cancel execution ---
  app.post("/v1/workflow-executions/:id/cancel", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = executionIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid execution ID",
        },
      })
    }

    // Try workflow_executions first
    const { data: execution, error } = await supabase
      .from("workflow_executions")
      .select("id, status")
      .eq("id", parsed.data.id)
      .eq("user_id", req.userId)
      .single()

    // Fallback: check if it's a standalone job (single-node execution)
    if (error || !execution) {
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .select("id, status")
        .eq("id", parsed.data.id)
        .eq("user_id", req.userId)
        .single()

      if (jobError || !job) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Execution not found" },
        })
      }

      const activeJobStatuses = new Set(["pending", "queued", "processing", "running"])
      if (!activeJobStatuses.has(job.status as string)) {
        return reply.status(409).send({
          error: {
            code: "not_cancellable",
            message: `Job is already ${job.status}`,
          },
        })
      }

      // Try to remove from BullMQ queue before marking cancelled
      tryRemoveFromQueue(parsed.data.id).catch(() => {})

      await supabase
        .from("jobs")
        .update({ status: "cancelled" })
        .eq("id", parsed.data.id)

      // Refund the reserved credit hold so cancelling doesn't silently
      // forfeit the user's balance (mirrors cancel-jobs.ts after #1508).
      await refundReservedCreditsForJobs([parsed.data.id])
      invalidateBalanceCache(req.userId)

      return { success: true }
    }

    if (execution.status !== "pending" && execution.status !== "running" && execution.status !== "stopping") {
      return reply.status(409).send({
        error: {
          code: "not_cancellable",
          message: `Execution is already ${execution.status}`,
        },
      })
    }

    // mode: "after_current" sets status to "stopping" (finish current level, then stop)
    // mode: undefined/default sets status to "cancelled" (stop ASAP)
    const body = (req.body ?? {}) as Record<string, unknown>
    const mode = body.mode === "after_current" ? "stopping" : "cancelled"
    const updates: Record<string, unknown> = { status: mode }
    if (mode === "cancelled") updates.completed_at = new Date().toISOString()

    await supabase
      .from("workflow_executions")
      .update(updates)
      .eq("id", parsed.data.id)

    // For immediate cancellation, also cancel all pending/queued/processing jobs
    // belonging to this execution so the BullMQ worker discards their results,
    // and refund their reserved credit holds so the user isn't charged for
    // never-completed nodes (workflow-level analog of cancel-jobs.ts #1508).
    // Fire-and-forget — the DB status is already set, so the orchestrator will
    // pick up the cancellation regardless.
    if (mode === "cancelled") {
      const userId = req.userId
      void (async () => {
        const { data: activeJobs } = await supabase
          .from("jobs")
          .select("id")
          .eq("workflow_execution_id", parsed.data.id)
          .in("status", ["pending", "queued", "processing"])

        if (activeJobs && activeJobs.length > 0) {
          const jobIds = activeJobs.map((j) => j.id)
          await Promise.allSettled(jobIds.map((jid) => tryRemoveFromQueue(jid)))
          await supabase
            .from("jobs")
            .update({ status: "cancelled" })
            .in("id", jobIds)
          await refundReservedCreditsForJobs(jobIds)
          invalidateBalanceCache(userId)
        }
      })().catch(() => {})
    }

    return { success: true }
  })

  // --- List executions for a workflow ---
  app.get("/v1/workflows/:id/executions", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = workflowIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsParsed.error.issues[0]?.message ?? "Invalid workflow ID",
        },
      })
    }

    const queryParsed = listExecutionsQuery.safeParse(req.query)
    if (!queryParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: queryParsed.error.issues[0]?.message ?? "Invalid query",
        },
      })
    }

    const { limit, cursor, status, source } = queryParsed.data
    const { id: workflowId } = paramsParsed.data

    // Resolve cursor timestamp (shared across both sources)
    let cursorTimestamp: string | undefined
    if (cursor) {
      // Try workflow_executions first, then jobs
      const { data: cursorExec } = await supabase
        .from("workflow_executions")
        .select("created_at")
        .eq("id", cursor)
        .single()

      if (cursorExec) {
        cursorTimestamp = cursorExec.created_at as string
      } else {
        const { data: cursorJob } = await supabase
          .from("jobs")
          .select("created_at")
          .eq("id", cursor)
          .single()
        if (cursorJob) cursorTimestamp = cursorJob.created_at as string
      }
    }

    // --- Source 1: workflow_executions ---
    let execQuery = supabase
      .from("workflow_executions")
      .select("id, status, trigger_type, node_states, total_nodes, completed_nodes, failed_nodes, total_credits_used, error_message, started_at, completed_at, created_at")
      .eq("workflow_id", workflowId)
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false })
      .limit(limit + 1)

    // Filter by status (comma-separated for multiple, e.g. "pending,running")
    const statusFilter = status ? status.split(",").map((s) => s.trim()).filter(Boolean) : []
    if (statusFilter.length === 1) {
      execQuery = execQuery.eq("status", statusFilter[0])
    } else if (statusFilter.length > 1) {
      execQuery = execQuery.in("status", statusFilter)
    }

    // source=editor: only return editor-triggered executions (exclude app_run, component, webhook, schedule)
    if (source === "editor") {
      execQuery = execQuery.eq("trigger_type", "manual").or("is_component_execution.is.null,is_component_execution.eq.false")
    }

    if (cursorTimestamp) {
      execQuery = execQuery.lt("created_at", cursorTimestamp)
    }

    // --- Source 2: standalone jobs (single-node runs with no execution record) ---
    let jobsQuery = supabase
      .from("jobs")
      .select("id, status, provider, input_data, credits, error_message, started_at, completed_at, created_at")
      .eq("workflow_id", workflowId)
      .eq("user_id", req.userId)
      .is("workflow_execution_id", null)
      .order("created_at", { ascending: false })
      .limit(limit + 1)

    // Map execution status filter to job statuses
    if (statusFilter.length > 0) {
      const jobStatuses = mapExecStatusesToJobStatuses(statusFilter)
      if (jobStatuses.length === 1) {
        jobsQuery = jobsQuery.eq("status", jobStatuses[0])
      } else if (jobStatuses.length > 1) {
        jobsQuery = jobsQuery.in("status", jobStatuses)
      }
    }

    if (cursorTimestamp) {
      jobsQuery = jobsQuery.lt("created_at", cursorTimestamp)
    }

    const [execResult, jobsResult] = await Promise.all([execQuery, jobsQuery])

    if (execResult.error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: execResult.error.message },
      })
    }

    // Merge both sources, sort by created_at desc, take limit + 1
    const execRows = (execResult.data ?? []).map(toExecutionSummary)
    const jobRows = (jobsResult.data ?? []).map((row) => jobToExecutionSummary(row))
    const merged = [...execRows, ...jobRows]
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime())

    const hasMore = merged.length > limit
    const items = hasMore ? merged.slice(0, limit) : merged

    return {
      data: items,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id as string : undefined,
    }
  })

  // --- List all executions (global, across all workflows) ---
  app.get("/v1/executions", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const queryParsed = globalExecutionsQuery.safeParse(req.query)
    if (!queryParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: queryParsed.error.issues[0]?.message ?? "Invalid query",
        },
      })
    }

    const { limit, cursor, status, viewAll } = queryParsed.data
    const isAdminViewAll = viewAll === "true"

    if (isAdminViewAll) {
      const isAdmin = await checkIsAdmin(req.userId)
      if (!isAdmin) {
        return reply.status(403).send({
          error: { code: "forbidden", message: "Admin access required" },
        })
      }
    }

    // Resolve cursor timestamp (check both tables)
    let cursorTimestamp: string | undefined
    if (cursor) {
      const { data: cursorExec } = await supabase
        .from("workflow_executions")
        .select("created_at")
        .eq("id", cursor)
        .single()
      if (cursorExec) {
        cursorTimestamp = cursorExec.created_at as string
      } else {
        const { data: cursorJob } = await supabase
          .from("jobs")
          .select("created_at")
          .eq("id", cursor)
          .single()
        if (cursorJob) cursorTimestamp = cursorJob.created_at as string
      }
    }

    const statusFilter = status ? status.split(",").map((s) => s.trim()).filter(Boolean) : []

    // --- Source 1: workflow_executions ---
    let execQuery = supabase
      .from("workflow_executions")
      .select("id, workflow_id, user_id, status, trigger_type, node_states, total_nodes, completed_nodes, failed_nodes, total_credits_used, error_message, started_at, completed_at, created_at")
      .order("created_at", { ascending: false })
      .limit(limit + 1)

    if (!isAdminViewAll) {
      execQuery = execQuery.eq("user_id", req.userId)
    }

    if (statusFilter.length === 1) {
      execQuery = execQuery.eq("status", statusFilter[0])
    } else if (statusFilter.length > 1) {
      execQuery = execQuery.in("status", statusFilter)
    }

    if (cursorTimestamp) {
      execQuery = execQuery.lt("created_at", cursorTimestamp)
    }

    // --- Source 2: standalone jobs (single-node runs) ---
    let jobsQuery = supabase
      .from("jobs")
      .select("id, workflow_id, user_id, status, input_data, credits, error_message, started_at, completed_at, created_at")
      .is("workflow_execution_id", null)
      .not("workflow_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit + 1)

    if (!isAdminViewAll) {
      jobsQuery = jobsQuery.eq("user_id", req.userId)
    }

    if (statusFilter.length > 0) {
      const jobStatuses = mapExecStatusesToJobStatuses(statusFilter)
      if (jobStatuses.length === 1) {
        jobsQuery = jobsQuery.eq("status", jobStatuses[0])
      } else if (jobStatuses.length > 1) {
        jobsQuery = jobsQuery.in("status", jobStatuses)
      }
    }

    if (cursorTimestamp) {
      jobsQuery = jobsQuery.lt("created_at", cursorTimestamp)
    }

    const [execResult, jobsResult] = await Promise.all([execQuery, jobsQuery])

    if (execResult.error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: execResult.error.message },
      })
    }

    // Merge both sources, sort by created_at desc, take limit + 1
    const execRows = (execResult.data ?? []).map((row) => ({ ...toExecutionSummary(row), workflowId: row.workflow_id, userId: row.user_id, _source: "exec" as const }))
    const jobRows = (jobsResult.data ?? []).map((row) => ({ ...jobToExecutionSummary(row), workflowId: row.workflow_id, userId: row.user_id, _source: "job" as const }))
    const merged = [...execRows, ...jobRows]
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime())

    const hasMore = merged.length > limit
    const pageRows = hasMore ? merged.slice(0, limit) : merged

    // Enrich with workflow names + project IDs
    const workflowIds = [...new Set(pageRows.map((r) => r.workflowId as string).filter(Boolean))]
    const workflowMap = new Map<string, { name: string; projectId: string }>()
    if (workflowIds.length > 0) {
      const { data: workflows } = await supabase
        .from("workflows")
        .select("id, name, project_id")
        .in("id", workflowIds)
      for (const w of workflows ?? []) {
        workflowMap.set(w.id as string, {
          name: w.name as string,
          projectId: w.project_id as string,
        })
      }
    }

    // For admin view, fetch owner emails
    const emailMap = new Map<string, string>()
    if (isAdminViewAll) {
      const userIds = [...new Set(pageRows.map((r) => r.userId as string).filter(Boolean))]
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", userIds)
        for (const p of profiles ?? []) {
          emailMap.set(p.id as string, p.email as string)
        }
      }
    }

    const items = pageRows.map((row) => {
      const wf = workflowMap.get(row.workflowId as string)
      return {
        id: row.id,
        status: row.status,
        triggerType: row.triggerType,
        nodeStates: row.nodeStates,
        totalNodes: row.totalNodes,
        completedNodes: row.completedNodes,
        failedNodes: row.failedNodes,
        totalCreditsUsed: row.totalCreditsUsed,
        errorMessage: row.errorMessage,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        createdAt: row.createdAt,
        workflowId: row.workflowId,
        workflowName: wf?.name ?? null,
        projectId: wf?.projectId ?? null,
        ...(isAdminViewAll ? { ownerEmail: emailMap.get(row.userId as string) ?? null } : {}),
      }
    })

    return {
      data: items,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id as string : undefined,
    }
  })
}

// ---------------------------------------------------------------------------
// Response formatters
// ---------------------------------------------------------------------------

function toExecutionResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    userId: row.user_id,
    status: row.status,
    triggerType: row.trigger_type,
    triggerData: row.trigger_data,
    nodeStates: row.node_states,
    totalNodes: row.total_nodes,
    completedNodes: row.completed_nodes,
    failedNodes: row.failed_nodes,
    totalCreditsUsed: row.total_credits_used,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toExecutionSummary(row: Record<string, unknown>) {
  return {
    id: row.id,
    status: row.status,
    triggerType: row.trigger_type,
    nodeStates: row.node_states,
    totalNodes: row.total_nodes,
    completedNodes: row.completed_nodes,
    failedNodes: row.failed_nodes,
    totalCreditsUsed: row.total_credits_used,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Standalone job → execution summary (for single-node runs)
// ---------------------------------------------------------------------------

const JOB_STATUS_MAP: Record<string, string> = {
  processing: "running",
  pending: "pending",
  queued: "pending",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
}

function jobToExecutionSummary(row: Record<string, unknown>) {
  const inputData = (row.input_data ?? {}) as Record<string, unknown>
  const provider = row.provider as string | undefined
  // Component jobs: show the component name as the node type label
  const jobType = provider === "component"
    ? (inputData.componentName as string) ?? "Component"
    : (inputData.type as string) ?? (provider ?? "unknown")
  const mappedStatus = JOB_STATUS_MAP[row.status as string] ?? (row.status as string)

  return {
    id: row.id,
    status: mappedStatus,
    triggerType: "single-node",
    nodeStates: {
      [row.id as string]: {
        status: mappedStatus,
        nodeType: jobType,
        jobId: row.id,
        creditsUsed: row.credits ?? 0,
        error: row.error_message,
        startedAt: row.started_at,
        completedAt: row.completed_at,
      },
    },
    totalNodes: 1,
    completedNodes: mappedStatus === "completed" ? 1 : 0,
    failedNodes: mappedStatus === "failed" ? 1 : 0,
    totalCreditsUsed: mappedStatus === "completed" ? ((row.credits ?? 0) as number) : 0,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  }
}

function jobToExecutionResponse(row: Record<string, unknown>) {
  const summary = jobToExecutionSummary(row)
  return {
    ...summary,
    workflowId: row.workflow_id,
    userId: row.user_id,
    triggerData: row.input_data,
    updatedAt: row.updated_at ?? row.completed_at ?? row.started_at ?? row.created_at,
  }
}

function mapExecStatusesToJobStatuses(execStatuses: string[]): string[] {
  const jobStatuses: string[] = []
  for (const s of execStatuses) {
    switch (s) {
      case "running":
        jobStatuses.push("processing")
        break
      case "pending":
        jobStatuses.push("pending", "queued")
        break
      case "completed":
        jobStatuses.push("completed")
        break
      case "failed":
        jobStatuses.push("failed")
        break
      case "cancelled":
        jobStatuses.push("cancelled")
        break
      default:
        // No matching job status for stopping, timed_out, etc.
        break
    }
  }
  return jobStatuses
}
