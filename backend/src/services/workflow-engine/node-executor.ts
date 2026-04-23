/**
 * Node executor — dispatches node execution based on type category.
 *
 * Category 1: Worker-queued — creates job, reserves credits, enqueues to BullMQ, polls for completion
 * Category 2: Sync HTTP — calls internal route (ai-writer, scene-graph-ai, after-effects-ai, etc.)
 * Category 3: Inline — runs in-process (combine-text, split-text, composite)
 * Category 4: Source — no execution (text-prompt, upload-*, triggers)
 * Category 5: Skipped — manual-edit, etc.
 * Category 6: Component — executes a published app as a sub-execution
 */

import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { renderQueue } from "../../lib/render-queue.js"
import { hasCredits, config } from "../../lib/config.js"
import { CreditsService } from "../../billing/credits.js"
import { refundJobCredits } from "../../workers/shared.js"
import { buildPayload, type WorkflowSettings } from "./payload-builder.js"
import { buildNodeOutputFromJobData } from "./output-extractor.js"
import { resolveFieldMappings, NODE_MAPPABLE_FIELDS } from "./resolve-field-mappings.js"

import { executeCombineText, executeSplitText, executeComposite, executeWebhookOutput, executePreview, executeTeleporterPassthrough, executeRouter, executeExtractField, executeJsonProcess, executeFilterList, executeDeduplicateList, executeMergeLists, executeSortList } from "./inline-executor.js"
import { executeSubWorkflow } from "./sub-workflow-handler.js"
import { mergeExposedSettings } from "../../../../packages/shared/src/component-types.js"
import type { ComponentMetadata } from "../../../../packages/shared/src/component-types.js"
import type {
  SimpleNode,
  SimpleEdge,
  ResolvedInputs,
  NodeOutput,
  NodeExecutionState,
  OrchestratorContext,
} from "./types.js"
import { JOB_POLL_INTERVAL_MS, NODE_TIMEOUT_MS, POLL_ABSOLUTE_TIMEOUT_MS } from "./types.js"
import { isSourceNode, isSkipNode } from "./execution-graph.js"

// ---------------------------------------------------------------------------
// Sync HTTP node types — called via internal fetch
// ---------------------------------------------------------------------------

const SYNC_HTTP_NODES = new Set([
  "ai-writer",
  "llm-chat",
  "video-composer",
  "after-effects",
  "lottie-overlay",
  "3d-title",
  "motion-graphics",
  "image-to-text",
  "suno-style-boost",
  "instagram-post",
  "tiktok-post",
  "youtube-upload",
  "linkedin-post",
  "x-post",
  "facebook-post",
  "telegram-post",
  "qa-check",
  "save-to-storage",
  "web-scrape",
])

// Maps node type to internal route path.
// NOTE: these must exactly match the paths registered in each route file.
// When renaming routes, update this map in the same change. Exported for
// testing so a regression test can assert every entry is actually routable.
export const SYNC_HTTP_ROUTES: Record<string, string> = {
  "ai-writer": "/v1/ai-writer/generate",
  "llm-chat": "/v1/llm-chat/generate",
  "video-composer": "/v1/scene-graph/generate",
  "after-effects": "/v1/after-effects/generate",
  "lottie-overlay": "/v1/lottie-overlay/generate",
  "3d-title": "/v1/3d-title/generate",
  "motion-graphics": "/v1/motion-graphics/generate",
  "image-to-text": "/v1/image-to-text/describe",
  "suno-style-boost": "/v1/suno/style-boost",
  "qa-check": "/v1/qa-check",
  "save-to-storage": "/v1/save-to-storage",
  "web-scrape": "/v1/web-scrape",
  "instagram-post": "/v1/social/publish",
  "tiktok-post": "/v1/social/publish",
  "youtube-upload": "/v1/social/publish",
  "linkedin-post": "/v1/social/publish",
  "x-post": "/v1/social/publish",
  "facebook-post": "/v1/social/publish",
  "telegram-post": "/v1/social/publish",
}

