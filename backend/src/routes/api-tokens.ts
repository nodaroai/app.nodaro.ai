/**
 * API token management + public workflow API routes.
 *
 * Token management (JWT auth required):
 *   POST   /v1/api-tokens           — Create token
 *   GET    /v1/api-tokens           — List user's tokens
 *   PATCH  /v1/api-tokens/:id       — Update token
 *   DELETE /v1/api-tokens/:id       — Delete token
 *
 * Public API (Bearer token auth, no JWT):
 *   GET    /v1/api/workflows         — List accessible workflows
 *   GET    /v1/api/schema            — Get workflow input/output schema
 *   POST   /v1/api/run               — Execute workflow
 *   GET    /v1/api/status/:execId    — Poll execution status
 *   GET    /v1/api/result/:execId    — Get final outputs
 */

import { randomBytes } from "node:crypto"
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { hasAdmin, hasOrganizations } from "../lib/config.js"
import { hashApiToken, invalidateApiTokenCache, resolveApiToken } from "../lib/api-token-resolver.js"
import { getPluginServices } from "../lib/private-plugins/load.js"
import { rejectProgrammaticAuth } from "../lib/api-auth-mode.js"
import { orchestrationQueue } from "../lib/orchestration-queue.js"
import { personalPayer } from "../lib/billing-context.js"
import { deploymentPayerActive, deploymentPayerId } from "../lib/deployment-payer.js"
import { billingPairColumns } from "../lib/insert-job.js"
import { estimateWorkflowCredits } from "../ee/billing/credits.js"
import type { WorkflowExecutionJob, NodeExecutionState } from "../services/workflow-engine/types.js"
import { normalizeLegacyNodeTypes } from "../services/workflow-engine/normalize-node-types.js"
import { getInputNodes, getOutputNodes, getOutputType, getNodeLabel, getInputFieldSchema, flattenItems, migrateToItems } from "@nodaro/shared"
import type { PresentationItem, GenericNode, GenericEdge } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { deletedNothing, sendNotFound } from "../lib/scoped-delete.js"

// ---------------------------------------------------------------------------
// Rate limiter (in-memory, per token hash)
// ---------------------------------------------------------------------------

const apiRateLimits = new Map<string, { count: number; resetAt: number }>()

function checkApiRateLimit(tokenHash: string, limit: number): boolean {
  const now = Date.now()
  const entry = apiRateLimits.get(tokenHash)

  if (!entry || now >= entry.resetAt) {
    apiRateLimits.set(tokenHash, { count: 1, resetAt: now + 60_000 })
    return true
  }

  if (entry.count >= limit) return false
  entry.count++
  return true
}

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of apiRateLimits) {
    if (now >= entry.resetAt) apiRateLimits.delete(key)
  }
}, 60_000)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractBearerToken(req: FastifyRequest): string | null {
  const auth = req.headers.authorization
  if (!auth?.startsWith("Bearer ")) return null
  return auth.slice(7)
}

/** Returns invalid workflow IDs not owned by the user, or empty array if all valid. */
/**
 * Which of these workflow ids may this token be bound to?
 *
 * Personal workflows only, and that is a decision rather than an oversight: a
 * personal API token is a long-lived credential its owner can paste anywhere,
 * so letting one reach work that belongs to a workspace would make a leaked
 * token everyone's problem instead of one person's. Opening that up is a
 * product decision for whoever wants it, not a side effect of scoping.
 *
 * The `.is("workspace_id", null)` is a no-op today (nothing carries a
 * workspace yet) and closes the question before it can be answered by
 * accident.
 */
async function validateWorkflowOwnership(userId: string, workflowIds: string[]): Promise<string[]> {
  if (workflowIds.length === 0) return []
  const { data: owned } = await supabase
    .from("workflows")
    .select("id")
    .eq("user_id", userId)
    .is("workspace_id", null)
    .in("id", workflowIds)

  const ownedIds = new Set((owned ?? []).map((w) => w.id))
  return workflowIds.filter((id) => !ownedIds.has(id))
}

