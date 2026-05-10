/**
 * KIE.ai API Client - Core HTTP + polling logic
 *
 * Extracted from services/kie-ai.ts. Provides the low-level API client
 * used by all KIE provider modules (image, video, audio).
 *
 * API docs: https://docs.kie.ai/
 * Base URL: https://api.kie.ai
 * Auth: Bearer token (KIE_API_KEY)
 */

import { config } from "../../lib/config.js"

const DEBUG = config.NODE_ENV === "development"

// =============================================================================
// CONSTANTS
// =============================================================================

export const KIE_API_BASE = "https://api.kie.ai"
export const POLL_INTERVAL_MS = 2000 // Used by kling3-client
// With exponential backoff: ~15 min total for 120 attempts
export const MAX_POLL_ATTEMPTS = 120
export const MAX_POLL_ATTEMPTS_VIDEO = 120

// =============================================================================
// ERROR SANITIZATION (Cloud edition: don't expose "KIE.ai" to customers)
// =============================================================================

/**
 * Custom error class that carries both sanitized message (for UI) and internal details (for logs/debugging).
 * The `message` property is user-friendly, while `internalDetails` contains the raw KIE.ai error.
 */
export class KieError extends Error {
  public readonly internalDetails: string
  public readonly context: string

  constructor(
    sanitizedMessage: string,
    internalDetails: string,
    context: string
  ) {
    super(sanitizedMessage)
    this.name = "KieError"
    this.internalDetails = internalDetails
    this.context = context
  }

  /** Get full error message including internal details (for logging/debugging) */
  getFullMessage(): string {
    return `[${this.context}] ${this.message} | Internal: ${this.internalDetails}`
  }
}

/**
 * Create a sanitized error for user display while logging full details.
 * In cloud edition, we don't want to expose "KIE.ai" provider name to customers.
 * Returns a KieError that carries both the sanitized message and internal details.
 */
export function createSanitizedError(
  internalMessage: string,
  context: string
): KieError {
  // Log the full internal error for debugging (visible in Railway logs)
  console.error(
    `[KIE.ai INTERNAL ERROR] ${context}: ${internalMessage}`
  )

  // Parse specific error patterns and return user-friendly messages
  const lowerMsg = internalMessage.toLowerCase()

  let sanitizedMessage: string

  if (
    lowerMsg.includes("aspect_ratio") ||
    lowerMsg.includes("aspect ratio")
  ) {
    sanitizedMessage =
      "Invalid aspect ratio setting. Please try a different option."
  } else if (
    lowerMsg.includes("timed out") ||
    lowerMsg.includes("timeout")
  ) {
    sanitizedMessage = "Generation timed out. Please try again."
  } else if (
    lowerMsg.includes("not configured") ||
    lowerMsg.includes("api_key")
  ) {
    sanitizedMessage =
      "Service is not properly configured. Please contact support."
  } else if (
    lowerMsg.includes("rate limit") ||
    lowerMsg.includes("quota") ||
    lowerMsg.includes("429")
  ) {
    sanitizedMessage =
      "Service is temporarily busy. Please try again in a moment."
  } else if (
    lowerMsg.includes("invalid") ||
    lowerMsg.includes("validation")
  ) {
    sanitizedMessage =
      "Invalid input parameters. Please check your settings and try again."
  } else if (lowerMsg.includes("not support")) {
    sanitizedMessage =
      "This operation is not supported with the current provider."
  } else if (
    lowerMsg.includes("cannot exceed") ||
    lowerMsg.includes("too long") ||
    lowerMsg.includes("too large") ||
    lowerMsg.includes("file size") ||
    lowerMsg.includes("duration limit") ||
    lowerMsg.includes("exceeds")
  ) {
    sanitizedMessage =
      "Input file exceeds the size or duration limit. Please use a shorter or smaller file."
  } else if (
    lowerMsg.includes("filtered") ||
    lowerMsg.includes("prohibited") ||
    lowerMsg.includes("content policy") ||
    lowerMsg.includes("safety filter") ||
    lowerMsg.includes("safety policy") ||
    lowerMsg.includes("moderation") ||
    lowerMsg.includes("violat") ||
    lowerMsg.includes("nsfw") ||
    lowerMsg.includes("inappropriate")
  ) {
    sanitizedMessage =
      "Content policy violation: The output was blocked by the provider's safety filter. Try modifying your prompt or input image."
  } else {
    // Generic fallback - hide all provider-specific details
    sanitizedMessage = `${context} failed. Please try again or contact support if the issue persists.`
  }

  return new KieError(sanitizedMessage, internalMessage, context)
}

