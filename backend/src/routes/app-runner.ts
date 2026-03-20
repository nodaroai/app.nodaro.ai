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
import { hasCredits } from "../lib/config.js"
import { CreditsService } from "../billing/credits.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"

// In-memory cache for published app data (30min TTL — explicit invalidation on publish)
const APP_CACHE_TTL_MS = 30 * 60_000
const appCache = new Map<string, { data: unknown; expiry: number }>()

/** Invalidate cached app data when a new version is published */
export function invalidateAppCache(slug: string): void {
  appCache.delete(slug)
}

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
  version: z.coerce.number().int().min(1).optional(),
})

const createRunBody = z.object({
  inputValues: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  version: z.coerce.number().int().min(1).optional(),
})

const updateRunBody = z.object({
  inputValues: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  name: z.string().max(100).nullable().optional(),
})

const runsQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
})

const appQuery = z.object({
  version: z.coerce.number().int().min(1).optional(),
})

// ---------------------------------------------------------------------------
// Shared helpers — resolve slug → workflow_id → version(s)
// No is_active filter: runs and app data remain visible even when deactivated.
// ---------------------------------------------------------------------------

async function resolveSlug(slug: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("published_apps")
    .select("workflow_id")
    .eq("slug", slug)
    .limit(1)
    .single()
  return error || !data ? null : (data.workflow_id as string)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAppVersion(
  workflowId: string,
  columns: string,
  version?: number,
): Promise<any | null> {
  let query = supabase
    .from("published_apps")
    .select(columns)
    .eq("workflow_id", workflowId)

  if (version) {
    query = query.eq("version", version)
  } else {
    query = query.order("version", { ascending: false }).limit(1)
  }

  const { data, error } = await query.single()
  return error || !data ? null : data
}

export async function appRunnerRoutes(app: FastifyInstance) {
  // --- Load published app (public, auth optional for personalization) ---
  app.get("/v1/app/:slug", async (req, reply) => {
    const parsed = slugParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid app slug" },
      })
    }

    const queryParsed = appQuery.safeParse(req.query)
    const requestedVersion = queryParsed.success ? queryParsed.data.version : undefined

    const { slug } = parsed.data
    const cacheKey = requestedVersion ? `${slug}:v${requestedVersion}` : slug

    // Check in-memory cache
    const cached = appCache.get(cacheKey)
    if (cached && Date.now() < cached.expiry) {
      reply.header("Cache-Control", "public, max-age=10, s-maxage=10, stale-while-revalidate=86400")
      return reply.send(cached.data)
    }

    // Step 1: resolve slug → workflow_id
    const workflowId = await resolveSlug(slug)
    if (!workflowId) {
      return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
    }

    // Step 2: load all versions by workflow_id (slug is unique per row, workflow_id spans versions)
    const { data: allVersionRows } = await supabase
      .from("published_apps")
      .select("id, name, description, icon_url, version, snapshot_nodes, snapshot_edges, snapshot_settings, estimated_credits, creator_id, max_runs_per_user_per_day, thumbnail_node_id, supports_remix, created_at, workflow_id")
      .eq("workflow_id", workflowId)
      .order("version", { ascending: false })

    if (!allVersionRows || allVersionRows.length === 0) {
      return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
    }

    // Pick the requested version or latest
    const appRow = requestedVersion
      ? allVersionRows.find((v) => v.version === requestedVersion)
      : allVersionRows[0]

    if (!appRow) {
      return reply.status(404).send({
        error: { code: "not_found", message: `Version ${requestedVersion} not found` },
      })
    }

    const versions = allVersionRows.map((v) => ({
      version: v.version as number,
      id: v.id as string,
      createdAt: v.created_at as string,
    }))

    const responseData = {
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
      thumbnailNodeId: appRow.thumbnail_node_id ?? null,
      supportsRemix: appRow.supports_remix ?? false,
      createdAt: appRow.created_at,
      workflowId: appRow.workflow_id,
      versions,
    }

    // Cache the response
    appCache.set(cacheKey, { data: responseData, expiry: Date.now() + APP_CACHE_TTL_MS })
    // Evict stale entries periodically
    if (appCache.size > 1000) {
      const now = Date.now()
      for (const [k, v] of appCache) {
        if (now >= v.expiry) appCache.delete(k)
      }
    }

    reply.header("Cache-Control", "public, max-age=10, s-maxage=10, stale-while-revalidate=86400")
    return reply.send(responseData)
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
    const { inputOverrides, runId, version } = bodyParsed.data

    const workflowId = await resolveSlug(slug)
    if (!workflowId) {
      return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
    }

    const appRow = await loadAppVersion(workflowId, "id, workflow_id, max_runs_per_user_per_day, snapshot_nodes, snapshot_edges, snapshot_settings", version)
    if (!appRow) {
      return reply.status(404).send({
        error: { code: "not_found", message: version ? `Version ${version} not found` : "App not found" },
      })
    }

    // Run rate limit + app credits allowance checks in parallel
    const rateLimitPromise = appRow.max_runs_per_user_per_day != null
      ? (async () => {
          const todayStart = new Date()
          todayStart.setUTCHours(0, 0, 0, 0)
          const { count, error: rlError } = await supabase
            .from("app_runs")
            .select("id", { count: "exact", head: true })
            .eq("app_id", appRow.id)
            .eq("runner_id", req.userId)
            .gte("created_at", todayStart.toISOString())
          if (rlError) return { blocked: true as const, status: 500, code: "internal_error", message: "Failed to check rate limit" }
          if ((count ?? 0) >= appRow.max_runs_per_user_per_day!)
            return { blocked: true as const, status: 429, code: "rate_limit_exceeded", message: `Daily run limit of ${appRow.max_runs_per_user_per_day} reached for this app` }
          return { blocked: false as const }
        })()
      : Promise.resolve({ blocked: false as const })

    const allowancePromise = hasCredits()
      ? CreditsService.checkAppRunEligibility(req.userId)
      : Promise.resolve({ allowed: true as const, error: undefined, appCreditsAllowance: undefined })

    const [rateLimitResult, allowanceResult] = await Promise.all([rateLimitPromise, allowancePromise])

    if (rateLimitResult.blocked) {
      return reply.status(rateLimitResult.status).send({
        error: { code: rateLimitResult.code, message: rateLimitResult.message },
      })
    }

    if (!allowanceResult.allowed) {
      return reply.status(402).send({
        error: {
          code: "insufficient_app_credits",
          message: allowanceResult.error,
          appCreditsAllowance: allowanceResult.appCreditsAllowance,
        },
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

    // Compute nodeIds if baked presentation settings target a specific route
    let nodeIds: string[] | undefined
    const snapshotSettings = (appRow.snapshot_settings ?? {}) as Record<string, unknown>
    const presSettings = snapshotSettings.presentationSettings as { runTarget?: string; selectedRouteId?: string } | undefined
    if (presSettings?.runTarget === "route" && presSettings?.selectedRouteId) {
      const { getRouteReachableNodeIds } = await import("../../../packages/shared/src/route-filter.js")
      const nodes = (appRow.snapshot_nodes ?? []) as Array<{ id: string; type?: string; data: Record<string, unknown> }>
      const edges = (appRow.snapshot_edges ?? []) as Array<{ source: string; target: string }>
      const reachable = getRouteReachableNodeIds(nodes, edges, presSettings.selectedRouteId)
      if (reachable.size > 0) {
        nodeIds = [...reachable]
      }
      // If empty (stale routeId in snapshot), fall through → runs entire workflow
    }

    // Enqueue orchestration job — use the app's workflow_id since the orchestrator loads by workflow ID
    // Pass appVersionId so the orchestrator uses the snapshot from this specific version
    const jobData: WorkflowExecutionJob = {
      executionId: execution.id,
      workflowId: appRow.workflow_id,
      userId: req.userId,
      triggerType: "manual",
      inputOverrides,
      appVersionId: appRow.id,
      nodeIds,
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
    const { inputValues, version } = bodyParsed.data

    const workflowId = await resolveSlug(slug)
    if (!workflowId) {
      return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
    }

    const appRow = await loadAppVersion(workflowId, "id", version)
    if (!appRow) {
      return reply.status(404).send({
        error: { code: "not_found", message: version ? `Version ${version} not found` : "App not found" },
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
    const { inputValues, name } = bodyParsed.data

    const updates: Record<string, unknown> = {}
    if (inputValues !== undefined) updates.input_values = inputValues
    if (name !== undefined) updates.name = name

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "No fields to update" },
      })
    }

    const { data: run, error: runError } = await supabase
      .from("app_runs")
      .update(updates)
      .eq("id", runId)
      .eq("runner_id", req.userId)
      .select("id, input_values, name")
      .single()

    if (runError || !run) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Run not found" },
      })
    }

    return reply.send({ id: run.id, inputValues: run.input_values, name: run.name })
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

    // Step 1: resolve slug → workflow_id
    const workflowId = await resolveSlug(slug)
    if (!workflowId) {
      return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
    }

    // Step 2: all versions by workflow_id (slug is unique per row, workflow_id spans versions)
    const { data: allVersions } = await supabase
      .from("published_apps")
      .select("id, version, thumbnail_node_id")
      .eq("workflow_id", workflowId)

    if (!allVersions || allVersions.length === 0) {
      return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
    }

    const versionIds = allVersions.map((v) => v.id as string)
    const versionMap = new Map(allVersions.map((v) => [v.id as string, v.version as number]))

    // Thumbnail from latest version
    const latestVersion = allVersions.reduce((a, b) =>
      (a.version as number) > (b.version as number) ? a : b,
    )
    const thumbnailNodeId = (latestVersion.thumbnail_node_id as string | null) ?? null

    // Build runs query + resolve cursor in parallel
    let cursorDate: string | undefined
    if (cursor) {
      const { data: cursorRow } = await supabase
        .from("app_runs")
        .select("created_at")
        .eq("id", cursor)
        .single()
      cursorDate = cursorRow?.created_at as string | undefined
    }

    let query = supabase
      .from("app_runs")
      .select(
        "id, app_id, created_at, execution_id, input_values, status, name, credits_used, workflow_executions(status, node_states, completed_nodes, total_nodes, completed_at, total_credits_used)"
      )
      .in("app_id", versionIds)
      .eq("runner_id", req.userId)
      .order("created_at", { ascending: false })
      .limit(limit + 1) // fetch one extra for cursor

    if (cursorDate) {
      query = query.lt("created_at", cursorDate)
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
          total_credits_used: number | null
        } | null

        // Extract thumbnail URL from the designated node's output
        let thumbnailUrl: string | null = null
        if (thumbnailNodeId && exec?.node_states) {
          const ns = exec.node_states as Record<string, { output?: Record<string, unknown> }>
          const nodeOutput = ns[thumbnailNodeId]?.output
          if (nodeOutput) {
            // Try common output keys: url, imageUrl, videoUrl, audioUrl, resultUrl
            thumbnailUrl = (nodeOutput.url ?? nodeOutput.imageUrl ?? nodeOutput.videoUrl ?? nodeOutput.audioUrl ?? nodeOutput.resultUrl ?? null) as string | null
          }
        }

        return {
          id: run.id,
          executionId: run.execution_id ?? null,
          createdAt: run.created_at,
          name: (run as { name?: string | null }).name ?? null,
          inputValues: run.input_values ?? null,
          status: exec?.status ?? (run as { status?: string }).status ?? "draft",
          nodeStates: exec?.node_states ?? null,
          completedNodes: exec?.completed_nodes ?? 0,
          totalNodes: exec?.total_nodes ?? 0,
          completedAt: exec?.completed_at ?? null,
          creditsUsed: exec?.total_credits_used ?? (run as { credits_used?: number }).credits_used ?? 0,
          version: versionMap.get(run.app_id) ?? null,
          thumbnailUrl,
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
        "id, app_id, runner_id, execution_id, input_values, status, name, credits_used, created_at, published_apps!app_id(version, thumbnail_node_id), workflow_executions(id, status, node_states, total_nodes, completed_nodes, failed_nodes, total_credits_used, error_message, completed_at)"
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

    const pubApp = run.published_apps as unknown as { version: number; thumbnail_node_id: string | null } | null

    // Extract thumbnail URL
    let thumbnailUrl: string | null = null
    const tnNodeId = pubApp?.thumbnail_node_id
    if (tnNodeId && exec?.node_states) {
      const ns = exec.node_states as Record<string, { output?: Record<string, unknown> }>
      const nodeOutput = ns[tnNodeId]?.output
      if (nodeOutput) {
        thumbnailUrl = (nodeOutput.url ?? nodeOutput.imageUrl ?? nodeOutput.videoUrl ?? nodeOutput.audioUrl ?? nodeOutput.resultUrl ?? null) as string | null
      }
    }

    return reply.send({
      id: run.id,
      appId: run.app_id,
      executionId: run.execution_id ?? null,
      name: (run as { name?: string | null }).name ?? null,
      inputValues: run.input_values ?? null,
      status: (run as { status?: string }).status ?? "draft",
      creditsUsed: exec?.total_credits_used ?? (run as { credits_used?: number }).credits_used ?? 0,
      createdAt: run.created_at,
      version: pubApp?.version ?? null,
      thumbnailUrl,
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
