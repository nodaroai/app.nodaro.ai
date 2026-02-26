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
import { orchestrationQueue } from "../lib/orchestration-queue.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"

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
      .in("status", ["pending", "running"])
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

    if (error || !execution) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Execution not found" },
      })
    }

    return {
      data: toExecutionResponse(execution),
    }
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

    // Only cancel if still active
    const { data: execution, error } = await supabase
      .from("workflow_executions")
      .select("id, status")
      .eq("id", parsed.data.id)
      .eq("user_id", req.userId)
      .single()

    if (error || !execution) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Execution not found" },
      })
    }

    if (execution.status !== "pending" && execution.status !== "running") {
      return reply.status(409).send({
        error: {
          code: "not_cancellable",
          message: `Execution is already ${execution.status}`,
        },
      })
    }

    // Set to cancelled — orchestrator checks this on next level
    await supabase
      .from("workflow_executions")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
      })
      .eq("id", parsed.data.id)

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

    const { limit, cursor, status } = queryParsed.data
    const { id: workflowId } = paramsParsed.data

    let query = supabase
      .from("workflow_executions")
      .select("id, status, trigger_type, node_states, total_nodes, completed_nodes, failed_nodes, total_credits_used, error_message, started_at, completed_at, created_at")
      .eq("workflow_id", workflowId)
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false })
      .limit(limit + 1) // Fetch one extra for pagination

    // Filter by status (comma-separated for multiple, e.g. "pending,running")
    if (status) {
      const statuses = status.split(",").map((s) => s.trim()).filter(Boolean)
      if (statuses.length === 1) {
        query = query.eq("status", statuses[0])
      } else if (statuses.length > 1) {
        query = query.in("status", statuses)
      }
    }

    if (cursor) {
      // Cursor is the created_at of the last item
      const { data: cursorRow } = await supabase
        .from("workflow_executions")
        .select("created_at")
        .eq("id", cursor)
        .single()

      if (cursorRow) {
        query = query.lt("created_at", cursorRow.created_at as string)
      }
    }

    const { data, error } = await query

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const rows = data ?? []
    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows

    return {
      data: items.map(toExecutionSummary),
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : undefined,
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