// =============================================================================
// TYPES
// =============================================================================

export interface KieTaskResponse {
  code: number
  message: string
  data: {
    taskId: string
    status?: string
  }
}

export interface KieRecordInfoResponse {
  code: number
  message: string
  data: {
    taskId: string
    // Valid states per docs.kie.ai/market/common/get-task-detail:
    // - "waiting": Task is queued and waiting to be processed
    // - "queuing": Task is in the processing queue
    // - "generating": Task is currently being processed
    // - "success": Task completed successfully
    // - "fail": Task failed (NOTE: "fail" not "failed"!)
    state: "waiting" | "queuing" | "generating" | "success" | "fail"
    resultJson?: string // JSON string: {"resultUrls": ["url1", "url2"]}
    failCode?: string
    failMsg?: string
    costTime?: number
    completeTime?: string
    createTime?: string
    progress?: number // 0-100
  }
}

export interface VeoRecordInfoResponse {
  code: number
  msg: string
  data: {
    taskId: string
    paramJson?: string
    // Unix epoch ms (per live API); typed as number | string for safety
    createTime?: number | string
    completeTime?: number | string
    successFlag: number // 0=generating, 1=success, 2=failed, 3=generation failed
    fallbackFlag?: boolean
    errorCode?: number
    errorMessage?: string
    response?: {
      taskId: string
      resultUrls: string[]
      originUrls?: string[]
      // VEO Extend tasks return the full stitched video here
      fullResultUrls?: string[]
      // Snake-case duplicate the API also emits — kept for forward-compat
      full_result_urls?: string[]
      // Per-result audio presence flags (parallel to resultUrls)
      hasAudioList?: boolean[]
      // Per-result seeds VEO actually used — KIE returns these even when
      // no seed was supplied in the request. Source of truth for
      // reproducibility; used by the perfect-loop component to pin a
      // winning roll.
      seeds?: number[]
      resolution?: string
    }
  }
}

export interface KieResultJson {
  resultUrls?: string[]
  audioUrl?: string // For TTS/music
  videoUrl?: string // For video
}

/** Progress callback type for real-time progress updates */
export type ProgressCallback = (progress: number) => Promise<void>

// =============================================================================
// HELPERS
// =============================================================================

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Exponential backoff: 2s for first 5, ramp to 10s cap */
export function pollDelay(attempt: number): number {
  if (attempt <= 5) return 2000
  if (attempt <= 15) return Math.min(2000 + (attempt - 5) * 1000, 10000)
  return 10000
}

// =============================================================================
// CORE API FUNCTIONS
// =============================================================================

/**
 * Submit a task to KIE.ai and poll for completion
 * @param onProgress - Optional callback called when progress updates (0-100)
 */