// Maps social node type to platform name
const SOCIAL_NODE_TO_PLATFORM: Record<string, string> = {
  "instagram-post": "instagram",
  "tiktok-post": "tiktok",
  "youtube-upload": "youtube",
  "linkedin-post": "linkedin",
  "x-post": "x",
  "facebook-post": "facebook",
  "telegram-post": "telegram",
}

// ---------------------------------------------------------------------------
// Inline node types — executed in-process
// ---------------------------------------------------------------------------

const INLINE_NODES = new Set([
  "combine-text",
  "split-text",
  "composite",
  "webhook-output",
  "preview",
  "teleport-send",
  "teleport-receive",
  "router",
  "extract-field",
  "json-process",
  "filter-list",
  "deduplicate",
  "merge-lists",
  "sort-list",
])

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export interface ExecuteNodeResult {
  output: NodeOutput
  jobId?: string
  /** All job IDs from fan-out iterations. */
  jobIds?: string[]
  usageLogId?: string
  creditsUsed?: number
}

/**
 * Execute a single node. Returns the output once execution is complete.
 * Throws on failure (caller handles error state).
 */
export async function executeNode(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
  ctx: OrchestratorContext,
): Promise<ExecuteNodeResult> {
  // Source nodes — should already have output set
  if (isSourceNode(node.type)) {
    throw new Error(`Source node ${node.type} should not be executed`)
  }

  // Skip nodes
  if (isSkipNode(node.type)) {
    return { output: {} }
  }

  // --- Field mapping resolution + {} injection (centralized) ---
  const mappableFields = NODE_MAPPABLE_FIELDS[node.type]
  if (mappableFields?.length) {
    const resolvedData = resolveFieldMappings(
      node.data,
      nodeStates,
      allNodes,
      resolvedInputs.prompt,
      mappableFields,
    )
    node = { ...node, data: resolvedData }
  }

  // Component nodes (published apps executed as sub-executions)
  if (node.type === "component") {
    const result = await executeComponentNode(node, resolvedInputs, ctx)
    return { output: result.output, jobId: result.jobId }
  }

  // Sub-workflow nodes
  if (node.type === "sub-workflow") {
    const output = await executeSubWorkflow(node, resolvedInputs, ctx)
    return { output }
  }

  // Inline nodes
  if (INLINE_NODES.has(node.type)) {
    return executeInlineNode(node, resolvedInputs, edges, allNodes, nodeStates, ctx)
  }

  // Sync HTTP nodes
  if (SYNC_HTTP_NODES.has(node.type)) {
    return executeSyncHttpNode(node, resolvedInputs, ctx)
  }

  // Worker-queued nodes (default)
  return executeWorkerNode(node, resolvedInputs, ctx, edges, allNodes, nodeStates)
}

// ---------------------------------------------------------------------------
// Inline execution
// ---------------------------------------------------------------------------

async function executeInlineNode(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
  ctx: OrchestratorContext,
): Promise<ExecuteNodeResult> {
  let output: NodeOutput

  switch (node.type) {
    case "combine-text":
      output = executeCombineText(node, edges, allNodes, nodeStates)
      break
    case "split-text":
      output = executeSplitText(node, resolvedInputs, edges, allNodes, nodeStates)
      break
    case "extract-field":
      output = executeExtractField(node, edges, allNodes, nodeStates)
      break
    case "json-process":
      output = executeJsonProcess(node, edges, allNodes, nodeStates)
      break
    case "filter-list":
      output = executeFilterList(node, edges, allNodes, nodeStates, ctx.triggerData)
      break
    case "deduplicate":
      output = executeDeduplicateList(node, edges, allNodes, nodeStates)
      break
    case "merge-lists":
      output = executeMergeLists(node, edges, allNodes, nodeStates)
      break
    case "sort-list":
      output = executeSortList(node, edges, allNodes, nodeStates)
      break
    case "composite":
      output = executeComposite(node, edges, allNodes, nodeStates)
      break
    case "webhook-output":
      output = await executeWebhookOutput(node, edges, allNodes, nodeStates, ctx)
      break
    case "preview":
      output = executePreview(node, edges, allNodes, nodeStates)
      break
    case "teleport-send":
    case "teleport-receive":
      output = executeTeleporterPassthrough(node, resolvedInputs)
      break
    case "router":
      output = executeRouter(node, edges, allNodes, nodeStates, ctx.triggerData)
      break
    default:
      throw new Error(`Unknown inline node type: ${node.type}`)
  }

  return { output }
}