function resolveInputOverrides(
  inputs: Record<string, Record<string, unknown>>,
  nodes: GenericNode[],
): Record<string, Record<string, unknown>> {
  const overrides: Record<string, Record<string, unknown>> = {}

  // Build label → nodeId map for label-based lookups
  const labelMap = new Map<string, string>()
  for (const node of nodes) {
    const label = getNodeLabel(node)
    // Only map if label is unique
    if (labelMap.has(label)) {
      labelMap.set(label, "__ambiguous__")
    } else {
      labelMap.set(label, node.id)
    }
  }

  // Also build a set of valid node IDs for fast lookup
  const nodeIdSet = new Set(nodes.map((n) => n.id))

  for (const [key, value] of Object.entries(inputs)) {
    if (nodeIdSet.has(key)) {
      // Key is a node ID
      overrides[key] = value
    } else {
      // Try label resolution
      const resolvedId = labelMap.get(key)
      if (resolvedId && resolvedId !== "__ambiguous__") {
        overrides[resolvedId] = value
      }
      // Skip if ambiguous or not found
    }
  }

  return overrides
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// JWT-only management: block OAuth app tokens AND personal API tokens (an OAuth
// app could otherwise mint an unscoped personal token → account takeover).
const API_TOKENS_JWT_ONLY_MSG = "API token management is only available from a logged-in session."

const createTokenBody = z.object({
  name: z.string().min(1).max(100),
  workflowIds: z.array(z.string().uuid()).max(50).default([]),
  rateLimit: z.number().int().min(1).max(120).default(30),
})

const updateTokenBody = z.object({
  name: z.string().min(1).max(100).optional(),
  workflowIds: z.array(z.string().uuid()).max(50).optional(),
  rateLimit: z.number().int().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
  /** Bind the token to a workspace, or null to unbind it. */
  workspaceId: z.string().uuid().nullable().optional(),
})

const tokenIdParams = z.object({
  id: z.string().uuid(),
})

const apiExecIdParams = z.object({
  execId: z.string().uuid(),
})

const runBody = z.object({
  workflowId: z.string().uuid(),
  inputs: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
})

const schemaQuery = z.object({
  workflowId: z.string().uuid(),
})

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function apiTokenRoutes(app: FastifyInstance) {
  // =========================================================================
  // Token CRUD (JWT auth required, edition-gated)
  // =========================================================================

  // --- Create token ---
  app.post("/v1/api-tokens", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // JWT-only: an OAuth app token (any scope) or personal API token must NOT be
    // able to mint a new — unscoped — personal token (privilege escalation).
    if (rejectProgrammaticAuth(req, reply, API_TOKENS_JWT_ONLY_MSG)) return

    if (!hasAdmin()) {
      return reply.status(403).send({
        error: { code: "edition_required", required_edition: "business", message: "API tokens require Business or Cloud edition" },
      })
    }

    // DEPLOYMENT PAYER: the money on this instance is the OPERATOR's, not the
    // requester's — every reservation debits one designated account. A personal
    // API token is the only credential class here with NO scope, NO spend cap,
    // NO expiry and no re-validation against the identity provider (neither
    // token branch of the auth hook consults surfaceSsoOnly(), so it keeps
    // working after the customer's IdP disowns its holder). Minted by an
    // ordinary federated user it is an unbounded, permanent draw on the payer's
    // pool. So on a payer instance only the billing account may create one.
    //
    // Hardening, not a hard gate: a token still spends the payer whoever holds
    // it, and per-user enforcement is the payer seam's own job. What this
    // removes is the credential CLASS. Creation only — listing, renaming and
    // deleting an already-issued token stay open, so a token minted before the
    // payer was configured can still be revoked by its owner.
    //
    // INERT without a payer: deploymentPayerActive() is `payerId !== null`, one
    // boolean read, zero queries — mainline behaves exactly as before.
    if (deploymentPayerActive() && req.userId !== deploymentPayerId()) {
      return reply.status(403).send({
        error: {
          code: "api_tokens_payer_only",
          message:
            "This deployment's usage is paid by one billing account. Only that account can create API tokens.",
        },
      })
    }

    const parsed = createTokenBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { name, workflowIds, rateLimit } = parsed.data

    // Check max 10 tokens per user
    const { count } = await supabase
      .from("api_tokens")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.userId)

    if ((count ?? 0) >= 10) {
      return reply.status(400).send({
        error: { code: "limit_reached", message: "Maximum 10 API tokens per user" },
      })
    }

    // Validate workflow ownership
    const invalidWfs = await validateWorkflowOwnership(req.userId, workflowIds)
    if (invalidWfs.length > 0) {
      return reply.status(400).send({
        error: { code: "invalid_workflow", message: `Workflows not found: ${invalidWfs.join(", ")}` },
      })
    }

    // Generate token: ndr_ + 32 random bytes hex
    const rawToken = randomBytes(32).toString("hex")
    const plaintext = `ndr_${rawToken}`
    const hash = hashApiToken(plaintext)
    const prefix = `ndr_${rawToken.slice(0, 4)}...`

    const { data: token, error } = await supabase
      .from("api_tokens")
      .insert({
        user_id: req.userId,
        name,
        token_hash: hash,
        token_prefix: prefix,
        workflow_ids: workflowIds,
        rate_limit: rateLimit,
      })
      .select("id, name, token_prefix, workflow_ids, rate_limit, is_active, created_at")
      .single()

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create token")
    }

    return reply.status(201).send({
      data: {
        ...formatToken(token),
        // Plaintext shown ONCE at creation time
        token: plaintext,
      },
    })
  })

  // --- List tokens ---
  app.get("/v1/api-tokens", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (rejectProgrammaticAuth(req, reply, API_TOKENS_JWT_ONLY_MSG)) return

    if (!hasAdmin()) {
      return reply.status(403).send({
        error: { code: "edition_required", required_edition: "business", message: "API tokens require Business or Cloud edition" },
      })
    }

    const { data, error } = await supabase
      .from("api_tokens")
      .select("id, name, token_prefix, workflow_ids, rate_limit, is_active, last_used_at, created_at, workspace_id")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to fetch API tokens")
    }

    return { data: (data ?? []).map(formatToken) }
  })

  // --- Update token ---
  app.patch("/v1/api-tokens/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (rejectProgrammaticAuth(req, reply, API_TOKENS_JWT_ONLY_MSG)) return

    const paramsParsed = tokenIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid token ID" },
      })
    }

    const bodyParsed = updateTokenBody.safeParse(req.body)
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: bodyParsed.error.issues[0]?.message ?? "Invalid request" },
      })
    }

    const updates: Record<string, unknown> = {}
    if (bodyParsed.data.name !== undefined) updates.name = bodyParsed.data.name
    if (bodyParsed.data.rateLimit !== undefined) updates.rate_limit = bodyParsed.data.rateLimit
    if (bodyParsed.data.isActive !== undefined) updates.is_active = bodyParsed.data.isActive
    if (bodyParsed.data.workflowIds !== undefined) {
      // Validate ownership of new workflow IDs
      const invalidWfs = await validateWorkflowOwnership(req.userId!, bodyParsed.data.workflowIds)
      if (invalidWfs.length > 0) {
        return reply.status(400).send({
          error: { code: "invalid_workflow", message: `Workflows not found: ${invalidWfs.join(", ")}` },
        })
      }
      updates.workflow_ids = bodyParsed.data.workflowIds
    }
    if (bodyParsed.data.workspaceId !== undefined) {
      // Unbinding needs no check — a token going back to the personal space
      // harms nobody.
      if (bodyParsed.data.workspaceId !== null) {
        // Asked, not re-derived. The obvious version — look for an active row
        // in the caller's memberships — is subtly wrong: an organization's
        // owner or admin is an admin of every workspace in it WITHOUT having a
        // membership row anywhere, so that check refuses exactly the people
        // most likely to want a workspace-bound token.
        //
        // This is the same question the context hook asks on every request, so
        // it is asked in the same way, of the same resolver. A binding that
        // would be refused as a header must be refused here too, or a token
        // could be bound to something it can never be used with.
        // The SAME gate the request-context hook uses. Without it a binding
        // could be accepted while the feature is off, and the header path —
        // which does check the flag — would ignore it: a token bound to a
        // workspace it can never actually be used in.
        const orgs = hasOrganizations() ? getPluginServices().orgs : undefined
        if (!orgs) {
          return reply.status(403).send({
            error: { code: "not_a_member", message: "Not a member of that workspace" },
          })
        }
        const verdict = await orgs.resolveRequestContext({
          userId: req.userId,
          headerWorkspaceId: bodyParsed.data.workspaceId,
          identityRoute: false,
        })
        if (verdict.reject || !verdict.workspaceId) {
          const rejection = verdict.reject ?? {
            status: 403 as const,
            code: "not_a_member",
            message: "Not a member of that workspace",
          }
          return reply.status(rejection.status).send({
            error: { code: rejection.code, message: rejection.message },
          })
        }
      }
      updates.workspace_id = bodyParsed.data.workspaceId
    }

    const { data, error } = await supabase
      .from("api_tokens")
      .update(updates)
      .eq("id", paramsParsed.data.id)
      .eq("user_id", req.userId)
      .select("id, name, token_prefix, workflow_ids, rate_limit, is_active, last_used_at, created_at, workspace_id")
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Token not found" },
        })
      }
      return sendInternalError(reply, req, error, "Failed to update token")
    }

    // The resolver caches a token for a minute and is keyed by hash, so
    // without this the edit does not take effect until the entry expires —
    // which for a workspace binding means requests still running in the
    // workspace the token was bound to a moment ago. Deactivating a token had
    // the same delay.
    invalidateApiTokenCache(paramsParsed.data.id)

    return { data: formatToken(data) }
  })

  // --- Delete token ---
  app.delete("/v1/api-tokens/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (rejectProgrammaticAuth(req, reply, API_TOKENS_JWT_ONLY_MSG)) return

    const parsed = tokenIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid token ID" },
      })
    }

    const { data, error } = await supabase
      .from("api_tokens")
      .delete()
      .eq("id", parsed.data.id)
      .eq("user_id", req.userId)
      .select("id")

    if (error) {
      return sendInternalError(reply, req, error, "Failed to delete token")
    }
    if (deletedNothing(data)) return sendNotFound(reply, "Token not found")

    invalidateApiTokenCache(parsed.data.id)

    return { success: true }
  })

  // =========================================================================
  // Public API endpoints (Bearer token auth, no JWT)
  // Scoped plugin with shared preHandler for token extraction + resolution
  // =========================================================================

  app.register(async function publicApiRoutes(api) {
    // Shared auth: extract Bearer token, resolve, attach to request
    api.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
      const token = extractBearerToken(req)
      if (!token) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Missing Authorization: Bearer <token> header" },
        })
      }

      const resolved = await resolveApiToken(token)
      if (!resolved) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Invalid or inactive API token" },
        })
      }

      req.apiToken = resolved
    })

    // --- List workflows ---
    api.get("/v1/api/workflows", async (req, reply) => {
      const resolved = req.apiToken!

      if (!checkApiRateLimit(resolved.tokenHash, resolved.rateLimit)) {
        return reply.status(429).send({
          error: { code: "rate_limited", message: `Too many requests. Max ${resolved.rateLimit} per minute.` },
        })
      }

      const query = req.query as Record<string, string>
      const limit = Math.min(Math.max(parseInt(query.limit ?? "50", 10) || 50, 1), 100)

      // Load workflows owned by user (scoped by token if configured).
      // Personal only — see validateWorkflowOwnership for why a token never
      // reaches workspace work.
      let dbQuery = supabase
        .from("workflows")
        .select("id, name, description, project_id, version, thumbnail_url, created_at, updated_at, nodes")
        .eq("user_id", resolved.userId)
        .is("workspace_id", null)
        .order("updated_at", { ascending: false })
        .limit(limit + 1)

      if (resolved.workflowIds.length > 0) {
        dbQuery = dbQuery.in("id", resolved.workflowIds)
      }

      if (query.cursor) {
        dbQuery = dbQuery.lt("updated_at", query.cursor)
      }

      const { data: workflows, error } = await dbQuery

      if (error) {
        return sendInternalError(reply, req, error, "Failed to fetch workflows")
      }

      const rows = workflows ?? []
      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows

      // Collect all unique sub-workflow IDs across returned workflows
      const subWorkflowIds = new Set<string>()
      for (const wf of page) {
        for (const node of ((wf.nodes ?? []) as GenericNode[])) {
          if (node.type === "sub-workflow" && node.data?.referencedWorkflowId) {
            subWorkflowIds.add(node.data.referencedWorkflowId as string)
          }
        }
      }

      // Batch-resolve sub-workflow names
      const subWorkflowNames = new Map<string, string>()
      if (subWorkflowIds.size > 0) {
        const { data: subWfs } = await supabase
          .from("workflows")
          .select("id, name")
          .eq("user_id", resolved.userId)
          .is("workspace_id", null)
          .in("id", Array.from(subWorkflowIds))

        for (const sw of subWfs ?? []) {
          subWorkflowNames.set(sw.id, sw.name)
        }
      }

      const data = page.map((wf) => {
        const seen = new Set<string>()
        const subWorkflows: Array<{ id: string; name: string }> = []
        for (const node of ((wf.nodes ?? []) as GenericNode[])) {
          if (node.type === "sub-workflow" && node.data?.referencedWorkflowId) {
            const refId = node.data.referencedWorkflowId as string
            const name = subWorkflowNames.get(refId)
            if (name && !seen.has(refId)) {
              seen.add(refId)
              subWorkflows.push({ id: refId, name })
            }
          }
        }

        return {
          id: wf.id,
          name: wf.name,
          description: wf.description ?? null,
          projectId: wf.project_id,
          version: wf.version ?? 1,
          thumbnailUrl: wf.thumbnail_url ?? null,
          createdAt: wf.created_at,
          updatedAt: wf.updated_at,
          subWorkflows,
        }
      })

      const nextCursor = hasMore ? page[page.length - 1]?.updated_at : undefined

      return reply.send({ data, nextCursor })
    })

    // --- Schema ---
    api.get("/v1/api/schema", async (req, reply) => {
      const resolved = req.apiToken!

      const queryParsed = schemaQuery.safeParse(req.query)
      if (!queryParsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "workflowId query parameter required" },
        })
      }

      const { workflowId } = queryParsed.data

      // Check workflow scoping
      if (resolved.workflowIds.length > 0 && !resolved.workflowIds.includes(workflowId)) {
        return reply.status(403).send({
          error: { code: "forbidden", message: "Token not authorized for this workflow" },
        })
      }

      // Load workflow
      const { data: workflow, error: wfError } = await supabase
        .from("workflows")
        .select("id, name, nodes, edges, settings")
        .eq("id", workflowId)
        .eq("user_id", resolved.userId)
        // Same personal-only doctrine as the run route below.
        .is("workspace_id", null)
        .single()

      if (wfError || !workflow) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Workflow not found" },
        })
      }

      // Normalize legacy node types (incl. loop→list) BEFORE classifying
      // inputs/outputs. The loop→list PR removed "loop" from NON_OUTPUT_TYPES,
      // so a raw un-migrated `loop` node would be misclassified as a workflow
      // OUTPUT in the API/SDK schema. Mirrors the orchestrator's
      // normalize-before-read invariant.
      const nodes = normalizeLegacyNodeTypes((workflow.nodes ?? []) as GenericNode[])
      const edges = (workflow.edges ?? []) as GenericEdge[]

      // Use curated nodes (presentationVisible) if any exist, otherwise use all
      const curatedInputs = getInputNodes(nodes, true)
      const inputNodes = curatedInputs.length > 0 ? curatedInputs : getInputNodes(nodes, false)

      const curatedOutputs = getOutputNodes(nodes, edges, true)
      const outputNodes = curatedOutputs.length > 0 ? curatedOutputs : getOutputNodes(nodes, edges, false)

      // Respect presentation ordering if available
      const settings = (workflow.settings ?? {}) as Record<string, unknown>
      const presSettings = settings.presentationSettings as {
        inputItems?: PresentationItem[]
        outputItems?: PresentationItem[]
        inputOrder?: string[]
        outputOrder?: string[]
      } | undefined

      // Read inputItems/outputItems with legacy fallback to inputOrder/outputOrder
      const inputItems: PresentationItem[] = presSettings?.inputItems
        ?? migrateToItems(presSettings?.inputOrder)
        ?? []
      const outputItems: PresentationItem[] = presSettings?.outputItems
        ?? migrateToItems(presSettings?.outputOrder)
        ?? []

      // Extract nodeIds from items for ordering
      const inputNodeIds = flattenItems(inputItems)
        .filter((item): item is Extract<PresentationItem, { type: "node" }> | Extract<PresentationItem, { type: "field" }> =>
          item.type === "node" || item.type === "field"
        )
        .map((item) => item.nodeId)
      const outputNodeIds = flattenItems(outputItems)
        .filter((item): item is Extract<PresentationItem, { type: "node" }> | Extract<PresentationItem, { type: "output" }> =>
          item.type === "node" || item.type === "output"
        )
        .map((item) => item.nodeId)

      const sortedInputs = inputNodeIds.length > 0
        ? sortByOrder(inputNodes, inputNodeIds)
        : inputNodes

      const sortedOutputs = outputNodeIds.length > 0
        ? sortByOrder(outputNodes, outputNodeIds)
        : outputNodes

      const estimatedCredits = estimateWorkflowCredits(nodes as Array<{ type: string; data?: Record<string, unknown> }>)

      const inputs = sortedInputs.map((node) => {
        const fieldSchema = getInputFieldSchema(node.type ?? "")
        return {
          nodeId: node.id,
          key: fieldSchema?.key ?? "value",
          label: getNodeLabel(node),
          type: fieldSchema?.type ?? "text",
          nodeType: node.type,
          required: false,
          default: fieldSchema ? node.data[fieldSchema.key] : undefined,
        }
      })

      const outputs = sortedOutputs.map((node) => ({
        nodeId: node.id,
        label: getNodeLabel(node),
        type: getOutputType(node.type),
        nodeType: node.type,
      }))

      return reply.send({
        workflowId: workflow.id,
        name: workflow.name,
        estimatedCredits,
        inputs,
        outputs,
      })
    })

    // --- Run workflow ---
    api.post("/v1/api/run", async (req, reply) => {
      const resolved = req.apiToken!

      const bodyParsed = runBody.safeParse(req.body)
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", message: bodyParsed.error.issues[0]?.message ?? "Invalid request" },
        })
      }

      // Rate limit
      if (!checkApiRateLimit(resolved.tokenHash, resolved.rateLimit)) {
        return reply.status(429).send({
          error: { code: "rate_limited", message: `Too many requests. Max ${resolved.rateLimit} per minute.` },
        })
      }

      const { workflowId, inputs } = bodyParsed.data

      // Check workflow scoping
      if (resolved.workflowIds.length > 0 && !resolved.workflowIds.includes(workflowId)) {
        return reply.status(403).send({
          error: { code: "forbidden", message: "Token not authorized for this workflow" },
        })
      }

      // Load workflow
      const { data: workflow, error: wfError } = await supabase
        .from("workflows")
        .select("id, nodes")
        .eq("id", workflowId)
        .eq("user_id", resolved.userId)
        // P9 doctrine, now enforced at RUN time too (bind + list always had
        // it): token runs are personal-only — a workspace-homed workflow is
        // not reachable through this lane, which is also why the P14
        // degraded-refusal is not needed here.
        .is("workspace_id", null)
        .single()

      if (wfError || !workflow) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Workflow not found" },
        })
      }

      // Build input overrides
      const nodes = (workflow.nodes ?? []) as GenericNode[]
      const inputOverrides = inputs
        ? resolveInputOverrides(inputs, nodes)
        : undefined

      // Create execution
      const { data: execution, error: execError } = await supabase
        .from("workflow_executions")
        .insert({
          workflow_id: workflowId,
          user_id: resolved.userId,
          status: "pending",
          trigger_type: "api",
          trigger_data: { apiTokenId: resolved.id },
          // P14/W7: the hook-resolved payer's pair (personal adds nothing).
          ...billingPairColumns(req.billingContext),
        })
        .select("id")
        .single()

      if (execError || !execution) {
        return sendInternalError(reply, req, execError, "Failed to create execution")
      }

      // Enqueue orchestration
      const jobData: WorkflowExecutionJob = {
        executionId: execution.id,
        workflowId,
        userId: resolved.userId,
        triggerType: "api",
        triggerData: { apiTokenId: resolved.id },
        inputOverrides,
        // P14: the token's authenticated context — resolved once by the
        // billing hook (a workspace-BOUND token acts as an implicit header).
        billingContext: req.billingContext ?? personalPayer(resolved.userId),
      }

      await orchestrationQueue.add("workflow-execution", jobData, {
        jobId: execution.id,
      })

      // Sync mode: wait for completion
      const query = req.query as Record<string, string>
      if (query.wait === "true") {
        const timeout = Math.min(
          parseInt(query.timeout ?? "120", 10) * 1000,
          600_000, // 10 min max
        )
        const start = Date.now()

        // Stop polling if client disconnects
        let clientDisconnected = false
        req.raw.on("close", () => { clientDisconnected = true })

        while (Date.now() - start < timeout && !clientDisconnected) {
          await new Promise((resolve) => setTimeout(resolve, 5000))

          if (clientDisconnected) break

          const { data: exec } = await supabase
            .from("workflow_executions")
            .select("status, node_states, total_credits_used, completed_at")
            .eq("id", execution.id)
            .single()

          if (!exec) break

          if (
            exec.status === "completed" ||
            exec.status === "failed" ||
            exec.status === "cancelled" ||
            exec.status === "timed_out" ||
            exec.status === "discarded"
          ) {
            return reply.send(formatExecutionResult(
              execution.id,
              exec as Record<string, unknown>,
              nodes,
            ))
          }
        }

        if (clientDisconnected) return

        // Timed out waiting — return 202 with executionId
        return reply.status(202).send({
          executionId: execution.id,
          status: "pending",
          message: "Execution still in progress. Poll /status/:execId for updates.",
        })
      }

      // Async mode (default)
      return reply.status(202).send({
        executionId: execution.id,
        status: "pending",
      })
    })

    // --- Status ---
    api.get("/v1/api/status/:execId", async (req, reply) => {
      const resolved = req.apiToken!

      const parsed = apiExecIdParams.safeParse(req.params)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "Invalid execution ID" },
        })
      }

      const { data: execution, error } = await supabase
        .from("workflow_executions")
        .select("id, status, total_nodes, completed_nodes, failed_nodes, total_credits_used, error_message, created_at, completed_at")
        .eq("id", parsed.data.execId)
        .eq("user_id", resolved.userId)
        .single()

      if (error || !execution) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Execution not found" },
        })
      }

      return reply.send({
        executionId: execution.id,
        status: execution.status,
        totalNodes: execution.total_nodes,
        completedNodes: execution.completed_nodes,
        failedNodes: execution.failed_nodes,
        creditsUsed: execution.total_credits_used,
        errorMessage: execution.error_message,
        createdAt: execution.created_at,
        completedAt: execution.completed_at,
      })
    })

    // --- Result ---
    api.get("/v1/api/result/:execId", async (req, reply) => {
      const resolved = req.apiToken!

      const parsed = apiExecIdParams.safeParse(req.params)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "Invalid execution ID" },
        })
      }

      // Load execution with node states
      const { data: execution, error } = await supabase
        .from("workflow_executions")
        .select("id, workflow_id, status, node_states, total_credits_used, error_message, created_at, completed_at")
        .eq("id", parsed.data.execId)
        .eq("user_id", resolved.userId)
        .single()

      if (error || !execution) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Execution not found" },
        })
      }

      if (execution.status !== "completed" && execution.status !== "failed") {
        return reply.status(202).send({
          executionId: execution.id,
          status: execution.status,
          message: "Execution not yet complete",
        })
      }

      // Load workflow nodes/edges for output detection
      const { data: workflow } = await supabase
        .from("workflows")
        .select("nodes, edges")
        .eq("id", execution.workflow_id)
        .single()

      const nodes = normalizeLegacyNodeTypes((workflow?.nodes ?? []) as GenericNode[])

      return reply.send(formatExecutionResult(
        execution.id,
        execution as Record<string, unknown>,
        nodes,
      ))
    })
  })
}

