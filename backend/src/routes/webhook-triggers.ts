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
import { sendInternalError } from "../lib/http-errors.js"
import { deletedNothing, sendNotFound } from "../lib/scoped-delete.js"
import { orchestrationQueue } from "../lib/orchestration-queue.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"
import { formatZodError } from "../lib/zod-error.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { accessAtLeast, canRunWorkflow, workflowAccessFromRow } from "../lib/workflow-access.js"
import { resolveBillingContext, shouldRefuseDegradedRunFor } from "../lib/billing-context.js"
import { billingPairColumns } from "../lib/insert-job.js"
import { recordTriggerFireRefusal } from "../lib/trigger-fire-refusal.js"
import { toAccessRow } from "../lib/workflow-route-access.js"

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

    // Does the trigger's owner STILL have the right to run this workflow?
    //
    // Asked on every fire, because a trigger is the one capability in the
    // product that outlives the session that created it. The token is the
    // authentication and it never expires; before workflows could be shared
    // only their creator could mint one, so "the owner may still run this" was
    // true by construction. It is not any more: a collaborator can create a
    // trigger and then lose the grant, be suspended from the workspace, or
    // watch it be archived — and without this the URL keeps firing, keeps
    // running the CURRENT graph, and keeps writing results into an execution
    // row they are still allowed to read.
    //
    // Refuse WITHOUT deactivating. `canRunWorkflow` returns false for a
    // transient plugin/database outage the same as for a real revocation
    // (`loadWorkflow` returns null on error, `assembleInput` fails closed), so
    // a `is_active = false` write here would turn a Redis blip into a
    // permanently dead trigger a human has to notice and re-enable. Refusing
    // the one fire is free to retry; the check is one access lookup and the
    // route is rate-limited to 10/min. The 404 is the same answer an unknown
    // token gets, so a revoked URL learns nothing about whether it was real.
    if (!(await canRunWorkflow(trigger.user_id as string, trigger.workflow_id as string))) {
      // P14/W6: the refusal must be VISIBLE to the owner — one failed row
      // with the stable code (deduped) — while the caller keeps getting the
      // oracle-free 404 an unknown token gets.
      await recordTriggerFireRefusal({
        workflowId: trigger.workflow_id as string,
        userId: trigger.user_id as string,
        triggerType: "webhook",
        triggerId: trigger.id as string,
      })
      return reply.status(404).send({
        error: { code: "not_found", message: "Webhook not found" },
      })
    }

    // Check for an execution this trigger's owner already has running. Scoped
    // to them: before sharing, "an active execution of this workflow" and "an
    // active execution of MINE" were the same set, and widening the run path
    // silently turned this into one member being able to block a whole class
    // from running shared work.
    const { data: activeExec } = await supabase
      .from("workflow_executions")
      .select("id")
      .eq("workflow_id", trigger.workflow_id)
      .eq("user_id", trigger.user_id)
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
    // P14: payer resolved at FIRE TIME under the trigger's creator and the
    // workflow's CURRENT home; the row carries the pair (W7) and the payload
    // carries the context.
    const billingContext = await resolveBillingContext({
      userId: trigger.user_id as string,
      workflowId: trigger.workflow_id as string,
    })
    // P14: a DEGRADED resolve on WORKSPACE-HOMED (or unreadable-home) work
    // skips the fire rather than billing the owner's pocket — the ONE
    // fail-closed probe. The response stays the uniform 404 (the oracle
    // doctrine above outranks retry ergonomics for a transient outage);
    // the retry is simply the next fire.
    if (await shouldRefuseDegradedRunFor(billingContext, trigger.workflow_id as string)) {
      req.log.error({ triggerId: trigger.id }, "degraded billing resolve on workspace workflow — webhook fire skipped")
      return reply.status(404).send({ error: { code: "not_found", message: "Webhook not found" } })
    }
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
        ...billingPairColumns(billingContext),
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
      return sendInternalError(reply, req, execError, "Failed to create execution")
    }

    // Update trigger last_triggered_at
    await supabase
      .from("workflow_triggers")
      .update({ last_triggered_at: new Date().toISOString() })
      .eq("id", trigger.id)

    // Enqueue orchestration (payer resolved above, before the row; moving a
    // workflow into a workspace re-points its triggers' payer on the next
    // fire — the run predicate above refused a creator who lost access).
    const jobData: WorkflowExecutionJob = {
      executionId: execution.id,
      workflowId: trigger.workflow_id,
      userId: trigger.user_id,
      triggerType: "webhook",
      triggerData,
      billingContext,
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
  app.post("/v1/workflow-triggers", { preHandler: requireAppScope("workflows:write") }, async (req, reply) => {
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

    // Binding a trigger to a workflow takes `edit`: a trigger RUNS it, so
    // attaching one is at least as consequential as changing the canvas.
    const { data: workflow } = await supabase
      // tenant-scope-ignore: authorization follows immediately, below.
      .from("workflows")
      .select("id, user_id, workspace_id, visibility")
      .eq("id", workflowId)
      .maybeSingle()

    if (!workflow) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Workflow not found" },
      })
    }

    const access = await workflowAccessFromRow(req.userId, toAccessRow(workflow as unknown as Record<string, unknown>))
    if (access === "none") {
      return reply.status(404).send({
        error: { code: "not_found", message: "Workflow not found" },
      })
    }
    // `canRunWorkflow`, not `edit`. A trigger IS a run — a standing, unattended
    // one — so the bar has to be the one runs are held to, which is stricter:
    // `edit` plus active membership when the workflow belongs to a workspace.
    // Asking only `edit` here would have let somebody who is refused at
    // `POST /v1/workflows/:id/run` mint a webhook URL that runs it anyway.
    if (!(await canRunWorkflow(req.userId, workflowId))) {
      return reply.status(403).send({
        error: {
          code: "forbidden",
          message: accessAtLeast(access, "edit")
            ? "You are not a member of this workspace, so you cannot schedule its workflows"
            : "You do not have permission to do that",
        },
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
      return sendInternalError(reply, req, error, "Failed to create trigger")
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
      return sendInternalError(reply, req, error, "Failed to fetch triggers")
    }

    return {
      data: (data ?? []).map(toTriggerResponse),
    }
  })

  // --- Update trigger ---
  app.patch("/v1/workflow-triggers/:id", { preHandler: requireAppScope("workflows:write") }, async (req, reply) => {
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

    // RE-ENABLING is minting run capability again, so it asks the same question
    // creating a trigger asks. Without this, somebody whose access was revoked
    // could flip their own dormant trigger back to active — the fire paths
    // would still refuse it, but it has no business being re-armed by a person
    // who may no longer run the workflow. Load the trigger's workflow first;
    // the `.eq("user_id")` on the update keeps it to the owner's own trigger.
    if (bodyParsed.data.isActive === true) {
      const { data: trig } = await supabase
        .from("workflow_triggers")
        .select("workflow_id")
        .eq("id", paramsParsed.data.id)
        .eq("user_id", req.userId)
        .maybeSingle()
      if (!trig) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Trigger not found" },
        })
      }
      if (!(await canRunWorkflow(req.userId, trig.workflow_id as string))) {
        return reply.status(403).send({
          error: { code: "forbidden", message: "You can no longer run this workflow" },
        })
      }
    }

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
      return sendInternalError(reply, req, error, "Failed to update trigger")
    }

    return { data: toTriggerResponse(data) }
  })

  // --- Delete trigger ---
  app.delete("/v1/workflow-triggers/:id", { preHandler: requireAppScope("workflows:write") }, async (req, reply) => {
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

    const { data, error } = await supabase
      .from("workflow_triggers")
      .delete()
      .eq("id", parsed.data.id)
      .eq("user_id", req.userId)
      .select("id")

    if (error) {
      return sendInternalError(reply, req, error, "Failed to delete trigger")
    }
    if (deletedNothing(data)) return sendNotFound(reply, "Trigger not found")

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
