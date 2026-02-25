/**
 * Node executor — dispatches node execution based on type category.
 *
 * Category 1: Worker-queued — creates job, reserves credits, enqueues to BullMQ, polls for completion
 * Category 2: Sync HTTP — calls internal route (ai-writer, scene-graph-ai, after-effects-ai, etc.)
 * Category 3: Inline — runs in-process (combine-text, split-text, composite)
 * Category 4: Source — no execution (text-prompt, upload-*, triggers)
 * Category 5: Skipped — manual-edit, etc.
 */

import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { renderQueue } from "../../lib/render-queue.js"
import { hasCredits } from "../../lib/config.js"
import { CreditsService } from "../../billing/credits.js"
import { buildPayload } from "./payload-builder.js"
import { buildNodeOutputFromJobData } from "./output-extractor.js"
import { executeCombineText, executeSplitText, executeComposite } from "./inline-executor.js"
import type {
  SimpleNode,
  SimpleEdge,
  ResolvedInputs,
  NodeOutput,
  NodeExecutionState,
  OrchestratorContext,
} from "./types.js"
import { JOB_POLL_INTERVAL_MS, NODE_TIMEOUT_MS } from "./types.js"
import { isSourceNode, isSkipNode } from "./execution-graph.js"

// ---------------------------------------------------------------------------
// Sync HTTP node types — called via internal fetch
// ---------------------------------------------------------------------------

const SYNC_HTTP_NODES = new Set([
  "ai-writer",
  "video-composer",
  "after-effects",
  "lottie-overlay",
  "3d-title",
  "motion-graphics",
  "image-to-text",
])

// Maps node type to internal route path
const SYNC_HTTP_ROUTES: Record<string, string> = {
  "ai-writer": "/v1/ai-writer/generate",
  "video-composer": "/v1/scene-graph-ai/generate",
  "after-effects": "/v1/after-effects-ai/generate",
  "lottie-overlay": "/v1/lottie-overlay-ai/generate",
  "3d-title": "/v1/three-d-title-ai/generate",
  "motion-graphics": "/v1/motion-graphics-ai/generate",
  "image-to-text": "/v1/image-to-text/generate",
}

// Model identifiers for sync HTTP routes
const SYNC_HTTP_MODEL_IDS: Record<string, string> = {
  "ai-writer": "ai-writer",
  "video-composer": "scene-graph-ai",
  "after-effects": "after-effects",
  "lottie-overlay": "lottie-overlay",
  "3d-title": "3d-title",
  "motion-graphics": "motion-graphics",
  "image-to-text": "image-to-text",
}

// ---------------------------------------------------------------------------
// Inline node types — executed in-process
// ---------------------------------------------------------------------------

const INLINE_NODES = new Set([
  "combine-text",
  "split-text",
  "composite",
])

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export interface ExecuteNodeResult {
  output: NodeOutput
  jobId?: string
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

  // Inline nodes
  if (INLINE_NODES.has(node.type)) {
    return executeInlineNode(node, resolvedInputs, edges, allNodes, nodeStates)
  }

  // Sync HTTP nodes
  if (SYNC_HTTP_NODES.has(node.type)) {
    return executeSyncHttpNode(node, resolvedInputs, ctx)
  }

  // Worker-queued nodes (default)
  return executeWorkerNode(node, resolvedInputs, ctx)
}

// ---------------------------------------------------------------------------
// Inline execution
// ---------------------------------------------------------------------------

