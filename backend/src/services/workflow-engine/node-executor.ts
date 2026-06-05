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
import { CreditsService } from "../../ee/billing/credits.js"
import { refundJobCredits } from "../../workers/shared.js"
import { buildPayload, type WorkflowSettings } from "./payload-builder.js"
import { buildNodeOutputFromJobData } from "./output-extractor.js"
import { resolveFieldMappings, NODE_MAPPABLE_FIELDS } from "./resolve-field-mappings.js"

import { executeCombineText, executeSplitText, executeComposite, executeWebhookOutput, executePreview, executeTeleporterPassthrough, executeRouter, executeExtractField, executeJsonProcess, executeFilterList, executeDeduplicateList, executeMergeLists, executeSortList, executeSelector } from "./inline-executor.js"
import { executeSubWorkflow } from "./sub-workflow-handler.js"
import { mergeExposedSettings, applyHandleInputOverride, isHandleInputWired } from "@nodaro/shared"
import type { ComponentMetadata } from "@nodaro/shared"
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
  "image-critic",
  "save-to-storage",
  "web-scrape",
  "reduce",
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
  "image-critic": "/v1/image-critic",
  "save-to-storage": "/v1/save-to-storage",
  "web-scrape": "/v1/web-scrape",
  "instagram-post": "/v1/social/publish",
  "tiktok-post": "/v1/social/publish",
  "youtube-upload": "/v1/social/publish",
  "linkedin-post": "/v1/social/publish",
  "x-post": "/v1/social/publish",
  "facebook-post": "/v1/social/publish",
  "telegram-post": "/v1/social/publish",
  "reduce": "/v1/reduce",
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
// User-typed prompt template extraction
// ---------------------------------------------------------------------------

/**
 * Extract the user's UNRESOLVED prompt template from a source node.
 *
 * This is the raw text the user typed into the config panel BEFORE any
 * variable resolution (e.g. `"a man aged {age}"`, not the resolved
 * `"a man aged 27"` sent to the AI provider).
 *
 * Mirrored from the frontend `setUserPromptTemplate(...)` call site so
 * orchestrator-driven runs land the same value in `jobs.input_data.userPrompt`
 * as single-node Run executions. Field map matches the per-node-type prompt
 * fields used by the frontend executor + payload-builder.
 *
 * Returns undefined for nodes with no user-typed prompt (FFmpeg processing,
 * upscale, audio-isolation, voice-changer, dubbing, etc.).
 */