export async function runKieTask(
  model: string,
  input: Record<string, unknown>,
  maxAttempts: number = MAX_POLL_ATTEMPTS,
  onProgress?: ProgressCallback
): Promise<{
  resultJson: KieResultJson
  /** Provider-reported generation time in seconds (KIE `costTime`). */
  costTime?: number
  /** Same as `costTime` but in milliseconds for ProviderResult.providerMs. */
  providerMs?: number
  rawRecordInfo?: Record<string, unknown>
  taskId?: string
}> {
  const apiKey = config.KIE_API_KEY

  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Image generation"
    )
  }

  const requestBody = { model, input }

  if (DEBUG) {
    console.log(`[KIE.ai] >>>>>> SENDING TO KIE.AI API <<<<<<`)
    console.log(`[KIE.ai] Endpoint: ${KIE_API_BASE}/api/v1/jobs/createTask`)
    console.log(`[KIE.ai] Model: ${model}`)
    console.log(`[KIE.ai] FULL REQUEST BODY:`)
    console.log(JSON.stringify(requestBody, null, 2))
    console.log(`[KIE.ai] >>>>>> END REQUEST BODY <<<<<<`)
  }

  // Step 1: Create task
  const createResponse = await fetch(
    `${KIE_API_BASE}/api/v1/jobs/createTask`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await createResponse.text()
  if (DEBUG) {
    console.log(`[KIE.ai] Response status: ${createResponse.status}`)
    console.log(`[KIE.ai] Response body (first 500 chars): ${responseText.substring(0, 500)}`)
  }

  if (!createResponse.ok) {
    console.error(
      `[KIE.ai] createTask HTTP error - Status: ${createResponse.status}, Body: ${responseText}`
    )
    throw createSanitizedError(
      `createTask failed: ${createResponse.status} - ${responseText}`,
      "Generation"
    )
  }

  let createData: KieTaskResponse
  try {
    createData = JSON.parse(responseText) as KieTaskResponse
  } catch {
    throw createSanitizedError(
      `response is not valid JSON: ${responseText}`,
      "Generation"
    )
  }

  if (
    createData.code !== 0 &&
    createData.code !== 200 &&
    createData.code !== undefined
  ) {
    console.error(
      `[KIE.ai] createTask API error - Code: ${createData.code}, Message: ${createData.message}, Full: ${JSON.stringify(createData)}`
    )
    throw createSanitizedError(
      `createTask error (code ${createData.code}): ${createData.message ?? JSON.stringify(createData)}`,
      "Generation"
    )
  }

  if (!createData.data?.taskId) {
    throw createSanitizedError(
      `createTask response missing taskId: ${JSON.stringify(createData)}`,
      "Generation"
    )
  }

  const taskId = createData.data.taskId
  console.log(`[KIE.ai] Task created: ${taskId}`)

  // Step 2: Poll for completion with exponential backoff
  let attempts = 0
  while (attempts < maxAttempts) {
    attempts++
    await sleep(pollDelay(attempts))

    let detailResponse: Response
    try {
      detailResponse = await fetch(
        `${KIE_API_BASE}/api/v1/jobs/recordInfo?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        if (DEBUG) console.log(`[KIE.ai] Poll attempt ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

    if (!detailResponse.ok) {
      console.warn(
        `[KIE.ai] Poll attempt ${attempts} failed: ${detailResponse.status}`
      )
      continue
    }

    const detailText = await detailResponse.text()
    let detailData: KieRecordInfoResponse
    try {
      detailData = JSON.parse(detailText) as KieRecordInfoResponse
    } catch {
      console.warn(
        `[KIE.ai] Poll attempt ${attempts} invalid JSON`
      )
      continue
    }

    const state = detailData.data?.state
    if (!state) {
      console.warn(
        `[KIE.ai] Poll attempt ${attempts} missing state`
      )
      continue
    }

    // Log progress (0-100) and call callback if provided
    const progress = detailData.data.progress
    if (DEBUG) {
      console.log(`[KIE.ai] Task ${taskId} state: ${state}${progress !== undefined ? ` (progress: ${progress}%)` : ""} (attempt ${attempts})`)
    }

    // Call progress callback if we have progress data
    if (progress !== undefined && onProgress) {
      try {
        await onProgress(progress)
      } catch (e) {
        console.warn(`[KIE.ai] Progress callback error:`, e)
      }
    }

    if (state === "success") {
      const resultJsonStr = detailData.data.resultJson
      if (!resultJsonStr) {
        throw createSanitizedError(
          "task succeeded but no resultJson found",
          "Generation"
        )
      }

      let resultJson: KieResultJson
      try {
        resultJson = JSON.parse(resultJsonStr) as KieResultJson
      } catch {
        throw createSanitizedError(
          `resultJson is not valid JSON: ${resultJsonStr}`,
          "Generation"
        )
      }

      // Capture the full raw response for credit audit (credit-related fields may be hidden)
      const rawRecordInfo = detailData as unknown as Record<string, unknown>
      const costTime = detailData.data.costTime
      // KIE returns costTime in seconds; convert to ms for ProviderResult.providerMs.
      const providerMs = costTime !== undefined ? Math.round(costTime * 1000) : undefined
      return { resultJson, costTime, providerMs, rawRecordInfo, taskId }
    }

    // NOTE: KIE.ai API returns "fail" not "failed"!
    if (state === "fail") {
      const failMsg = detailData.data.failMsg ?? "Unknown error"
      const failCode = detailData.data.failCode ?? "no_code"
      console.error(`[KIE.ai] Task ${taskId} FAILED:`)
      console.error(`  failCode: ${failCode}`)
      console.error(`  failMsg: ${failMsg}`)
      console.error(
        `  Full response: ${JSON.stringify(detailData, null, 2)}`
      )
      throw createSanitizedError(
        `task failed: [${failCode}] ${failMsg}`,
        "Generation"
      )
    }

    // States "waiting", "queuing", "generating" are all in-progress - continue polling
  }

  throw createSanitizedError(
    `task timed out after ${maxAttempts} poll attempts`,
    "Generation"
  )
}

/**
 * VEO3 uses a special API endpoint: /api/v1/veo/generate
 * Polling uses: /api/v1/veo/record-info (NOT the standard /api/v1/jobs/recordInfo)
 * Status is indicated by successFlag (not state):
 *   0 = generating (still processing)
 *   1 = success
 *   2 = failed
 *   3 = generation failed
 */
export async function runVeoTask(
  model: string,
  prompt: string,
  imageUrls?: string[],
  options?: { aspectRatio?: string; seed?: number; generationType?: string; resolution?: string; enableTranslation?: boolean }
): Promise<{
  resultJson: KieResultJson
  costTime?: number
  taskId: string
  rawRecordInfo?: Record<string, unknown>
  /** Seed VEO used (returned by KIE even when none was supplied). */
  seed?: number
  /** True iff KIE silently swapped to the deprecated fallback model. */
  fallbackFlag?: boolean
  /** Provider generation duration in ms (KIE completeTime − createTime). */
  providerMs?: number
}> {
  const apiKey = config.KIE_API_KEY

  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Video generation"
    )
  }

  const requestBody: Record<string, unknown> = {
    model, // "veo3" or "veo3_fast"
    prompt,
  }

  // Add image URLs for image-to-video mode
  if (imageUrls?.length) {
    requestBody.imageUrls = imageUrls
    if (options?.generationType) {
      requestBody.generationType = options.generationType
    } else {
      // Use FIRST_AND_LAST_FRAMES_2_VIDEO only when both start+end frames are provided;
      // single image uses IMAGE_2_VIDEO to avoid VEO treating it as both first and last frame
      requestBody.generationType = imageUrls.length >= 2
        ? "FIRST_AND_LAST_FRAMES_2_VIDEO"
        : "IMAGE_2_VIDEO"
    }
  } else {
    requestBody.generationType = options?.generationType ?? "TEXT_2_VIDEO"
  }

  // VEO-specific optional params
  if (options?.aspectRatio) {
    requestBody.aspect_ratio = options.aspectRatio
  }
  if (options?.seed !== undefined) {
    requestBody.seeds = options.seed
  }
  // 720p (default) or 1080p inline. 4K requires the separate
  // /api/v1/veo/get-4k-video endpoint and is exposed via a dedicated node.
  if (options?.resolution) {
    requestBody.resolution = options.resolution
  }
  // Default true upstream. Surfaced so users with non-English prompts
  // can opt out of KIE's auto-translate (which can subtly rewrite the
  // perfect-loop seal phrase).
  if (options?.enableTranslation !== undefined) {
    requestBody.enableTranslation = options.enableTranslation
  }

  if (DEBUG) {
    console.log(`[KIE.ai VEO] Creating VEO task with model: ${model}`)
    console.log(`[KIE.ai VEO] Request body:`, JSON.stringify(requestBody, null, 2))
  }

  // Step 1: Create VEO task using special endpoint
  const createResponse = await fetch(
    `${KIE_API_BASE}/api/v1/veo/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await createResponse.text()
  if (DEBUG) {
    console.log(`[KIE.ai VEO] Response status: ${createResponse.status}`)
    console.log(`[KIE.ai VEO] Response body: ${responseText.substring(0, 500)}`)
  }

  if (!createResponse.ok) {
    throw createSanitizedError(
      `VEO generate failed: ${createResponse.status} - ${responseText}`,
      "Video generation"
    )
  }

  let createData: KieTaskResponse
  try {
    createData = JSON.parse(responseText) as KieTaskResponse
  } catch {
    throw createSanitizedError(
      `VEO response is not valid JSON: ${responseText}`,
      "Video generation"
    )
  }

  if (
    createData.code !== 0 &&
    createData.code !== 200 &&
    createData.code !== undefined
  ) {
    throw createSanitizedError(
      `VEO generate error (code ${createData.code}): ${createData.message ?? JSON.stringify(createData)}`,
      "Video generation"
    )
  }

  if (!createData.data?.taskId) {
    throw createSanitizedError(
      `VEO generate response missing taskId: ${JSON.stringify(createData)}`,
      "Video generation"
    )
  }

  const taskId = createData.data.taskId
  console.log(`[KIE.ai VEO] Task created: ${taskId}`)

  const poll = await pollVeoRecordInfo(taskId, "VEO", apiKey)
  return {
    resultJson: { resultUrls: poll.resultUrls },
    costTime: undefined,
    taskId,
    rawRecordInfo: poll.rawRecordInfo,
    seed: poll.seeds?.[0],
    fallbackFlag: poll.fallbackFlag,
    providerMs: poll.providerMs,
  }
}

export interface VeoPollResult {
  resultUrls: string[]
  /** Per-result seeds VEO used; index-aligned with resultUrls. */
  seeds?: number[]
  /** True iff KIE silently swapped to the deprecated fallback model. */
  fallbackFlag?: boolean
  /** Provider generation duration in ms (completeTime - createTime). */
  providerMs?: number
  /** Raw record-info payload, kept for credit-audit and debugging. */
  rawRecordInfo?: Record<string, unknown>
}

/**
 * Shared VEO record-info polling loop.
 * Polls GET /api/v1/veo/record-info?taskId= until successFlag=1 (success) or 2/3 (failure).
 * Returns resultUrls + raw response on success; throws on failure or timeout.
 */
async function pollVeoRecordInfo(
  taskId: string,
  label: string,
  apiKey: string,
): Promise<VeoPollResult> {
  let attempts = 0
  while (attempts < MAX_POLL_ATTEMPTS_VIDEO) {
    attempts++
    await sleep(pollDelay(attempts))

    let detailResponse: Response
    try {
      detailResponse = await fetch(
        `${KIE_API_BASE}/api/v1/veo/record-info?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        console.warn(`[KIE.ai ${label}] Poll attempt ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

    if (!detailResponse.ok) {
      console.warn(`[KIE.ai ${label}] Poll attempt ${attempts} HTTP ${detailResponse.status} for taskId=${taskId}`)
      continue
    }

    const detailText = await detailResponse.text()
    if (DEBUG) {
      console.log(`[KIE.ai ${label}] Poll attempt ${attempts} response: ${detailText.substring(0, 300)}`)
    }

    let detailData: VeoRecordInfoResponse
    try {
      detailData = JSON.parse(detailText) as VeoRecordInfoResponse
    } catch {
      console.warn(`[KIE.ai ${label}] Poll attempt ${attempts} invalid JSON for taskId=${taskId}`)
      continue
    }

    const successFlag = detailData.data?.successFlag
    if (DEBUG) {
      console.log(`[KIE.ai ${label}] Task ${taskId} successFlag: ${successFlag} (attempt ${attempts})`)
    }

    if (successFlag === 1) {
      const resultUrls = detailData.data.response?.resultUrls
      if (!resultUrls?.length) {
        throw createSanitizedError(`${label} succeeded but no resultUrls found`, "Video generation")
      }
      const seeds = detailData.data.response?.seeds
      const fallbackFlag = detailData.data.fallbackFlag
      const create = detailData.data.createTime
      const complete = detailData.data.completeTime
      const providerMs =
        create !== undefined && complete !== undefined
          ? Number(complete) - Number(create)
          : undefined
      if (fallbackFlag === true) {
        console.warn(
          `[KIE.ai ${label}] fallbackFlag=true for task ${taskId} — KIE silently used the backup model. Output forced to 720p / 16:9; cannot be upgraded via /get-1080p-video.`,
        )
      }
      if (DEBUG) {
        console.log(
          `[KIE.ai ${label}] Complete! URLs: ${resultUrls.join(", ")}${
            seeds?.length ? ` (seeds: ${seeds.join(",")})` : ""
          }${providerMs !== undefined ? ` (providerMs: ${providerMs})` : ""}`,
        )
      } else {
        console.log(`[KIE.ai ${label}] Complete! URLs: ${resultUrls.join(", ")}`)
      }
      return {
        resultUrls,
        seeds,
        fallbackFlag,
        providerMs,
        rawRecordInfo: detailData as unknown as Record<string, unknown>,
      }
    }

    if (successFlag === 2 || successFlag === 3) {
      const errorMsg = detailData.data.errorMessage ?? `Error code: ${detailData.data.errorCode ?? "unknown"}`
      throw createSanitizedError(`${label} failed: ${errorMsg}`, "Video generation")
    }
  }

  throw createSanitizedError(`${label} timed out after ${MAX_POLL_ATTEMPTS_VIDEO} poll attempts`, "Video generation")
}

/**
 * VEO 3.1 Extend — continue a VEO video with a new prompt.
 * API: POST /api/v1/veo/extend
 * Polls: GET /api/v1/veo/record-info (same as runVeoTask)
 */
export async function runVeoExtendTask(
  taskId: string,
  prompt: string,
  model?: "fast" | "quality",
  seeds?: number
): Promise<{
  resultJson: KieResultJson
  taskId: string
  seed?: number
  fallbackFlag?: boolean
  providerMs?: number
}> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError("KIE_API_KEY is not configured", "Video extend")
  }

  const requestBody: Record<string, unknown> = {
    taskId,
    prompt,
    model: model ?? "fast",
  }
  if (seeds !== undefined) requestBody.seeds = seeds

  if (DEBUG) {
    console.log(`[KIE.ai VEO Extend] Request body:`, JSON.stringify(requestBody, null, 2))
  }

  const createResponse = await fetch(
    `${KIE_API_BASE}/api/v1/veo/extend`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await createResponse.text()
  if (!createResponse.ok) {
    throw createSanitizedError(
      `VEO extend failed: ${createResponse.status} - ${responseText}`,
      "Video extend"
    )
  }

  let createData: { code?: number; msg?: string; data?: { taskId?: string } }
  try {
    createData = JSON.parse(responseText)
  } catch {
    throw createSanitizedError(`VEO extend response is not valid JSON: ${responseText}`, "Video extend")
  }

  if (createData.code !== 200 && createData.code !== 0 && createData.code !== undefined) {
    throw createSanitizedError(
      `VEO extend error (code ${createData.code}): ${createData.msg ?? JSON.stringify(createData)}`,
      "Video extend"
    )
  }

  const extendTaskId = createData.data?.taskId
  if (!extendTaskId) {
    throw createSanitizedError(`VEO extend response missing taskId: ${JSON.stringify(createData)}`, "Video extend")
  }

  console.log(`[KIE.ai VEO Extend] Task created: ${extendTaskId}`)

  const poll = await pollVeoRecordInfo(extendTaskId, "VEO Extend", apiKey)
  return {
    resultJson: { resultUrls: poll.resultUrls },
    taskId: extendTaskId,
    seed: poll.seeds?.[0],
    fallbackFlag: poll.fallbackFlag,
    providerMs: poll.providerMs,
  }
}

/**
 * VEO 3.1 1080p — get 1080p version of a completed VEO video.
 * API: GET /api/v1/veo/get-1080p-video?taskId=&index=0
 * Quasi-synchronous: may need retries while processing (~1-3 min).
 */
export async function runVeo1080pTask(
  taskId: string,
  index: number = 0
): Promise<{ url: string }> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError("KIE_API_KEY is not configured", "Video upscale")
  }

  console.log(`[KIE.ai VEO 1080p] Requesting 1080p for task ${taskId}, index ${index}`)

  // Retry loop — 1080p takes 1-3 min to process
  let attempts = 0
  while (attempts < MAX_POLL_ATTEMPTS_VIDEO) {
    attempts++
    if (attempts > 1) await sleep(pollDelay(attempts))

    let response: Response
    try {
      response = await fetch(
        `${KIE_API_BASE}/api/v1/veo/get-1080p-video?taskId=${taskId}&index=${index}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") continue
      throw err
    }

    let data: { code?: number; msg?: string; data?: { resultUrl?: string } }
    try {
      data = JSON.parse(await response.text())
    } catch { continue }

    if (data.code === 200 && data.data?.resultUrl) {
      console.log(`[KIE.ai VEO 1080p] Complete! URL: ${data.data.resultUrl}`)
      return { url: data.data.resultUrl }
    }

    // Non-200 means still processing — keep polling
    if (DEBUG) {
      console.log(`[KIE.ai VEO 1080p] Not ready yet (code: ${data.code}), attempt ${attempts}`)
    }
  }

  throw createSanitizedError(`VEO 1080p timed out after ${MAX_POLL_ATTEMPTS_VIDEO} attempts`, "Video upscale")
}

