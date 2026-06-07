/**
 * Webhook trigger + workflow trigger CRUD routes.
 *
 * POST /v1/webhooks/:token     — Fire webhook (no auth, token IS auth)
 * POST /v1/workflow-triggers   — Create trigger (webhook or schedule)
 * GET  /v1/workflows/:id/triggers — List triggers for workflow
 * PATCH /v1/workflow-triggers/:id — Update trigger
 * DELETE /v1/workflow-triggers/:id — Delete trigger
 */

import { randomBytes } from "node:crypto"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { orchestrationQueue } from "../lib/orchestration-queue.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"
import { formatZodError } from "../lib/zod-error.js"

// ---------------------------------------------------------------------------
// Rate limiter for webhook endpoint (in-memory, per-token)
// ---------------------------------------------------------------------------

const webhookRateLimits = new Map<string, { count: number; resetAt: number }>()
const WEBHOOK_RATE_LIMIT = 10 // per minute
const WEBHOOK_RATE_WINDOW_MS = 60_000

function checkWebhookRateLimit(token: string): boolean {
  const now = Date.now()
  const entry = webhookRateLimits.get(token)

  if (!entry || now >= entry.resetAt) {
    webhookRateLimits.set(token, { count: 1, resetAt: now + WEBHOOK_RATE_WINDOW_MS })
    return true
  }

  if (entry.count >= WEBHOOK_RATE_LIMIT) return false
  entry.count++
  return true
}

// Periodic cleanup of stale entries
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of webhookRateLimits) {
    if (now >= entry.resetAt) webhookRateLimits.delete(key)
  }
}, 60_000)

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const webhookTokenParams = z.object({
  token: z.string().min(16).max(128),
})

const createTriggerBody = z.object({
  workflowId: z.string().uuid(),
  type: z.enum(["webhook", "schedule"]),
  config: z.object({
    cron: z.string().max(100).optional(),
    timezone: z.string().max(50).optional(),
    interval: z.string().max(50).optional(),
    maxExecutions: z.number().int().min(0).optional(),
  }).optional(),
})

const updateTriggerBody = z.object({
  isActive: z.boolean().optional(),
  config: z.object({
    cron: z.string().max(100).optional(),
    timezone: z.string().max(50).optional(),
    interval: z.string().max(50).optional(),
    maxExecutions: z.number().int().min(0).optional(),
  }).optional(),
})

const triggerIdParams = z.object({
  id: z.string().uuid(),
})

