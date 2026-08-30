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
import { sendInternalError } from "../lib/http-errors.js"
import { orchestrationQueue } from "../lib/orchestration-queue.js"
import { personalPayer, shouldRefuseDegradedRun } from "../lib/billing-context.js"
import { billingPairColumns } from "../lib/insert-job.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"
import { ACTIVE_EXECUTION_STATUSES } from "../lib/request-helpers.js"
import { estimateWorkflowCredits } from "../ee/billing/credits.js"

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

/**
 * Public presentation links — deliberately OUTSIDE the workflow access rule.
 *
 * Two halves, both left as they are on purpose when the by-id workflow routes
 * moved onto `workflowAccess`, and both easy to mistake for something that was
 * forgotten:
 *
 * 1. **The `share_token` reads** (`GET /v1/present/:token`, `POST
 *    /v1/present/:token/run`) load a workflow with the service-role client and
 *    no access check at all. That is what a share link IS: it is read by
 *    someone who is not signed in and has no access level to consult. The
 *    unguessable token is the credential. Converting these to `workflowAccess`
 *    would break every public share link in the product.
 *
 * 2. **The owner-side `POST`/`DELETE /v1/workflows/:id/share`** stay
 *    creator-only. Enabling a public link is a disclosure decision, not an
 *    edit — the same class of lever as `visibility` — and the row policy that
 *    governs it in the browser (`check_workflows_update_allowed`, migration
 *    338) pins `share_token` and `is_presentation_enabled` to the creator or a
 *    workspace admin. Widening these routes to `edit` would make the API
 *    strictly more permissive than the database underneath it. Creator-only is
 *    narrower than both and therefore safe; adding the workspace-admin half is
 *    a deliberate decision to take with the visibility rule, not a side effect
 *    of a scoping pass.
 */
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
      return sendInternalError(reply, req, updateError, "Failed to enable sharing")
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
      return sendInternalError(reply, req, updateError, "Failed to disable sharing")
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
      // workspace_id is LOAD-BEARING for the P14 degraded-refusal below —
      // removing it from this list silently restores a fail-open path.
      .select("id, name, nodes, edges, settings, user_id, workspace_id, is_presentation_enabled")
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

    // P14: a DEGRADED resolve on WORKSPACE-HOMED work refuses rather than
    // billing the viewer's pocket for class work. Retryable. The home comes
    // off the row this route already loaded — no second query, no probe to
    // fail open.
    if (req.billingContext && shouldRefuseDegradedRun(req.billingContext, (workflow as { workspace_id?: string | null }).workspace_id)) {
      return reply.status(503).send({
        error: { code: "billing_unavailable", message: "Billing is temporarily unavailable for workspace runs. Try again shortly." },
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
        // P14/W7: the hook-resolved payer's pair (personal adds nothing).
        ...billingPairColumns(req.billingContext),
      })
      .select("id")
      .single()

    if (execError || !execution) {
      return sendInternalError(reply, req, execError, "Failed to create execution")
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
      // P14: the viewer's authenticated context (a shared-workflow run —
      // the VIEWER pays; share-token runs have no member and stay personal).
      billingContext: req.billingContext ?? personalPayer(req.userId),
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