// ---------------------------------------------------------------------------
// Sync HTTP execution
// ---------------------------------------------------------------------------

async function executeSyncHttpNode(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  ctx: OrchestratorContext,
): Promise<ExecuteNodeResult> {
  const route = SYNC_HTTP_ROUTES[node.type]
  if (!route) {
    throw new Error(`No route mapping for sync HTTP node: ${node.type}`)
  }

  // Backend listens on BACKEND_PORT (9000 in Docker), not Railway's PORT (Caddy)
  const port = process.env.BACKEND_PORT || process.env.PORT || "8000"
  const url = `http://localhost:${port}${route}`

  // Build request body from node data + resolved inputs
  const body = buildSyncHttpBody(node, resolvedInputs, ctx)

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Authenticate to the auth hook with the shared orchestrator secret — NOT req.ip,
    // which is always 127.0.0.1 behind the Caddy reverse proxy.
    "X-Internal-Orchestrator-Secret": config.INTERNAL_ORCHESTRATOR_SECRET,
  }
  // Propagate app-run context so the route's credit reservation applies the
  // free-tier app allowance gate (and avoids crediting allowance on app runs).
  if (ctx.isAppRun) {
    headers["X-App-Run"] = "true"
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(NODE_TIMEOUT_MS),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Sync HTTP call to ${route} failed (${response.status}): ${errorBody}`)
  }

  const result = await response.json() as Record<string, unknown>

  if (result.jobId) {
    // Route created a job — poll for completion
    return pollJobToCompletion(result.jobId as string, node.type, ctx)
  }

  // Normalize generatedText -> text for ai-writer responses
  if (result.generatedText && !result.text) {
    result.text = result.generatedText
  }

  const output = buildNodeOutputFromJobData(result, node.type)

  return {
    output,
    jobId: result.jobId as string | undefined,
    usageLogId: result.usageLogId as string | undefined,
  }
}

// Exported for testing so regression tests can assert sync-HTTP body shape.
export function buildSyncHttpBody(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  ctx: OrchestratorContext,
): Record<string, unknown> {
  const data = node.data

  switch (node.type) {
    case "ai-writer":
      return {
        systemPrompt: data.systemPrompt || data.template,
        userInput: resolvedInputs.prompt || data.userInput || data.prompt,
        userId: ctx.userId,
        llmModel: data.llmModel,
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 4096,
      }

    case "llm-chat":
      return {
        systemPrompt: resolvedInputs.systemPrompt || data.systemPrompt,
        userInput: resolvedInputs.prompt || data.userInput,
        referenceImageUrls: resolvedInputs.referenceImageUrls,
        llmModel: data.llmModel,
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 2048,
        userId: ctx.userId,
      }

    case "video-composer": {
      // Build assets array from resolved inputs (matches frontend collectMediaAssets)
      const assets: Array<{ id: string; type: string; url: string }> = []
      if (resolvedInputs.referenceImageUrls) {
        for (const url of resolvedInputs.referenceImageUrls) {
          assets.push({ id: `img_${assets.length}`, type: "image", url })
        }
      }
      if (resolvedInputs.videoUrl) {
        assets.push({ id: `vid_${assets.length}`, type: "video", url: resolvedInputs.videoUrl })
      }
      if (resolvedInputs.videoUrls) {
        for (const url of resolvedInputs.videoUrls) {
          assets.push({ id: `vid_${assets.length}`, type: "video", url })
        }
      }
      if (resolvedInputs.audioUrl) {
        assets.push({ id: `aud_${assets.length}`, type: "audio", url: resolvedInputs.audioUrl })
      }
      return {
        prompt: resolvedInputs.prompt || data.compositionPrompt || data.prompt,
        assets: assets.length > 0 ? assets : undefined,
        videoUrl: resolvedInputs.videoUrl,
        imageUrls: resolvedInputs.referenceImageUrls,
        audioUrl: resolvedInputs.audioUrl,
        fps: data.fps,
        aspectRatio: data.aspectRatio,
        durationSeconds: data.durationSeconds,
        llmModel: data.llmModel,
        userId: ctx.userId,
      }
    }

    case "after-effects":
      return {
        prompt: resolvedInputs.prompt || data.effectPrompt || data.prompt,
        // Route schema requires `inputVideoUrl`; sending `videoUrl` fails Zod validation.
        inputVideoUrl: resolvedInputs.videoUrl || data.sourceVideoUrl || data.inputVideoUrl,
        fps: data.fps,
        width: data.width,
        height: data.height,
        durationSeconds: data.durationSeconds,
        llmModel: data.llmModel,
        userId: ctx.userId,
      }

    case "lottie-overlay": {
      // Lottie assets come from upstream edges with targetHandle "lottie" (resolved
      // by input-resolver into resolvedInputs.lottieAssets) with a fallback to
      // node data for direct API calls.
      const lottieAssets =
        resolvedInputs.lottieAssets ??
        (data.lottieAssets as Array<{ url: string; name?: string }> | undefined)
      return {
        prompt: resolvedInputs.prompt || data.overlayPrompt || data.prompt,
        // Route schema requires `inputVideoUrl`.
        inputVideoUrl: resolvedInputs.videoUrl || data.sourceVideoUrl || data.inputVideoUrl,
        lottieAssets: lottieAssets && lottieAssets.length > 0 ? lottieAssets : undefined,
        fps: data.fps,
        width: data.width,
        height: data.height,
        durationSeconds: data.durationSeconds,
        llmModel: data.llmModel,
        userId: ctx.userId,
      }
    }

    case "3d-title":
      return {
        prompt: resolvedInputs.prompt || data.titlePrompt || data.prompt,
        backgroundMediaUrl: resolvedInputs.videoUrl || resolvedInputs.imageUrl || data.backgroundMediaUrl,
        fps: data.fps,
        aspectRatio: data.aspectRatio,
        width: data.width,
        height: data.height,
        durationSeconds: data.durationSeconds,
        backgroundColor: data.backgroundColor,
        llmModel: data.llmModel,
        userId: ctx.userId,
      }

    case "motion-graphics":
      return {
        prompt: resolvedInputs.prompt || data.motionPrompt || data.prompt,
        fps: data.fps,
        aspectRatio: data.aspectRatio,
        width: data.width,
        height: data.height,
        durationSeconds: data.durationSeconds,
        backgroundColor: data.backgroundColor,
        llmModel: data.llmModel,
        userId: ctx.userId,
      }

    case "image-to-text":
      return {
        imageUrl: resolvedInputs.imageUrl || data.imageUrl,
        customPrompt: resolvedInputs.prompt || data.customPrompt || data.prompt,
        detailLevel: data.detailLevel || "detailed",
        llmModel: data.llmModel,
        userId: ctx.userId,
      }

    case "suno-style-boost":
      return {
        content: resolvedInputs.prompt || data.content || data.prompt,
        userId: ctx.userId,
      }

    case "qa-check":
      return {
        content: resolvedInputs.prompt || data.content,
        checkType: data.checkType || "content",
        provider: data.provider || "claude",
        threshold: data.threshold ?? 0.7,
        llmModel: data.llmModel,
        userId: ctx.userId,
      }

    case "save-to-storage":
      return {
        mediaUrl: resolvedInputs.videoUrl || resolvedInputs.imageUrl || resolvedInputs.audioUrl,
        filename: data.filename,
        userId: ctx.userId,
      }

    case "instagram-post":
    case "tiktok-post":
    case "youtube-upload":
    case "linkedin-post":
    case "x-post":
    case "facebook-post":
    case "telegram-post": {
      const mediaUrl = resolvedInputs.videoUrl || resolvedInputs.imageUrl || resolvedInputs.audioUrl
      // Auto-detect Telegram action and collect all connected media
      let action = data.action as string
      let mediaItems: Array<{ type: string; url: string }> | undefined
      if (node.type === "telegram-post") {
        const items: Array<{ type: "photo" | "video"; url: string }> = []
        if (resolvedInputs.imageUrl) items.push({ type: "photo", url: resolvedInputs.imageUrl })
        if (resolvedInputs.videoUrl) items.push({ type: "video", url: resolvedInputs.videoUrl })

        if (items.length >= 2) {
          action = "send-media-group"
          mediaItems = items
        } else if (items.length === 1) {
          action = items[0].type === "video" ? "send-video" : "send-photo"
        } else {
          action = "send-message"
        }
      } else if (action === "post-carousel" && resolvedInputs.mediaItems?.length) {
        mediaItems = resolvedInputs.mediaItems
      }
      return {
        platform: SOCIAL_NODE_TO_PLATFORM[node.type],
        action,
        connectionId: data.connectionId,
        caption: resolvedInputs.prompt || (resolvedInputs.caption as string | undefined) || data.caption || data.text,
        mediaUrl,
        mediaItems,
        title: data.title,
        description: data.description,
        tags: data.tags,
        privacy: data.privacy,
        chatId: data.chatId,
        parseMode: data.parseMode,
        userId: ctx.userId,
      }
    }

    case "web-scrape": {
      // Default to google-search — cheapest SKU, avoids the max-cost fallback.
      const actor = (data.actor as string | undefined) ?? "google-search"
      const upstreamText = resolvedInputs.prompt

      const body: Record<string, unknown> = {
        actor,
        userId: ctx.userId,
      }
      if (actor === "content-crawler") {
        body.url = (data.url as string) || upstreamText
        body.mode = data.mode || "page"
      } else if (actor === "google-search") {
        body.query = (data.query as string) || upstreamText
        body.maxResults = data.maxResults
        body.countryCode = data.countryCode
      } else if (actor === "rss") {
        // Same shape as content-crawler but resolved via direct fetch, not Apify.
        body.url = (data.url as string) || upstreamText
        body.resultsLimit = data.resultsLimit
      } else {
        body.target = (data.target as string) || upstreamText
        body.resultsLimit = data.resultsLimit
      }
      return body
    }

    default:
      return { ...data, userId: ctx.userId }
  }
}

// ---------------------------------------------------------------------------
// Worker-queued execution
// ---------------------------------------------------------------------------

async function executeWorkerNode(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  ctx: OrchestratorContext,
  edges?: SimpleEdge[],
  allNodes?: SimpleNode[],
  nodeStates?: Record<string, NodeExecutionState>,
): Promise<ExecuteNodeResult> {
  // 1. Create placeholder job record (we need the jobId for payload building)
  const isUploadDescendant = ctx.uploadDescendantIds?.has(node.id) ?? false
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      workflow_id: null,
      workflow_execution_id: ctx.executionId,
      user_id: ctx.userId,
      status: "pending",
      input_data: { type: node.type },
      ...(isUploadDescendant && { force_private: true }),
    })
    .select("id")
    .single()

  if (jobError || !job) {
    throw new Error(`Failed to create job for node ${node.id}: ${jobError?.message ?? "unknown"}`)
  }

  const jobId = job.id

  // Notify orchestrator so jobId is visible in nodeStates immediately
  ctx.onJobCreated?.(node.id, jobId)

  // 2. Build payload (needs jobId)
  const settings = ctx.workflowSettings as WorkflowSettings | undefined
  const { jobName, queueName, payload, modelIdentifier } = buildPayload(
    node,
    jobId,
    resolvedInputs,
    undefined,
    {
      settings,
      nodes: allNodes,
      edges,
      nodeStates,
    },
  )

  // 2b. Update job with full input_data from the built payload
  // Store all payload fields so the execution detail modal can show complete inputs.
  // Internal fields (jobId, userId, usageLogId) are kept — useful for admin debugging;
  // regular users never see raw input_data anyway (sanitizeJobForPublic strips sensitive job fields).
  const inputData: Record<string, unknown> = { type: node.type, ...payload }
  // Backfill resolved inputs that payload may not carry (e.g. upstream media URLs)
  if (!inputData.imageUrl && resolvedInputs.imageUrl) inputData.imageUrl = resolvedInputs.imageUrl
  if (!inputData.videoUrl && resolvedInputs.videoUrl) inputData.videoUrl = resolvedInputs.videoUrl
  if (!inputData.audioUrl && resolvedInputs.audioUrl) inputData.audioUrl = resolvedInputs.audioUrl

  await supabase
    .from("jobs")
    .update({ input_data: inputData })
    .eq("id", jobId)

  // 3. Reserve credits (skip for FFmpeg / 0-credit nodes)
  let usageLogId: string | undefined
  let creditsUsed = 0

  if (hasCredits() && modelIdentifier !== "ffmpeg") {
    try {
      const reservation = await CreditsService.reserveCredits(
        ctx.userId,
        jobId,
        modelIdentifier,
        0, // provider cost calculated in worker
        0, // display cost calculated in worker
        { isAppRun: ctx.isAppRun },
      )
      usageLogId = reservation.usageLogId
      creditsUsed = reservation.creditsReserved

      // Update job with reservation info
      await supabase
        .from("jobs")
        .update({
          usage_log_id: reservation.usageLogId,
          credits: reservation.creditsReserved,
          should_watermark: reservation.watermark,
        })
        .eq("id", jobId)
    } catch (err) {
      // Clean up job if reservation fails
      await supabase.from("jobs").delete().eq("id", jobId)
      throw new Error(`Credit reservation failed for ${node.type}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 4. Update payload with usageLogId
  const enrichedPayload = { ...payload, usageLogId }

  // 5. Enqueue to BullMQ (lower priority than interactive single-node runs)
  const queue = queueName === "video-render" ? renderQueue : videoQueue
  await queue.add(jobName, enrichedPayload, { priority: 10 })

  // 6. Poll for job completion
  return pollJobToCompletion(jobId, node.type, ctx, usageLogId, creditsUsed)
}