export function extractUserPromptTemplate(node: SimpleNode): string | undefined {
  const data = node.data as Record<string, unknown>
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = data[key]
      if (typeof value === "string" && value.trim().length > 0) return value
    }
    return undefined
  }

  switch (node.type) {
    // --- Image generation ---
    case "generate-image":
    case "edit-image":
    case "image-to-image":
    case "modify-image":
      return pick("prompt")

    // --- Video generation ---
    case "image-to-video":
      // Frontend reads `motionPrompt` as a fallback for the i2v prompt field.
      return pick("prompt", "motionPrompt")
    case "text-to-video":
    case "video-to-video":
    case "lip-sync":
    case "speech-to-video":
    case "motion-transfer":
    case "extend-video":
    case "video-retake":
      return pick("prompt")
    // ai-avatar uses the verbatim `script` field for TTS (not `prompt`).
    case "ai-avatar":
      return pick("script")
    case "cinematic-avatar":
      return pick("prompt")

    // --- Entity / scene ---
    case "character":
    case "face":
    case "object":
    case "location":
      // Entity nodes have BOTH a free-form `prompt` and a structured
      // `description`. The route-level enrichment uses `description` first.
      return pick("description", "prompt")
    case "scene":
      return pick("prompt")

    // --- Audio / TTS ---
    case "text-to-speech":
      // `directText` is the in-node text field when textSource === "direct";
      // `text` is the legacy field name.
      return pick("directText", "text")
    case "text-to-audio":
      return pick("prompt", "text")
    case "voice-remix":
    case "voice-design":
      return pick("text")
    case "forced-alignment":
      return pick("transcript")

    // --- Music ---
    case "generate-music":
      return pick("prompt", "lyrics")

    // --- Suno ---
    case "suno-generate":
    case "suno-cover":
      return pick("prompt", "lyrics")
    case "suno-extend":
    case "suno-lyrics":
    case "suno-replace-section":
    case "suno-upload-extend":
      return pick("prompt")

    // --- Captions / FFmpeg text overlay ---
    case "add-captions":
      return pick("captions", "text")

    // --- Script generation ---
    case "generate-script":
      return pick("prompt")

    // --- Sync HTTP nodes (also called via fetch — included so the same
    //     helper drives both worker-queued and sync HTTP code paths) ---
    case "ai-writer":
    case "llm-chat":
      return pick("userInput", "prompt")
    case "video-composer":
      return pick("compositionPrompt", "prompt")
    case "after-effects":
      return pick("effectPrompt", "prompt")
    case "lottie-overlay":
      return pick("overlayPrompt", "prompt")
    case "3d-title":
      return pick("titlePrompt", "prompt")
    case "motion-graphics":
      return pick("motionPrompt", "prompt")
    case "image-to-text":
      return pick("customPrompt", "prompt")
    case "suno-style-boost":
      return pick("content", "prompt")
    case "qa-check":
      return pick("content")
    case "image-critic":
      return pick("prompt")
    case "web-scrape":
      return pick("query", "url", "target")

    // --- Social posts ---
    case "instagram-post":
    case "tiktok-post":
    case "youtube-upload":
    case "linkedin-post":
    case "x-post":
    case "facebook-post":
    case "telegram-post":
      return pick("caption", "text")

    default:
      return undefined
  }
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
  "selector",
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

  // Capture the UNRESOLVED user-typed prompt template BEFORE field mapping
  // resolution rewrites `node.data.<field>`. Plumbed down to worker / sync HTTP
  // executors so `jobs.input_data.userPrompt` mirrors the frontend's
  // `setUserPromptTemplate` value (the raw template, not the resolved one).
  const userPromptTemplate = extractUserPromptTemplate(node)

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

  // Generative Pipeline — runs via the dedicated pipeline-orchestration queue
  // (POST /v1/pipelines), not the DAG. From the DAG perspective the node is a
  // leaf: it returns the existing pipeline_id (if any) without triggering work.
  // Mirrors the frontend execute-node.ts no-op behavior for Phase 1A.
  if (node.type === "generative-pipeline") {
    return { output: {} }
  }

  // Phase 1B.2 pipeline-managed SceneNode — its internal pipeline (keyframe
  // gen → animate → speech → lip_sync → combine) is driven by the pipeline
  // orchestrator in Phase 1C, NOT the workflow DAG worker. From the DAG
  // perspective the node is a no-op success leaf: outputs (composite_video,
  // last_frame, scene_audio_track) are populated by the pipeline. Mirrors
  // the generative-pipeline short-circuit above + the frontend execute-node
  // no-op. The legacy case "scene" in payload-builder.ts is dead as long
  // as this short-circuit fires before the worker-queued path.
  if (node.type === "scene") {
    return { output: {} }
  }

  // Inline nodes
  if (INLINE_NODES.has(node.type)) {
    return executeInlineNode(node, resolvedInputs, edges, allNodes, nodeStates, ctx)
  }

  // Sync HTTP nodes
  if (SYNC_HTTP_NODES.has(node.type)) {
    return executeSyncHttpNode(node, resolvedInputs, ctx, userPromptTemplate)
  }

  // Worker-queued nodes (default)
  return executeWorkerNode(node, resolvedInputs, ctx, edges, allNodes, nodeStates, userPromptTemplate)
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
    case "selector":
      output = executeSelector(node, edges, allNodes, nodeStates, ctx.triggerData)
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
  userPromptTemplate?: string,
): Promise<ExecuteNodeResult> {
  const route = SYNC_HTTP_ROUTES[node.type]
  if (!route) {
    throw new Error(`No route mapping for sync HTTP node: ${node.type}`)
  }

  // Backend listens on BACKEND_PORT (9000 in Docker), not Railway's PORT (Caddy)
  const port = process.env.BACKEND_PORT || process.env.PORT || "8000"
  const url = `http://localhost:${port}${route}`

  // Build request body from node data + resolved inputs
  const body = buildSyncHttpBody(node, resolvedInputs, ctx, userPromptTemplate)

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
    // Stamp `node_id` on the jobs row so the reconcile cron's Path-2 can
    // recover sync-HTTP orphans the same way it does worker-queued ones.
    // Sync-HTTP routes call `buildJobInputData(body, type)` which doesn't
    // know orchestrator-internal context; doing this stamp here covers all
    // ~22 sync-HTTP node types from one call site without touching every
    // route's Zod schema. RMW pattern is safe because input_data is written
    // by the route INSERT then only updated by the worker writing
    // output_data (a different field) — no concurrent writers contend on
    // input_data after this point. Best-effort: a failed stamp only
    // degrades reconciler recovery (back to the 4h abandon threshold for
    // this job), so we log + continue rather than fail the workflow.
    const stampJobId = result.jobId as string
    try {
      const { data: jobRow } = await supabase
        .from("jobs")
        .select("input_data")
        .eq("id", stampJobId)
        .single()
      const existing = (jobRow?.input_data as Record<string, unknown>) ?? {}
      await supabase
        .from("jobs")
        .update({ input_data: { ...existing, node_id: node.id } })
        .eq("id", stampJobId)
    } catch (err) {
      console.warn(`[orchestrator] Failed to stamp node_id on sync-HTTP job ${stampJobId}:`, err)
    }
    // Route created a job — poll for completion
    return pollJobToCompletion(stampJobId, node.type, ctx)
  }

  // Normalize generatedText -> text for ai-writer responses
  if (result.generatedText && !result.text) {
    result.text = result.generatedText
  }

  const output = buildNodeOutputFromJobData(result, node.type)

  // Sync result with no job row: surface any credits the route reported so the
  // execution total isn't under-counted (most sync-HTTP nodes return a jobId and
  // take the path above; this covers the rare no-job responders).
  const reportedCredits = result.creditsUsed ?? result.creditsReserved
  return {
    output,
    jobId: result.jobId as string | undefined,
    usageLogId: result.usageLogId as string | undefined,
    creditsUsed: typeof reportedCredits === "number" ? reportedCredits : undefined,
  }
}