const workflowIdParams = z.object({
  id: z.string().uuid(),
})

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function webhookTriggerRoutes(app: FastifyInstance) {
  // --- Fire webhook (PUBLIC — no auth required) ---
  app.post("/v1/webhooks/:token", async (req, reply) => {
    const parsed = webhookTokenParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid webhook token" },
      })
    }

    const { token } = parsed.data

    // Rate limit
    if (!checkWebhookRateLimit(token)) {
      return reply.status(429).send({
        error: { code: "rate_limited", message: "Too many requests. Max 10 per minute." },
      })
    }

    // Look up trigger by token
    const { data: trigger, error: triggerError } = await supabase
      .from("workflow_triggers")
      .select("id, workflow_id, user_id, type, config, is_active, last_triggered_at")
      .eq("webhook_token", token)
      .single()

    if (triggerError || !trigger) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Webhook not found" },
      })
    }

    if (!trigger.is_active) {
      return reply.status(403).send({
        error: { code: "trigger_inactive", message: "This webhook trigger is inactive" },
      })
    }

    // Check for already-running execution
    const { data: activeExec } = await supabase
      .from("workflow_executions")
      .select("id")
      .eq("workflow_id", trigger.workflow_id)
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

    // Extract trigger data from request body. Inject system fields LAST so a
    // user-posted body can't shadow `last_triggered_at` (webhook tokens are
    // public auth — without this, an attacker could POST a future timestamp
    // to bypass any `{{trigger.last_triggered_at}}` filter).
    const userBody = (req.body as Record<string, unknown>) ?? {}
    const previousLastTriggeredAt = trigger.last_triggered_at as string | null
    const triggerData: Record<string, unknown> = {
      ...userBody,
      last_triggered_at: previousLastTriggeredAt,
    }

    // Create execution. The idempotency_key makes the "already-running" guard
    // above race-proof: two webhook fires that BOTH passed the activeExec SELECT
    // (the TOCTOU window) share the same (triggerId, previousLastTriggeredAt) —
    // the first hasn't updated last_triggered_at yet — so the second INSERT
    // collides on workflow_executions_idempotency_uniq (user_id, idempotency_key)
    // and is rejected atomically instead of double-executing (double-charging).
    const idempotencyKey = `webhook:${trigger.id}:${previousLastTriggeredAt ?? "initial"}`
    const { data: execution, error: execError } = await supabase
      .from("workflow_executions")
      .insert({
        workflow_id: trigger.workflow_id,
        user_id: trigger.user_id,
        status: "pending",
        trigger_type: "webhook",
        trigger_data: triggerData,
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single()

    if (execError?.code === "23505") {
      // Concurrent duplicate fire — another request already created this trigger
      // event's execution. Treat as already-running (no second charge).
      return reply.status(409).send({
        error: {
          code: "already_running",
          message: "This workflow already has an active execution for this trigger event",
        },
      })
    }
    if (execError || !execution) {
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to create execution" },
      })
    }

    // Update trigger last_triggered_at
    await supabase
      .from("workflow_triggers")
      .update({ last_triggered_at: new Date().toISOString() })
      .eq("id", trigger.id)

    // Enqueue orchestration
    const jobData: WorkflowExecutionJob = {
      executionId: execution.id,
      workflowId: trigger.workflow_id,
      userId: trigger.user_id,
      triggerType: "webhook",
      triggerData,
    }

    await orchestrationQueue.add("workflow-execution", jobData, {
      jobId: execution.id,
    })

    return reply.status(202).send({
      executionId: execution.id,
      status: "pending",
    })
  })

  // --- Create trigger ---
  app.post("/v1/workflow-triggers", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = createTriggerBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { workflowId, type, config: triggerConfig } = parsed.data

    // Verify workflow belongs to user
    const { data: workflow } = await supabase
      .from("workflows")
      .select("id")
      .eq("id", workflowId)
      .eq("user_id", req.userId)
      .single()

    if (!workflow) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Workflow not found" },
      })
    }

    // Generate webhook token for webhook triggers
    const webhookToken = type === "webhook"
      ? randomBytes(32).toString("hex")
      : null

    const { data: trigger, error } = await supabase
      .from("workflow_triggers")
      .insert({
        workflow_id: workflowId,
        user_id: req.userId,
        type,
        config: triggerConfig ?? {},
        webhook_token: webhookToken,
      })
      .select("*")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return reply.status(201).send({
      data: toTriggerResponse(trigger),
    })
  })

  // --- List triggers for workflow ---
  app.get("/v1/workflows/:id/triggers", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = workflowIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid workflow ID",
        },
      })
    }

    const { data, error } = await supabase
      .from("workflow_triggers")
      .select("*")
      .eq("workflow_id", parsed.data.id)
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false })

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return {
      data: (data ?? []).map(toTriggerResponse),
    }
  })

  // --- Update trigger ---
  app.patch("/v1/workflow-triggers/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = triggerIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsParsed.error.issues[0]?.message ?? "Invalid trigger ID",
        },
      })
    }

    const bodyParsed = updateTriggerBody.safeParse(req.body)
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyParsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const updates: Record<string, unknown> = {}
    if (bodyParsed.data.isActive !== undefined) updates.is_active = bodyParsed.data.isActive
    if (bodyParsed.data.config !== undefined) updates.config = bodyParsed.data.config

    const { data, error } = await supabase
      .from("workflow_triggers")
      .update(updates)
      .eq("id", paramsParsed.data.id)
      .eq("user_id", req.userId)
      .select("*")
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Trigger not found" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: toTriggerResponse(data) }
  })

  // --- Delete trigger ---
  app.delete("/v1/workflow-triggers/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = triggerIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid trigger ID",
        },
      })
    }

    const { error } = await supabase
      .from("workflow_triggers")
      .delete()
      .eq("id", parsed.data.id)
      .eq("user_id", req.userId)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { success: true }
  })
}

// ---------------------------------------------------------------------------
// Response formatter
// ---------------------------------------------------------------------------

function toTriggerResponse(row: Record<string, unknown>) {
  const resp: Record<string, unknown> = {
    id: row.id,
    workflowId: row.workflow_id,
    userId: row.user_id,
    type: row.type,
    config: row.config,
    isActive: row.is_active,
    lastTriggeredAt: row.last_triggered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }

  // Include webhook URL for webhook triggers
  if (row.webhook_token) {
    resp.webhookToken = row.webhook_token
    resp.webhookUrl = `/v1/webhooks/${row.webhook_token}`
  }

  return resp
}