// ---------------------------------------------------------------------------
// Job polling
// ---------------------------------------------------------------------------

/** How often (in poll cycles) to re-check execution status from the DB.
 *  Every 5th cycle = every ~15 seconds. */
const CANCEL_CHECK_INTERVAL = 5

/** Cancel the underlying job, refund credits, and throw. */
async function cancelJobAndThrow(
  jobId: string,
  usageLogId: string | undefined,
  reason: string,
): Promise<never> {
  await supabase.from("jobs").update({ status: "cancelled" }).eq("id", jobId)
  await refundJobCredits(usageLogId, jobId, reason)
  throw new Error(reason)
}

async function pollJobToCompletion(
  jobId: string,
  nodeType: string,
  ctx: OrchestratorContext,
  usageLogId?: string,
  creditsUsed?: number,
): Promise<ExecuteNodeResult> {
  let processingStartTime: number | null = null
  let pollCycle = 0
  const pollStartTime = Date.now()

  while (true) {
    // Check cancellation (fast path — already flagged by orchestrator or sibling node)
    if (ctx.cancelled) {
      await cancelJobAndThrow(jobId, usageLogId, "Execution cancelled")
    }

    // Absolute timeout — prevents infinite polling when job never leaves "pending"
    // (e.g. worker down, queue full). Safety net beyond NODE_TIMEOUT_MS which only
    // starts counting after the worker picks up the job.
    if (Date.now() - pollStartTime > POLL_ABSOLUTE_TIMEOUT_MS) {
      await cancelJobAndThrow(jobId, usageLogId, `Poll timeout: job did not complete within ${POLL_ABSOLUTE_TIMEOUT_MS / 1000}s (may still be pending in queue)`)
    }

    // Periodically re-check execution status from DB so mid-level cancellation
    // is detected without waiting for the level to finish.  Shared timestamp on
    // ctx ensures only one parallel node queries the DB per interval.
    pollCycle++
    const now = Date.now()
    if (pollCycle % CANCEL_CHECK_INTERVAL === 0 && now - (ctx.lastCancelCheckMs ?? 0) >= CANCEL_CHECK_INTERVAL * JOB_POLL_INTERVAL_MS) {
      ctx.lastCancelCheckMs = now
      const { data: execRow } = await supabase
        .from("workflow_executions")
        .select("status")
        .eq("id", ctx.executionId)
        .single()
      // "stopping" is handled at the level boundary (orchestrator-worker.ts) —
      // it means "finish current level, then stop". Only "cancelled" should
      // trigger immediate job cancellation mid-poll.
      if (execRow?.status === "cancelled") {
        ctx.cancelled = true
        await cancelJobAndThrow(jobId, usageLogId, "Execution cancelled")
      }
    }

    // Poll job status
    const { data: jobRecord } = await supabase
      .from("jobs")
      .select("status, output_data, error_message, progress")
      .eq("id", jobId)
      .single()

    if (!jobRecord) {
      throw new Error(`Job ${jobId} not found`)
    }

    // Surface progress to the orchestrator so the UI can render a progress bar
    // during backend runs (Run-from-here, triggers). Without this, node-level
    // currentJobProgress stayed undefined and the bar never appeared.
    const progressValue = jobRecord.progress as number | null | undefined
    if (typeof progressValue === "number" && ctx.onJobProgress) {
      ctx.onJobProgress(jobId, progressValue)
    }

    const status = jobRecord.status as string

    // Check terminal statuses BEFORE timeout — avoids cancelling a just-completed job
    if (status === "completed") {
      const outputData = (jobRecord.output_data as Record<string, unknown>) ?? {}
      const output = buildNodeOutputFromJobData(outputData, nodeType)

      // Validate that the job actually produced output — a "completed" job
      // with empty output_data means the provider returned success but no
      // result (or a race condition lost the data). Treat it as a failure
      // so downstream nodes don't silently receive empty inputs.
      const hasOutput = Object.values(output).some((v) => v != null)
      if (!hasOutput) {
        throw new Error(`Job ${jobId} completed but produced no output — provider may have returned an empty result`)
      }

      return { output, jobId, usageLogId, creditsUsed }
    }

    if (status === "failed" || status === "cancelled") {
      const errorMsg = (jobRecord.error_message as string) ?? `Job ${status}`
      throw new Error(errorMsg)
    }

    // Detect when worker picks up the job (status transitions from "pending")
    if (processingStartTime === null && status !== "pending") {
      processingStartTime = Date.now()
    }

    // Check processing timeout — only starts once the worker picks up the job.
    // Queue wait time is bounded by the workflow-level timeout (WORKFLOW_TIMEOUT_MS).
    if (processingStartTime !== null && Date.now() - processingStartTime > NODE_TIMEOUT_MS) {
      await cancelJobAndThrow(jobId, usageLogId, `Node timeout after ${NODE_TIMEOUT_MS / 1000}s of processing`)
    }

    // Wait before next poll
    await sleep(JOB_POLL_INTERVAL_MS)
  }
}