// Exported for testing so regression tests can assert sync-HTTP body shape.
export function buildSyncHttpBody(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  ctx: OrchestratorContext,
  userPromptTemplate?: string,
): Record<string, unknown> {
  const data = node.data
  // UNRESOLVED user-typed prompt template — passed through to the internal
  // route, which preserves it via `buildJobInputData` so single-node Run jobs
  // and orchestrated jobs land identical `jobs.input_data.userPrompt` values.
  // Caller (executeNode) captures this BEFORE field-mapping resolution so the
  // raw template (not the resolved/injected version) ends up in the body.
  const userPrompt = userPromptTemplate ?? extractUserPromptTemplate(node)
  const withUserPrompt = <T extends Record<string, unknown>>(body: T): T =>
    userPrompt !== undefined ? ({ ...body, userPrompt } as T) : body

  switch (node.type) {
    case "ai-writer":
      return withUserPrompt({
        systemPrompt: data.systemPrompt || data.template,
        userInput: resolvedInputs.prompt || data.userInput || data.prompt,
        userId: ctx.userId,
        llmModel: data.llmModel,
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 4096,
      })

    case "llm-chat":
      return withUserPrompt({
        systemPrompt: resolvedInputs.systemPrompt || data.systemPrompt,
        userInput: resolvedInputs.prompt || data.userInput,
        referenceImageUrls: resolvedInputs.referenceImageUrls,
        referenceVideoUrls: resolvedInputs.referenceVideoUrls,
        referenceAudioUrls: resolvedInputs.referenceAudioUrls,
        llmModel: data.llmModel,
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 2048,
        userId: ctx.userId,
      })

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
      return withUserPrompt({
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
      })
    }

    case "after-effects":
      return withUserPrompt({
        prompt: resolvedInputs.prompt || data.effectPrompt || data.prompt,
        // Route schema requires `inputVideoUrl`; sending `videoUrl` fails Zod validation.
        inputVideoUrl: resolvedInputs.videoUrl || data.sourceVideoUrl || data.inputVideoUrl,
        fps: data.fps,
        width: data.width,
        height: data.height,
        durationSeconds: data.durationSeconds,
        llmModel: data.llmModel,
        userId: ctx.userId,
      })

    case "lottie-overlay": {
      // Lottie assets come from upstream edges with targetHandle "lottie" (resolved
      // by input-resolver into resolvedInputs.lottieAssets) with a fallback to
      // node data for direct API calls.
      const lottieAssets =
        resolvedInputs.lottieAssets ??
        (data.lottieAssets as Array<{ url: string; name?: string }> | undefined)
      return withUserPrompt({
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
      })
    }

    case "3d-title":
      return withUserPrompt({
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
      })

    case "motion-graphics":
      return withUserPrompt({
        prompt: resolvedInputs.prompt || data.motionPrompt || data.prompt,
        fps: data.fps,
        aspectRatio: data.aspectRatio,
        width: data.width,
        height: data.height,
        durationSeconds: data.durationSeconds,
        backgroundColor: data.backgroundColor,
        llmModel: data.llmModel,
        userId: ctx.userId,
      })

    case "image-to-text":
      return withUserPrompt({
        imageUrl: resolvedInputs.imageUrl || data.imageUrl,
        customPrompt: resolvedInputs.prompt || data.customPrompt || data.prompt,
        detailLevel: data.detailLevel || "detailed",
        llmModel: data.llmModel,
        userId: ctx.userId,
      })

    case "suno-style-boost":
      return withUserPrompt({
        content: resolvedInputs.prompt || data.content || data.prompt,
        userId: ctx.userId,
      })

    case "qa-check":
      return withUserPrompt({
        content: resolvedInputs.prompt || data.content,
        checkType: data.checkType || "content",
        provider: data.provider || "claude",
        threshold: data.threshold ?? 0.7,
        llmModel: data.llmModel,
        userId: ctx.userId,
      })

    case "image-critic":
      return withUserPrompt({
        imageUrl: resolvedInputs.imageUrl,
        referenceImageUrl: resolvedInputs.referenceImageUrl,
        prompt: resolvedInputs.prompt ?? (data.prompt as string | undefined),
        mode: data.mode,
        threshold: data.threshold,
        llmModel: data.llmModel,
        workflowId: ctx.workflowId,
        userId: ctx.userId,
      })

    case "save-to-storage":
      // No user-typed prompt — operates on upstream URLs only.
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
      return withUserPrompt({
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
      })
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
      return withUserPrompt(body)
    }

    case "reduce": {
      // Fan-in node — `resolvedInputs.inputs` is populated by the input-resolver's
      // FAN_IN_NODE_TYPES branch with the upstream listResults (or a single
      // upstream output wrapped as `[output]`). The strategy + its config come
      // straight from node data; strategyConfig falls back to {} so the route's
      // Zod default applies cleanly. workflowId is informational — forwarded
      // so the route's `extractWorkflowId` can attribute the standalone job to
      // the parent workflow for execution-history display.
      return {
        strategyId: (data.strategyId as string | undefined) ?? "concat",
        strategyConfig: (data.strategyConfig as Record<string, unknown> | undefined) ?? {},
        inputs: resolvedInputs.inputs ?? [],
        workflowId: ctx.workflowId,
        userId: ctx.userId,
      }
    }

    default:
      return withUserPrompt({ ...data, userId: ctx.userId } as Record<string, unknown>)
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
  userPromptTemplate?: string,
): Promise<ExecuteNodeResult> {
  // 1. Create placeholder job record (we need the jobId for payload building).
  // `node_id` is recorded in `input_data` so the reconcile cron can map a
  // `jobs` row back to its owning node even when the orchestrator died
  // before `ctx.onJobCreated` got to persist `node_states[X].jobId`. Without
  // this, a mid-flight orchestrator crash leaves the execution stuck and
  // eventually marked "orphaned" even though the child job succeeded.
  const isUploadDescendant = ctx.uploadDescendantIds?.has(node.id) ?? false
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      workflow_id: null,
      workflow_execution_id: ctx.executionId,
      user_id: ctx.userId,
      status: "pending",
      input_data: { type: node.type, node_id: node.id },
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
  // buildPayload may THROW for a structurally-invalid node (e.g. the
  // ai-avatar / cinematic-avatar payload validators reject a workflow/app/MCP
  // input that bypassed the route Zod). The pending jobs row was already
  // inserted above, so delete it on throw before propagating — mirrors the
  // reservation catch below so a validation failure never leaves an orphan
  // pending row for the reconciler to sweep.
  const settings = ctx.workflowSettings as WorkflowSettings | undefined
  let buildResult: ReturnType<typeof buildPayload>
  try {
    buildResult = buildPayload(
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
  } catch (err) {
    await supabase.from("jobs").delete().eq("id", jobId)
    throw err instanceof Error
      ? err
      : new Error(`Failed to build payload for ${node.type}: ${String(err)}`)
  }
  const { jobName, queueName, payload, modelIdentifier } = buildResult

  // 2b. Update job with full input_data from the built payload
  // Store all payload fields so the execution detail modal can show complete inputs.
  // Internal fields (jobId, userId, usageLogId) are kept — useful for admin debugging;
  // regular users never see raw input_data anyway (sanitizeJobForPublic strips sensitive job fields).
  // Build the post-payload-build input_data. `type` and `node_id` are
  // listed AFTER the spread so a future payload field that happens to share
  // either key can't silently override them — the reconciler's Path-2 relies
  // on `node_id` matching `node.id` exactly to map orphan-recovered rows
  // back to their owning node.
  const inputData: Record<string, unknown> = { ...payload, type: node.type, node_id: node.id }
  // Backfill resolved inputs that payload may not carry (e.g. upstream media URLs)
  if (!inputData.imageUrl && resolvedInputs.imageUrl) inputData.imageUrl = resolvedInputs.imageUrl
  if (!inputData.videoUrl && resolvedInputs.videoUrl) inputData.videoUrl = resolvedInputs.videoUrl
  if (!inputData.audioUrl && resolvedInputs.audioUrl) inputData.audioUrl = resolvedInputs.audioUrl
  // Capture the UNRESOLVED user-typed prompt template so single-node Run jobs
  // and orchestrated jobs land identical `jobs.input_data.userPrompt` values
  // (matches the frontend `setUserPromptTemplate` + `withWorkflowId` pattern).
  // The template is captured by the caller BEFORE field-mapping rewrites
  // `node.data.<field>`; the fallback to `extractUserPromptTemplate(node)` here
  // covers callers that bypass `executeNode` (e.g. direct unit-test entry).
  if (inputData.userPrompt === undefined) {
    const template = userPromptTemplate ?? extractUserPromptTemplate(node)
    if (template !== undefined) inputData.userPrompt = template
  }

  await supabase
    .from("jobs")
    .update({ input_data: inputData })
    .eq("id", jobId)

  // 3. Reserve credits (skip for FFmpeg / 0-credit nodes)
  let usageLogId: string | undefined
  let creditsUsed = 0

  if (hasCredits() && modelIdentifier !== "ffmpeg") {
    try {
      // Free-tier / blocked-models gate. reserveCredits does NOT check
      // blockedModels, so without this a free-tier workflow/app run could
      // generate a blocked model (e.g. 4K gemini-omni-video). checkCredits
      // self-fetches the profile and reports blocked/over-limit; the
      // surrounding catch deletes the orphaned pending jobs row on throw.
      const preflight = await CreditsService.checkCredits(ctx.userId, modelIdentifier, ctx.isAppRun)
      if (!preflight.allowed) {
        throw new Error(preflight.error ?? "Model not available on your plan or insufficient credits")
      }

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

/** Build the ExecuteNodeResult for a completed job row. Shared by the poll
 *  success path and the cancel-race adoption path so both extract output and
 *  credits identically. Throws if the job completed with no usable output. */
function completedJobResult(
  jobRecord: { output_data?: unknown; credits_actual?: unknown },
  nodeType: string,
  jobId: string,
  usageLogId: string | undefined,
  creditsUsed: number | undefined,
): ExecuteNodeResult {
  const outputData = (jobRecord.output_data as Record<string, unknown>) ?? {}
  const output = buildNodeOutputFromJobData(outputData, nodeType)
  const hasOutput = Object.values(output).some((v) => v != null)
  if (!hasOutput) {
    throw new Error(`Job ${jobId} completed but produced no output — provider may have returned an empty result`)
  }
  const effectiveCreditsUsed = creditsUsed
    ?? (typeof jobRecord.credits_actual === "number" ? jobRecord.credits_actual : undefined)
  return { output, jobId, usageLogId, creditsUsed: effectiveCreditsUsed }
}

/**
 * Cancel the underlying job and refund, then throw `reason`.
 *
 * Race-safe: the UPDATE only flips a NON-terminal job. If the worker completed
 * + committed the job within the ≤3s poll gap (so the cancel raced a real
 * completion), we must NOT overwrite completed→cancelled (audit corruption) and
 * must NOT discard a result the user already paid for (the refund CAS no-ops
 * against committed credits → charge-without-delivery). In that case we ADOPT
 * the completion and return its result instead of throwing.
 */
async function cancelJobAndThrow(
  jobId: string,
  usageLogId: string | undefined,
  reason: string,
  nodeType: string,
  creditsUsed: number | undefined,
): Promise<ExecuteNodeResult> {
  const { data: flipped } = await supabase
    .from("jobs")
    .update({ status: "cancelled" })
    .eq("id", jobId)
    .not("status", "in", "(completed,failed,cancelled)")
    .select("id")

  if (flipped && flipped.length > 0) {
    // We genuinely cancelled a still-running job → refund + propagate cancel.
    await refundJobCredits(usageLogId, jobId, reason)
    throw new Error(reason)
  }

  // 0 rows flipped → the job reached a terminal state in the poll gap.
  const { data: jobRecord } = await supabase
    .from("jobs")
    .select("status, output_data, error_message, credits_actual")
    .eq("id", jobId)
    .single()
  if (jobRecord?.status === "completed") {
    // Charge-with-delivery: honor the completion the user already paid for
    // rather than throwing "cancelled" and discarding the committed output.
    return completedJobResult(jobRecord, nodeType, jobId, usageLogId, creditsUsed)
  }
  // Already failed (worker refunds failed jobs) or already cancelled — no
  // double-refund. Surface the job's own error if present, else the reason.
  throw new Error((jobRecord?.error_message as string) || reason)
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
      return await cancelJobAndThrow(jobId, usageLogId, "Execution cancelled", nodeType, creditsUsed)
    }

    // Absolute timeout — prevents infinite polling when job never leaves "pending"
    // (e.g. worker down, queue full). Safety net beyond NODE_TIMEOUT_MS which only
    // starts counting after the worker picks up the job.
    if (Date.now() - pollStartTime > POLL_ABSOLUTE_TIMEOUT_MS) {
      return await cancelJobAndThrow(jobId, usageLogId, `Poll timeout: job did not complete within ${POLL_ABSOLUTE_TIMEOUT_MS / 1000}s (may still be pending in queue)`, nodeType, creditsUsed)
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
        return await cancelJobAndThrow(jobId, usageLogId, "Execution cancelled", nodeType, creditsUsed)
      }
    }

    // Poll job status. credits_actual lets sync-HTTP nodes (which reserve +
    // commit inside their own route, so the orchestrator never received a
    // creditsUsed) report what they spent into the execution total.
    const { data: jobRecord } = await supabase
      .from("jobs")
      .select("status, output_data, error_message, progress, credits_actual")
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
      return completedJobResult(jobRecord, nodeType, jobId, usageLogId, creditsUsed)
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
      return await cancelJobAndThrow(jobId, usageLogId, `Node timeout after ${NODE_TIMEOUT_MS / 1000}s of processing`, nodeType, creditsUsed)
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

  // Build inputOverrides (handle-aware). Compound handle ids (nodeId::portId)
  // get routed to the sub-workflow-input node's __injectedPortValues slot via
  // applyHandleInputOverride — mirrors the frontend component-executor.
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
      applyHandleInputOverride(inputOverrides, handle, value)
    }
  }

  // Pick up config-panel input values (stored in exposedSettings as "nodeId:fieldKey")
  for (const handle of componentMetadata.inputs) {
    if (isHandleInputWired(inputOverrides, handle)) continue
    const settingKey = `${handle.id}:${handle.fieldKey}`
    const settingVal = exposedSettings[settingKey]
    if (settingVal !== undefined && settingVal !== "") {
      applyHandleInputOverride(inputOverrides, handle, settingVal)
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
