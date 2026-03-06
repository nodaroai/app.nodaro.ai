/**
 * App Runner routes — consumer-facing endpoints for running published apps.
 * GET    /v1/app/:slug          — Load published app (public, auth optional)
 * POST   /v1/app/:slug/run      — Run the app (auth required, runner pays)
 * GET    /v1/app/:slug/runs     — List runner's past runs
 * GET    /v1/app/:slug/runs/:runId  — Get run details
 * DELETE /v1/app/:slug/runs/:runId  — Delete run from history
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { orchestrationQueue } from "../lib/orchestration-queue.js"
import { ACTIVE_EXECUTION_STATUSES } from "../lib/request-helpers.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"

const slugParams = z.object({
  slug: z.string().min(1),
})

const slugRunParams = z.object({
  slug: z.string().min(1),
  runId: z.string().uuid(),
})

const runBody = z.object({
  inputOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  runId: z.string().uuid().optional(),
})

const createRunBody = z.object({
  inputValues: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
})

const updateRunBody = z.object({
  inputValues: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
})

const runsQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
})

export async function appRunnerRoutes(app: FastifyInstance) {
  // --- Load published app (public, auth optional for personalization) ---
  app.get("/v1/app/:slug", async (req, reply) => {
    const parsed = slugParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid app slug" },
      })
    }

    const { slug } = parsed.data

    const { data: appRow, error: appError } = await supabase
      .from("published_apps")
      .select(
        "id, name, description, icon_url, version, snapshot_nodes, snapshot_edges, snapshot_settings, estimated_credits, creator_id, max_runs_per_user_per_day, created_at"
      )
      .eq("slug", slug)
      .eq("is_active", true)
      .single()

    if (appError || !appRow) {
      return reply.status(404).send({
        error: { code: "not_found", message: "App not found" },
      })
    }

    return reply.send({
      id: appRow.id,
      name: appRow.name,
      description: appRow.description,
      iconUrl: appRow.icon_url,
      version: appRow.version,
      snapshotNodes: appRow.snapshot_nodes,
      snapshotEdges: appRow.snapshot_edges,
      snapshotSettings: appRow.snapshot_settings,
      estimatedCredits: appRow.estimated_credits,
      creatorId: appRow.creator_id,
      maxRunsPerUserPerDay: appRow.max_runs_per_user_per_day,
      createdAt: appRow.created_at,
    })
  })

  // --- Run the app (auth required, runner pays) ---
  app.post("/v1/app/:slug/run", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = slugParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid app slug" },
      })
    }

    const bodyParsed = runBody.safeParse(req.body ?? {})
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid request body" },
      })
    }

    const { slug } = paramsParsed.data
    const { inputOverrides, runId } = bodyParsed.data

    // Load app by slug
    const { data: appRow, error: appError } = await supabase
      .from("published_apps")
      .select("id, workflow_id, max_runs_per_user_per_day, snapshot_nodes, snapshot_edges")
      .eq("slug", slug)
      .eq("is_active", true)
      .single()

    if (appError || !appRow) {
      return reply.status(404).send({
        error: { code: "not_found", message: "App not found" },
      })
    }

    // Run rate limit + active execution checks in parallel
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)

    const [rateLimitResult, activeExecResult] = await Promise.all([
      appRow.max_runs_per_user_per_day != null
        ? supabase
            .from("app_runs")
            .select("id", { count: "exact", head: true })
            .eq("app_id", appRow.id)
            .eq("runner_id", req.userId)
            .gte("created_at", todayStart.toISOString())
        : null,
      // Check for active executions scoped to THIS app (not workflow-wide)
      supabase
        .from("app_runs")
        .select("execution_id, workflow_executions!inner(id, status)")
        .eq("app_id", appRow.id)
        .eq("runner_id", req.userId)
        .in("workflow_executions.status", ACTIVE_EXECUTION_STATUSES as unknown as string[])
        .limit(1),
    ])

    if (rateLimitResult?.error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to check rate limit" },
      })
    }

    if (
      appRow.max_runs_per_user_per_day != null &&
      (rateLimitResult?.count ?? 0) >= appRow.max_runs_per_user_per_day
    ) {
      return reply.status(429).send({
        error: {
          code: "rate_limit_exceeded",
          message: `Daily run limit of ${appRow.max_runs_per_user_per_day} reached for this app`,
        },
      })
    }

    if (activeExecResult?.error) {
      console.error("[app-runner] Active execution check failed:", activeExecResult.error.message)
    }
    const activeRuns = activeExecResult?.data
    if (activeRuns && activeRuns.length > 0) {
      return reply.status(409).send({
        error: {
          code: "already_running",
          message: "You already have an active execution for this app",
        },
        executionId: activeRuns[0].execution_id,
      })
    }

    // Create workflow_execution under runner's userId
    const { data: execution, error: execError } = await supabase
      .from("workflow_executions")
      .insert({
        workflow_id: appRow.workflow_id,
        user_id: req.userId,
        status: "pending",
        trigger_type: "manual",
      })
      .select("id")
      .single()

    if (execError || !execution) {
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to create execution" },
      })
    }

    let appRunId: string

    if (runId) {
      // Link existing draft run to this execution
      const { data: updated, error: updateError } = await supabase
        .from("app_runs")
        .update({
          execution_id: execution.id,
          status: "running",
          input_values: inputOverrides ?? undefined,
        })
        .eq("id", runId)
        .eq("runner_id", req.userId)
        .select("id")
        .single()

      if (updateError || !updated) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Run not found" },
        })
      }
      appRunId = updated.id
    } else {
      // Create new app_run record
      const { data: appRun, error: runError } = await supabase
        .from("app_runs")
        .insert({
          app_id: appRow.id,
          execution_id: execution.id,
          runner_id: req.userId,
          status: "running",
          input_values: inputOverrides ?? undefined,
        })
        .select("id")
        .single()

      if (runError || !appRun) {
        return reply.status(500).send({
          error: { code: "internal_error", message: "Failed to create app run" },
        })
      }
      appRunId = appRun.id
    }

    // Enqueue orchestration job — use the app's workflow_id since the orchestrator loads by workflow ID
    const jobData: WorkflowExecutionJob = {
      executionId: execution.id,
      workflowId: appRow.workflow_id,
      userId: req.userId,
      triggerType: "manual",
      inputOverrides,
    }

    await orchestrationQueue.add("workflow-execution", jobData, {
      jobId: execution.id,
    })

    return reply.status(202).send({
      executionId: execution.id,
      runId: appRunId,
      status: "pending",
    })
  })

  // --- Create a draft run (no execution yet) ---
  app.post("/v1/app/:slug/runs", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = slugParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid app slug" },
      })
    }

    const bodyParsed = createRunBody.safeParse(req.body ?? {})
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid request body" },
      })
    }

    const { slug } = paramsParsed.data
    const { inputValues } = bodyParsed.data

    // Load app by slug
    const { data: appRow, error: appError } = await supabase
      .from("published_apps")
      .select("id")
      .eq("slug", slug)
      .eq("is_active", true)
      .single()

    if (appError || !appRow) {
      return reply.status(404).send({
        error: { code: "not_found", message: "App not found" },
      })
    }

    const { data: run, error: runError } = await supabase
      .from("app_runs")
      .insert({
        app_id: appRow.id,
        runner_id: req.userId,
        input_values: inputValues ?? {},
        status: "draft",
      })
      .select("id, created_at, input_values, status")
      .single()

    if (runError || !run) {
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to create run" },
      })
    }

    return reply.status(201).send({
      id: run.id,
      createdAt: run.created_at,
      inputValues: run.input_values,
      status: run.status,
    })
  })

  // --- Update a draft run's input values ---
  app.patch("/v1/app/:slug/runs/:runId", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = slugRunParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid parameters" },
      })
    }

    const bodyParsed = updateRunBody.safeParse(req.body ?? {})
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid request body" },
      })
    }

    const { runId } = paramsParsed.data
    const { inputValues } = bodyParsed.data

    const { data: run, error: runError } = await supabase
      .from("app_runs")
      .update({ input_values: inputValues })
      .eq("id", runId)
      .eq("runner_id", req.userId)
      .select("id, input_values")
      .single()

    if (runError || !run) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Run not found" },
      })
    }

    return reply.send({ id: run.id, inputValues: run.input_values })
  })

  // --- List runner's past runs for this app ---
  app.get("/v1/app/:slug/runs", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = slugParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid app slug" },
      })
    }

    const queryParsed = runsQuery.safeParse(req.query)
    if (!queryParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid query parameters" },
      })
    }

    const { slug } = paramsParsed.data
    const { cursor, limit } = queryParsed.data

    // Load app by slug
    const { data: appRow, error: appError } = await supabase
      .from("published_apps")
      .select("id")
      .eq("slug", slug)
      .eq("is_active", true)
      .single()

    if (appError || !appRow) {
      return reply.status(404).send({
        error: { code: "not_found", message: "App not found" },
      })
    }

    // Build query for app_runs joined with workflow_executions
    let query = supabase
      .from("app_runs")
      .select(
        "id, created_at, execution_id, input_values, status, workflow_executions(status, node_states, completed_nodes, total_nodes, completed_at)"
      )
      .eq("app_id", appRow.id)
      .eq("runner_id", req.userId)
      .order("created_at", { ascending: false })
      .limit(limit + 1) // fetch one extra for cursor

    if (cursor) {
      // Cursor is the id of the last item from the previous page
      // We need the created_at of that item for cursor-based pagination
      const { data: cursorRow } = await supabase
        .from("app_runs")
        .select("created_at")
        .eq("id", cursor)
        .single()

      if (cursorRow) {
        query = query.lt("created_at", cursorRow.created_at)
      }
    }

    const { data: runs, error: runsError } = await query

    if (runsError) {
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to fetch runs" },
      })
    }

    const hasMore = (runs?.length ?? 0) > limit
    const items = (runs ?? []).slice(0, limit)

    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : undefined

    return reply.send({
      data: items.map((run) => {
        const exec = run.workflow_executions as unknown as {
          status: string
          node_states: unknown
          completed_nodes: number | null
          total_nodes: number | null
          completed_at: string | null
        } | null

        return {
          id: run.id,
          executionId: run.execution_id ?? null,
          createdAt: run.created_at,
          inputValues: run.input_values ?? null,
          status: exec?.status ?? (run as { status?: string }).status ?? "draft",
          nodeStates: exec?.node_states ?? null,
          completedNodes: exec?.completed_nodes ?? 0,
          totalNodes: exec?.total_nodes ?? 0,
          completedAt: exec?.completed_at ?? null,
        }
      }),
      nextCursor,
    })
  })

  // --- Get run details ---
  app.get("/v1/app/:slug/runs/:runId", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = slugRunParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid parameters" },
      })
    }

    const { runId } = parsed.data

    const { data: run, error: runError } = await supabase
      .from("app_runs")
      .select(
        "id, app_id, runner_id, execution_id, input_values, status, created_at, workflow_executions(id, status, node_states, total_nodes, completed_nodes, failed_nodes, total_credits_used, error_message, completed_at)"
      )
      .eq("id", runId)
      .eq("runner_id", req.userId)
      .single()

    if (runError || !run) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Run not found" },
      })
    }

    const exec = run.workflow_executions as unknown as {
      id: string
      status: string
      node_states: unknown
      total_nodes: number | null
      completed_nodes: number | null
      failed_nodes: number | null
      total_credits_used: number | null
      error_message: string | null
      completed_at: string | null
    } | null

    return reply.send({
      id: run.id,
      appId: run.app_id,
      executionId: run.execution_id ?? null,
      inputValues: run.input_values ?? null,
      status: (run as { status?: string }).status ?? "draft",
      createdAt: run.created_at,
      execution: exec
        ? {
            id: exec.id,
            status: exec.status,
            nodeStates: exec.node_states,
            totalNodes: exec.total_nodes,
            completedNodes: exec.completed_nodes,
            failedNodes: exec.failed_nodes,
            totalCreditsUsed: exec.total_credits_used,
            errorMessage: exec.error_message,
            completedAt: exec.completed_at,
          }
        : null,
    })
  })

  // --- Delete run from history ---
  app.delete("/v1/app/:slug/runs/:runId", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = slugRunParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid parameters" },
      })
    }

    const { runId } = parsed.data

    // Verify ownership before deleting
    const { data: run, error: findError } = await supabase
      .from("app_runs")
      .select("id")
      .eq("id", runId)
      .eq("runner_id", req.userId)
      .single()

    if (findError || !run) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Run not found" },
      })
    }

    const { error: deleteError } = await supabase
      .from("app_runs")
      .delete()
      .eq("id", runId)
      .eq("runner_id", req.userId)

    if (deleteError) {
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to delete run" },
      })
    }

    return reply.send({ success: true })
  })
}