// ---------------------------------------------------------------------------
// Component node execution
// ---------------------------------------------------------------------------

const COMPONENT_POLL_INTERVAL_MS = 3_000 // 3 seconds
const COMPONENT_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

async function executeComponentNode(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  ctx: OrchestratorContext,
): Promise<{ output: NodeOutput; jobId: string }> {
  const data = node.data as Record<string, unknown>
  const appSlug = data.appSlug as string
  const componentMetadata = data.componentMetadata as ComponentMetadata
  const exposedSettings = (data.exposedSettings as Record<string, unknown>) ?? {}
  const depth = ctx.componentDepth ?? 0
  const ancestorIds = ctx.executingComponentIds ?? []

  // Cycle detection
  if (ancestorIds.includes(appSlug)) {
    throw new Error(`Component cycle detected: ${appSlug} is already executing in the ancestor chain`)
  }

  // Depth check
  if (depth >= 5) {
    throw new Error(`Component nesting depth exceeded (max 5). Current depth: ${depth}`)
  }

  // Build inputOverrides (handle-aware)
  const inputOverrides: Record<string, Record<string, unknown>> = {}

  for (const handle of componentMetadata.inputs) {
    const value =
      resolvedInputs.componentInputMap?.[handle.id] ??
      resolvedInputs[handle.fieldKey as keyof ResolvedInputs] ??
      (handle.type === "image" ? resolvedInputs.imageUrl : undefined) ??
      (handle.type === "video" ? resolvedInputs.videoUrl : undefined) ??
      (handle.type === "audio" ? resolvedInputs.audioUrl : undefined) ??
      (handle.type === "text" ? resolvedInputs.prompt : undefined)
    if (value !== undefined) {
      inputOverrides[handle.id] = { ...inputOverrides[handle.id], [handle.fieldKey]: value }
    }
  }

  // Pick up config-panel input values (stored in exposedSettings as "nodeId:fieldKey")
  for (const handle of componentMetadata.inputs) {
    if (inputOverrides[handle.id]?.[handle.fieldKey] !== undefined) continue
    const settingKey = `${handle.id}:${handle.fieldKey}`
    const settingVal = exposedSettings[settingKey]
    if (settingVal !== undefined && settingVal !== "") {
      inputOverrides[handle.id] = { ...inputOverrides[handle.id], [handle.fieldKey]: settingVal }
    }
  }

  const mergedOverrides = mergeExposedSettings(inputOverrides, exposedSettings, componentMetadata)

  // Call the component-execute route via internal HTTP.
  // Uses the shared-secret internal-orchestrator auth, same as other sync HTTP nodes.
  const port = process.env.BACKEND_PORT || process.env.PORT || "8000"
  const res = await fetch(`http://localhost:${port}/v1/component/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Orchestrator-Secret": config.INTERNAL_ORCHESTRATOR_SECRET,
    },
    body: JSON.stringify({
      appSlug,
      inputOverrides: mergedOverrides,
      pinnedVersion: (data.pinnedVersion as number) || undefined,
      componentDepth: depth + 1,
      executingComponentIds: [...ancestorIds, appSlug],
      userId: ctx.userId,
    }),
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error((errBody as Record<string, { message?: string }>).error?.message ?? `Component execute failed (${res.status})`)
  }

  const { jobId } = (await res.json()) as { jobId: string }

  // Surface the wrapper jobId so the orchestrator can track it
  if (ctx.onJobCreated) ctx.onJobCreated(node.id, jobId)

  // Poll wrapper job
  const startTime = Date.now()
  while (Date.now() - startTime < COMPONENT_TIMEOUT_MS) {
    if (ctx.cancelled) throw new Error("Component execution cancelled")

    const { data: job } = await supabase
      .from("jobs")
      .select("status, output_data, error_message, credits_actual, progress")
      .eq("id", jobId)
      .single()

    if (!job) throw new Error("Component wrapper job not found")

    if (job.status === "completed") {
      const outputData = (job.output_data ?? {}) as Record<string, string>
      return { output: { _outputResults: outputData }, jobId }
    }

    if (job.status === "failed") {
      throw new Error(job.error_message ?? "Component execution failed")
    }

    await sleep(COMPONENT_POLL_INTERVAL_MS)
  }

  throw new Error("Component execution timed out after 30 minutes")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
