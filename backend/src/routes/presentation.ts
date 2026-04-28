/**
 * Presentation mode routes.
 * POST   /v1/workflows/:id/share     — Generate share token, enable presentation
 * DELETE /v1/workflows/:id/share     — Revoke share token, disable presentation
 * GET    /v1/present/:token          — Get sanitized workflow by share token
 * POST   /v1/present/:token/run      — Run workflow with input overrides (viewer pays)
 * GET    /v1/present/:token/status/:execId — Poll execution status
 */

import crypto from "node:crypto"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { orchestrationQueue } from "../lib/orchestration-queue.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"
import { ACTIVE_EXECUTION_STATUSES } from "../lib/request-helpers.js"
import { estimateWorkflowCredits } from "../billing/credits.js"

const workflowIdParams = z.object({
  id: z.string().uuid(),
})

const shareTokenParams = z.object({
  token: z.string().min(1),
})

const statusParams = z.object({
  token: z.string().min(1),
  execId: z.string().uuid(),
})

const runBody = z.object({
  inputOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  runTarget: z.enum(["workflow", "sub-workflow", "route"]).optional(),
  subWorkflowNodeId: z.string().optional(),
  selectedRouteId: z.string().optional(),
})

export async function presentationRoutes(app: FastifyInstance) {
  // --- Enable sharing (generate token) ---
  app.post("/v1/workflows/:id/share", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = workflowIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid workflow ID" },
      })
    }

    const { id: workflowId } = parsed.data

    // Verify ownership
    const { data: workflow, error: wfError } = await supabase
      .from("workflows")
      .select("id, user_id, share_token")
      .eq("id", workflowId)
      .eq("user_id", req.userId)
      .single()

    if (wfError || !workflow) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Workflow not found" },
      })
    }

    // If already shared, return existing token
    if (workflow.share_token) {
      return reply.send({
        shareToken: workflow.share_token,
        isPresentation: true,
      })
    }

    // Generate new 32-byte hex token
    const shareToken = crypto.randomBytes(32).toString("hex")

    const { error: updateError } = await supabase
      .from("workflows")
      .update({
        share_token: shareToken,
        is_presentation_enabled: true,
      })
      .eq("id", workflowId)
      .eq("user_id", req.userId)

    if (updateError) {
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to enable sharing" },
      })
    }

    return reply.send({
      shareToken,
      isPresentation: true,
    })
  })

  // --- Disable sharing (revoke token) ---
  app.delete("/v1/workflows/:id/share", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = workflowIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid workflow ID" },
      })
    }

    const { id: workflowId } = parsed.data

    const { error: updateError } = await supabase
      .from("workflows")
      .update({
        share_token: null,
        is_presentation_enabled: false,
      })
      .eq("id", workflowId)
      .eq("user_id", req.userId)

    if (updateError) {
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to disable sharing" },
      })
    }

    return reply.send({ success: true })
  })

  // --- Get shared workflow (public — auth optional for isOwner check) ---
  app.get("/v1/present/:token", async (req, reply) => {
    const parsed = shareTokenParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid share token" },
      })
    }

    const { token } = parsed.data

    // Use service-role supabase to bypass RLS (share_token lookup)
    const { data: workflow, error: wfError } = await supabase
      .from("workflows")
      .select("id, name, nodes, edges, settings, user_id, is_presentation_enabled")
      .eq("share_token", token)
      .eq("is_presentation_enabled", true)
      .single()

    if (wfError || !workflow) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Shared workflow not found" },
      })
    }

    // isOwner only if user is authenticated and owns the workflow
    const isOwner = !!req.userId && workflow.user_id === req.userId

    // Estimate credit cost from executable nodes
    const wfNodes = (workflow.nodes ?? []) as Array<{ type: string; data?: Record<string, unknown> }>
    const estimatedCost = estimateWorkflowCredits(wfNodes)

    // Extract presentation settings from workflow settings
    const settings = (workflow.settings ?? {}) as Record<string, unknown>
    const presentationSettings = settings.presentationSettings as { runTarget: string; subWorkflowNodeId?: string } | undefined

    return reply.send({
      workflowId: workflow.id,
      name: workflow.name,
      nodes: workflow.nodes,
      edges: workflow.edges,
      isOwner,
      estimatedCost,
      presentationSettings: presentationSettings ?? { runTarget: "workflow" },
    })
  })

  // --- Run shared workflow (viewer pays) ---
  app.post("/v1/present/:token/run", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = shareTokenParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid share token" },
      })
    }

    const bodyParsed = runBody.safeParse(req.body ?? {})
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid request body" },
      })
    }

    const { token } = paramsParsed.data
    const { inputOverrides, runTarget, subWorkflowNodeId, selectedRouteId } = bodyParsed.data

    // Look up workflow by share token
    const { data: workflow, error: wfError } = await supabase
      .from("workflows")
      .select("id, user_id, nodes, edges, settings, is_presentation_enabled")
      .eq("share_token", token)
      .eq("is_presentation_enabled", true)
      .single()

    if (wfError || !workflow) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Shared workflow not found" },
      })
    }

    // Enforce read-only for non-owners
    const wfSettings = (workflow.settings ?? {}) as Record<string, unknown>
    const presSettings = wfSettings.presentationSettings as { shareReadOnly?: boolean } | undefined
    if (presSettings?.shareReadOnly && workflow.user_id !== req.userId) {
      return reply.status(403).send({
        error: { code: "read_only", message: "This shared workflow is in read-only mode" },
      })
    }

    // Check for already-running execution by this viewer
    const { data: activeExec } = await supabase
      .from("workflow_executions")
      .select("id")
      .eq("workflow_id", workflow.id)
      .eq("user_id", req.userId)
      .in("status", ACTIVE_EXECUTION_STATUSES as unknown as string[])
      .limit(1)

    if (activeExec && activeExec.length > 0) {
      return reply.status(409).send({
        error: {
          code: "already_running",
          message: "You already have an active execution for this workflow",
        },
        executionId: activeExec[0].id,
      })
    }

    // Create execution under the VIEWER's userId (viewer pays credits)
    const { data: execution, error: execError } = await supabase
      .from("workflow_executions")
      .insert({
        workflow_id: workflow.id,
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

    // Compute nodeIds if targeting a specific sub-workflow node
    let nodeIds: string[] | undefined
    if (runTarget === "sub-workflow" && subWorkflowNodeId) {
      nodeIds = [subWorkflowNodeId]
    } else if (runTarget === "route" && selectedRouteId) {
      const { getRouteReachableNodeIds } = await import("@nodaro/shared")
      const wfNodes = (workflow.nodes ?? []) as Array<{ id: string; type?: string; data: Record<string, unknown> }>
      const wfEdges = (workflow.edges ?? []) as Array<{ source: string; target: string }>
      const reachable = getRouteReachableNodeIds(wfNodes, wfEdges, selectedRouteId)
      if (reachable.size > 0) {
        nodeIds = [...reachable]
      }
      // If empty (stale routeId), fall through with nodeIds=undefined → runs entire workflow
    }

    // Enqueue orchestration job
    const jobData: WorkflowExecutionJob = {
      executionId: execution.id,
      workflowId: workflow.id,
      userId: req.userId,
      triggerType: "manual",
      inputOverrides,
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

  // --- Poll execution status (for shared workflow viewer) ---
  app.get("/v1/present/:token/status/:execId", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = statusParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid parameters" },
      })
    }

    const { execId } = parsed.data

    // Verify execution belongs to the viewer
    const { data: execution, error: execError } = await supabase
      .from("workflow_executions")
      .select("id, status, node_states, total_nodes, completed_nodes, failed_nodes, total_credits_used, error_message, completed_at")
      .eq("id", execId)
      .eq("user_id", req.userId)
      .single()

    if (execError || !execution) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Execution not found" },
      })
    }

    return reply.send(execution)
  })
}