function executeInlineNode(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): ExecuteNodeResult {
  let output: NodeOutput

  switch (node.type) {
    case "combine-text":
      output = executeCombineText(node, edges, allNodes, nodeStates)
      break
    case "split-text":
      output = executeSplitText(node, resolvedInputs)
      break
    case "composite":
      output = executeComposite(node, edges, allNodes, nodeStates)
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

  const port = process.env.PORT || "8000"
  const url = `http://localhost:${port}${route}`

  // Build request body from node data + resolved inputs
  const body = buildSyncHttpBody(node, resolvedInputs, ctx)

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Use service-role auth — these internal calls bypass user-level auth
      "X-Internal-Orchestrator": "true",
      // Pass userId for the route to use
    },
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

function buildSyncHttpBody(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  ctx: OrchestratorContext,
): Record<string, unknown> {
  const data = node.data

  switch (node.type) {
    case "ai-writer":
      return {
        systemPrompt: data.systemPrompt || data.template,
        userInput: resolvedInputs.prompt || data.prompt || data.userInput,
        userId: ctx.userId,
        model: data.model,
        temperature: data.temperature,
        maxTokens: data.maxTokens,
      }

    case "video-composer":
      return {
        prompt: resolvedInputs.prompt || data.prompt,
        userId: ctx.userId,
        videoUrl: resolvedInputs.videoUrl,
        imageUrls: resolvedInputs.referenceImageUrls,
      }

    // After-effects and lottie-overlay share the same body shape (prompt + videoUrl)
    case "after-effects":
    case "lottie-overlay":
      return {
        prompt: resolvedInputs.prompt || data.prompt,
        videoUrl: resolvedInputs.videoUrl || data.sourceVideoUrl,
        userId: ctx.userId,
      }

    // 3D title and motion graphics only need prompt
    case "3d-title":
    case "motion-graphics":
      return {
        prompt: resolvedInputs.prompt || data.prompt,
        userId: ctx.userId,
      }

    case "image-to-text":
      return {
        imageUrl: resolvedInputs.imageUrl || data.imageUrl,
        prompt: resolvedInputs.prompt || data.prompt || "Describe this image in detail.",
        userId: ctx.userId,
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
): Promise<ExecuteNodeResult> {
  // 1. Create job record
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      workflow_id: null,
      workflow_execution_id: ctx.executionId,
      user_id: ctx.userId,
      status: "pending",
      input_data: {
        type: node.type,
        prompt: resolvedInputs.prompt,
        imageUrl: resolvedInputs.imageUrl,
        videoUrl: resolvedInputs.videoUrl,
        audioUrl: resolvedInputs.audioUrl,
      },
    })
    .select("id")
    .single()

  if (jobError || !job) {
    throw new Error(`Failed to create job for node ${node.id}: ${jobError?.message ?? "unknown"}`)
  }

  const jobId = job.id

  // 2. Build payload
  const { jobName, queueName, payload, modelIdentifier } = buildPayload(
    node,
    jobId,
    resolvedInputs,
  )

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
      )
      usageLogId = reservation.usageLogId
      creditsUsed = reservation.creditsReserved

      // Update job with reservation info
      await supabase
        .from("jobs")
        .update({
          usage_log_id: reservation.usageLogId,
          credits_estimated: reservation.creditsReserved,
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

  // 5. Enqueue to BullMQ
  const queue = queueName === "video-render" ? renderQueue : videoQueue
  await queue.add(jobName, enrichedPayload)

  // 6. Poll for job completion
  return pollJobToCompletion(jobId, node.type, ctx, usageLogId, creditsUsed)
}

// ---------------------------------------------------------------------------
// Job polling
// ---------------------------------------------------------------------------

async function pollJobToCompletion(
  jobId: string,
  nodeType: string,
  ctx: OrchestratorContext,
  usageLogId?: string,
  creditsUsed?: number,
): Promise<ExecuteNodeResult> {
  const startTime = Date.now()

  while (true) {
    // Check cancellation
    if (ctx.cancelled) {
      throw new Error("Execution cancelled")
    }

    // Check timeout
    if (Date.now() - startTime > NODE_TIMEOUT_MS) {
      throw new Error(`Node timeout after ${NODE_TIMEOUT_MS / 1000}s`)
    }

    // Poll job status
    const { data: jobRecord } = await supabase
      .from("jobs")
      .select("status, output_data, error_message")
      .eq("id", jobId)
      .single()

    if (!jobRecord) {
      throw new Error(`Job ${jobId} not found`)
    }

    const status = jobRecord.status as string

    if (status === "completed") {
      const outputData = (jobRecord.output_data as Record<string, unknown>) ?? {}
      const output = buildNodeOutputFromJobData(outputData, nodeType)
      return { output, jobId, usageLogId, creditsUsed }
    }

    if (status === "failed" || status === "cancelled") {
      const errorMsg = (jobRecord.error_message as string) ?? `Job ${status}`
      throw new Error(errorMsg)
    }

    // Wait before next poll
    await sleep(JOB_POLL_INTERVAL_MS)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