// ---------------------------------------------------------------------------
// Response formatters
// ---------------------------------------------------------------------------

function formatToken(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    workflowIds: row.workflow_ids ?? [],
    rateLimit: row.rate_limit,
    isActive: row.is_active,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    // Undefined rather than null when the column is not selected, so a
    // response that does not carry the binding is distinguishable from one
    // that carries "not bound".
    workspaceId: row.workspace_id === undefined ? undefined : (row.workspace_id ?? null),
  }
}

function formatExecutionResult(
  executionId: string,
  execution: Record<string, unknown>,
  workflowNodes: GenericNode[],
) {
  const nodeStates = (execution.node_states ?? {}) as Record<string, NodeExecutionState>

  // Extract outputs from completed output nodes. Normalize legacy node types
  // (incl. loop→list) defensively so this formatter classifies outputs
  // correctly regardless of whether the caller already normalized. Idempotent.
  const edges: GenericEdge[] = []
  const outputNodes = getOutputNodes(normalizeLegacyNodeTypes(workflowNodes), edges, false)
  const outputs: Array<{
    nodeId: string
    label: string
    type: string
    url?: string
    text?: string
  }> = []

  for (const node of outputNodes) {
    const state = nodeStates[node.id]
    if (!state || state.status !== "completed") continue

    const output = state.output
    if (!output) continue

    const url = output.imageUrl ?? output.videoUrl ?? output.audioUrl
    const text = (output.text ?? output.script) as string | undefined

    outputs.push({
      nodeId: node.id,
      label: getNodeLabel(node),
      type: getOutputType(node.type),
      url: url ?? undefined,
      text: text ?? undefined,
    })
  }

  const durationMs = execution.completed_at && execution.created_at
    ? new Date(execution.completed_at as string).getTime() -
      new Date(execution.created_at as string).getTime()
    : undefined

  return {
    executionId,
    status: execution.status,
    creditsUsed: execution.total_credits_used ?? 0,
    durationMs,
    errorMessage: execution.error_message,
    outputs,
  }
}

function sortByOrder(nodes: GenericNode[], order: string[]): GenericNode[] {
  const orderMap = new Map(order.map((id, i) => [id, i]))
  return [...nodes].sort((a, b) => {
    const ia = orderMap.get(a.id) ?? 999
    const ib = orderMap.get(b.id) ?? 999
    return ia - ib
  })
}