/**
 * VEO 3.1 4K — upscale a VEO video to 4K resolution.
 * API: POST /api/v1/veo/get-4k-video
 * Async: polls record-info for completion (~5-10 min).
 */
export async function runVeo4kTask(
  taskId: string,
  index: number = 0
): Promise<{ resultJson: KieResultJson; taskId: string }> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError("KIE_API_KEY is not configured", "Video upscale")
  }

  const requestBody = { taskId, index }

  if (DEBUG) {
    console.log(`[KIE.ai VEO 4K] Request body:`, JSON.stringify(requestBody, null, 2))
  }

  const createResponse = await fetch(
    `${KIE_API_BASE}/api/v1/veo/get-4k-video`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await createResponse.text()
  if (!createResponse.ok) {
    throw createSanitizedError(
      `VEO 4K failed: ${createResponse.status} - ${responseText}`,
      "Video upscale"
    )
  }

  let createData: { code?: number; msg?: string; data?: { taskId?: string; resultUrls?: string[] } }
  try {
    createData = JSON.parse(responseText)
  } catch {
    throw createSanitizedError(`VEO 4K response is not valid JSON: ${responseText}`, "Video upscale")
  }

  // If already available (code 200 with resultUrls)
  if (createData.code === 200 && createData.data?.resultUrls?.length) {
    console.log(`[KIE.ai VEO 4K] Immediately available: ${createData.data.resultUrls.join(", ")}`)
    return { resultJson: { resultUrls: createData.data.resultUrls }, taskId: createData.data.taskId ?? taskId }
  }

  // Otherwise poll (code 422 = still processing)
  const fourKTaskId = createData.data?.taskId ?? taskId
  console.log(`[KIE.ai VEO 4K] Task processing: ${fourKTaskId}`)

  const { resultUrls } = await pollVeoRecordInfo(fourKTaskId, "VEO 4K", apiKey)
  return { resultJson: { resultUrls }, taskId: fourKTaskId }
}
