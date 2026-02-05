/**
 * KIE.ai API Client
 *
 * API docs: https://docs.kie.ai/
 * Base URL: https://api.kie.ai
 * Auth: Bearer token (KIE_API_KEY)
 *
 * Async task model:
 * 1. Submit task: POST /api/v1/jobs/createTask
 * 2. Get result: GET /api/v1/jobs/recordInfo?taskId=xxx
 *
 * Cost: KIE.ai API doesn't return credits consumed, so we use
 * estimated costs based on their pricing page and model-mapping.ts
 */

import { config } from "../lib/config.js"
import {
  getKieModelConfig,
  KIE_IMAGE_MODELS,
  KIE_VIDEO_MODELS,
  KIE_VIDEO_TO_VIDEO_MODELS,
  KIE_TEXT_TO_VIDEO_MODELS,
  KIE_MOTION_TRANSFER_MODELS,
  KIE_VIDEO_UPSCALE_MODELS,
  KIE_LIP_SYNC_MODELS,
  KIE_MUSIC_MODELS,
  KIE_TTS_MODELS,
  durationToNFrames,
  type KieModelConfig,
} from "./model-mapping.js"

const KIE_API_BASE = "https://api.kie.ai"
const POLL_INTERVAL_MS = 2000  // Poll every 2 seconds
const MAX_POLL_ATTEMPTS = 150  // Max 5 minutes (150 * 2s)
const MAX_POLL_ATTEMPTS_VIDEO = 300  // Max 10 minutes for video (300 * 2s)

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

  constructor(sanitizedMessage: string, internalDetails: string, context: string) {
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
function createSanitizedError(
  internalMessage: string,
  context: string,
): KieError {
  // Log the full internal error for debugging (visible in Railway logs)
  console.error(`[KIE.ai INTERNAL ERROR] ${context}: ${internalMessage}`)

  // Parse specific error patterns and return user-friendly messages
  const lowerMsg = internalMessage.toLowerCase()

  let sanitizedMessage: string

  if (lowerMsg.includes("aspect_ratio") || lowerMsg.includes("aspect ratio")) {
    sanitizedMessage = "Invalid aspect ratio setting. Please try a different option."
  } else if (lowerMsg.includes("timed out") || lowerMsg.includes("timeout")) {
    sanitizedMessage = "Generation timed out. Please try again."
  } else if (lowerMsg.includes("not configured") || lowerMsg.includes("api_key")) {
    sanitizedMessage = "Service is not properly configured. Please contact support."
  } else if (lowerMsg.includes("rate limit") || lowerMsg.includes("quota") || lowerMsg.includes("429")) {
    sanitizedMessage = "Service is temporarily busy. Please try again in a moment."
  } else if (lowerMsg.includes("invalid") || lowerMsg.includes("validation")) {
    sanitizedMessage = "Invalid input parameters. Please check your settings and try again."
  } else if (lowerMsg.includes("not support")) {
    sanitizedMessage = "This operation is not supported with the current provider."
  } else {
    // Generic fallback - hide all provider-specific details
    sanitizedMessage = `${context} failed. Please try again or contact support if the issue persists.`
  }

  return new KieError(sanitizedMessage, internalMessage, context)
}

// =============================================================================
// TYPES
// =============================================================================

interface KieTaskResponse {
  code: number
  message: string
  data: {
    taskId: string
    status?: string
  }
}

interface KieRecordInfoResponse {
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
    resultJson?: string  // JSON string: {"resultUrls": ["url1", "url2"]}
    failCode?: string
    failMsg?: string
    costTime?: number
    completeTime?: string
    createTime?: string
    progress?: number  // 0-100, available for sora2 models
  }
}

interface KieResultJson {
  resultUrls?: string[]
  audioUrl?: string  // For TTS/music
  videoUrl?: string  // For video
}

export interface KieResult {
  url: string
  cost: number  // Estimated cost based on model-mapping.ts
}

// =============================================================================
// CORE API FUNCTIONS
// =============================================================================

/** Progress callback type for real-time progress updates */
export type ProgressCallback = (progress: number) => Promise<void>

/**
 * Submit a task to KIE.ai and poll for completion
 * @param onProgress - Optional callback called when progress updates (0-100)
 */
async function runKieTask(
  model: string,
  input: Record<string, unknown>,
  maxAttempts: number = MAX_POLL_ATTEMPTS,
  onProgress?: ProgressCallback,
): Promise<{ resultJson: KieResultJson; costTime?: number }> {
  const apiKey = config.KIE_API_KEY

  if (!apiKey) {
    throw createSanitizedError("KIE_API_KEY is not configured", "Image generation")
  }

  const requestBody = { model, input }

  console.log(`[KIE.ai] >>>>>> SENDING TO KIE.AI API <<<<<<`)
  console.log(`[KIE.ai] Endpoint: ${KIE_API_BASE}/api/v1/jobs/createTask`)
  console.log(`[KIE.ai] Model: ${model}`)
  console.log(`[KIE.ai] FULL REQUEST BODY:`)
  console.log(JSON.stringify(requestBody, null, 2))
  console.log(`[KIE.ai] >>>>>> END REQUEST BODY <<<<<<`)

  // Step 1: Create task
  const createResponse = await fetch(`${KIE_API_BASE}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  })

  const responseText = await createResponse.text()
  console.log(`[KIE.ai] Response status: ${createResponse.status}`)
  console.log(`[KIE.ai] Response body (first 500 chars): ${responseText.substring(0, 500)}`)

  if (!createResponse.ok) {
    console.error(`[KIE.ai] createTask HTTP error - Status: ${createResponse.status}, Body: ${responseText}`)
    throw createSanitizedError(`createTask failed: ${createResponse.status} - ${responseText}`, "Generation")
  }

  let createData: KieTaskResponse
  try {
    createData = JSON.parse(responseText) as KieTaskResponse
  } catch {
    throw createSanitizedError(`response is not valid JSON: ${responseText}`, "Generation")
  }

  if (createData.code !== 0 && createData.code !== 200 && createData.code !== undefined) {
    console.error(`[KIE.ai] createTask API error - Code: ${createData.code}, Message: ${createData.message}, Full: ${JSON.stringify(createData)}`)
    throw createSanitizedError(`createTask error (code ${createData.code}): ${createData.message ?? JSON.stringify(createData)}`, "Generation")
  }

  if (!createData.data?.taskId) {
    throw createSanitizedError(`createTask response missing taskId: ${JSON.stringify(createData)}`, "Generation")
  }

  const taskId = createData.data.taskId
  console.log(`[KIE.ai] Task created: ${taskId}`)

  // Step 2: Poll for completion
  let attempts = 0
  while (attempts < maxAttempts) {
    await sleep(POLL_INTERVAL_MS)
    attempts++

    const detailResponse = await fetch(
      `${KIE_API_BASE}/api/v1/jobs/recordInfo?taskId=${taskId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    )

    if (!detailResponse.ok) {
      console.warn(`[KIE.ai] Poll attempt ${attempts} failed: ${detailResponse.status}`)
      continue
    }

    const detailText = await detailResponse.text()
    let detailData: KieRecordInfoResponse
    try {
      detailData = JSON.parse(detailText) as KieRecordInfoResponse
    } catch {
      console.warn(`[KIE.ai] Poll attempt ${attempts} invalid JSON`)
      continue
    }

    const state = detailData.data?.state
    if (!state) {
      console.warn(`[KIE.ai] Poll attempt ${attempts} missing state`)
      continue
    }

    // Log progress for sora2 models (0-100) and call callback if provided
    const progress = detailData.data.progress
    console.log(`[KIE.ai] Task ${taskId} state: ${state}${progress !== undefined ? ` (progress: ${progress}%)` : ""} (attempt ${attempts})`)

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
        throw createSanitizedError("task succeeded but no resultJson found", "Generation")
      }

      let resultJson: KieResultJson
      try {
        resultJson = JSON.parse(resultJsonStr) as KieResultJson
      } catch {
        throw createSanitizedError(`resultJson is not valid JSON: ${resultJsonStr}`, "Generation")
      }

      return { resultJson, costTime: detailData.data.costTime }
    }

    // NOTE: KIE.ai API returns "fail" not "failed"!
    if (state === "fail") {
      const failMsg = detailData.data.failMsg ?? "Unknown error"
      const failCode = detailData.data.failCode ?? "no_code"
      console.error(`[KIE.ai] Task ${taskId} FAILED:`)
      console.error(`  failCode: ${failCode}`)
      console.error(`  failMsg: ${failMsg}`)
      console.error(`  Full response: ${JSON.stringify(detailData, null, 2)}`)
      throw createSanitizedError(`task failed: [${failCode}] ${failMsg}`, "Generation")
    }

    // States "waiting", "queuing", "generating" are all in-progress - continue polling
  }

  throw createSanitizedError(`task timed out after ${maxAttempts * POLL_INTERVAL_MS / 1000} seconds`, "Generation")
}

// =============================================================================
// IMAGE GENERATION
// =============================================================================

export async function generateImageKie(
  prompt: string,
  referenceImageUrls?: string[],
  provider: string = "nano-banana",
): Promise<KieResult> {
  const modelConfig = KIE_IMAGE_MODELS[provider]
  if (!modelConfig) {
    throw createSanitizedError(`does not support image provider: ${provider}`, "Image generation")
  }

  console.log(`[KIE.ai] Generating image with ${modelConfig.model}: "${prompt}"`)
  if (referenceImageUrls?.length) {
    console.log(`[KIE.ai] Reference images: ${referenceImageUrls.join(", ")}`)
  }

  // Build input with model-specific parameters
  const input: Record<string, unknown> = {
    prompt,
    output_format: "png",
    // Apply model-specific extra params (aspect_ratio, image_size, resolution, etc.)
    ...modelConfig.extraParams,
  }

  // Add reference images based on input type
  if (referenceImageUrls?.length) {
    if (modelConfig.inputType === "image-to-image") {
      // Image-to-image models - check for custom image parameter name
      const imageParamName = modelConfig.imageParam ?? "image"

      if (imageParamName === "input_urls" || imageParamName === "image_urls") {
        // GPT Image uses input_urls as an array, Grok uses image_urls as an array
        input[imageParamName] = referenceImageUrls
      } else {
        // Default: use "image" param for the source image (single URL)
        input[imageParamName] = referenceImageUrls[0]
        // Some models may support multiple images
        if (referenceImageUrls.length > 1) {
          input.image_input = referenceImageUrls.slice(1)
        }
      }
    } else {
      // Text-to-image models use "image_input" for reference images
      input.image_input = referenceImageUrls
    }
  }

  console.log(`[KIE.ai] Request input:`, JSON.stringify(input, null, 2))

  const { resultJson } = await runKieTask(modelConfig.model, input)

  const imageUrl = resultJson.resultUrls?.[0]
  if (!imageUrl) {
    throw createSanitizedError("image task succeeded but no URL in resultUrls", "Image generation")
  }

  console.log(`[KIE.ai] Image completed: ${imageUrl} (cost: $${modelConfig.cost.toFixed(4)})`)

  return { url: imageUrl, cost: modelConfig.cost }
}

// =============================================================================
// IMAGE EDITING (Edit Image)
// =============================================================================

export async function editImageKie(
  imageUrl: string,
  prompt?: string,
  provider: string = "recraft-upscale",
): Promise<KieResult> {
  const modelConfig = KIE_IMAGE_MODELS[provider]
  if (!modelConfig) {
    throw createSanitizedError(`does not support edit image provider: ${provider}`, "Image editing")
  }

  console.log(`[KIE.ai] Editing image with ${modelConfig.model}`)
  console.log(`[KIE.ai] Image: ${imageUrl}, Prompt: "${prompt ?? ""}"`)

  const input: Record<string, unknown> = {
    output_format: "png",
    // Apply model-specific extra params
    ...modelConfig.extraParams,
  }

  // Set the image parameter based on model config
  const imageParamName = modelConfig.imageParam ?? "image"
  if (imageParamName === "image_urls" || imageParamName === "input_urls") {
    // Array-based image parameter
    input[imageParamName] = [imageUrl]
  } else {
    // Single URL parameter
    input[imageParamName] = imageUrl
  }

  // Add prompt only for nano-banana-edit (general editing with instructions)
  if (provider === "nano-banana-edit" && prompt) {
    input.prompt = prompt
  }

  console.log(`[KIE.ai] Edit request input:`, JSON.stringify(input, null, 2))

  const { resultJson } = await runKieTask(modelConfig.model, input)

  const outputUrl = resultJson.resultUrls?.[0]
  if (!outputUrl) {
    throw createSanitizedError("edit image task succeeded but no URL in resultUrls", "Image editing")
  }

  console.log(`[KIE.ai] Edit image completed: ${outputUrl} (cost: $${modelConfig.cost.toFixed(4)})`)

  return { url: outputUrl, cost: modelConfig.cost }
}

// =============================================================================
// VIDEO GENERATION (Image-to-Video)
// =============================================================================

/**
 * VEO3 response types - VEO uses a different response format from standard KIE tasks
 */
interface VeoRecordInfoResponse {
  code: number
  msg: string
  data: {
    taskId: string
    paramJson?: string
    createTime?: string
    completeTime?: string
    successFlag: number  // 0=generating, 1=success, 2=failed, 3=generation failed
    fallbackFlag?: boolean
    errorCode?: number
    errorMessage?: string
    response?: {
      taskId: string
      resultUrls: string[]
      originUrls?: string[]
      resolution?: string
    }
  }
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
async function runVeoTask(
  model: string,
  prompt: string,
  imageUrls?: string[],
): Promise<{ resultJson: KieResultJson; costTime?: number }> {
  const apiKey = config.KIE_API_KEY

  if (!apiKey) {
    throw createSanitizedError("KIE_API_KEY is not configured", "Video generation")
  }

  const requestBody: Record<string, unknown> = {
    model,  // "veo3" or "veo3_fast"
    prompt,
  }

  // Add image URLs for image-to-video mode
  if (imageUrls?.length) {
    requestBody.imageUrls = imageUrls
    requestBody.generationType = "FIRST_AND_LAST_FRAMES_2_VIDEO"
  } else {
    requestBody.generationType = "TEXT_2_VIDEO"
  }

  console.log(`[KIE.ai VEO] Creating VEO task with model: ${model}`)
  console.log(`[KIE.ai VEO] Request body:`, JSON.stringify(requestBody, null, 2))

  // Step 1: Create VEO task using special endpoint
  const createResponse = await fetch(`${KIE_API_BASE}/api/v1/veo/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  })

  const responseText = await createResponse.text()
  console.log(`[KIE.ai VEO] Response status: ${createResponse.status}`)
  console.log(`[KIE.ai VEO] Response body: ${responseText.substring(0, 500)}`)

  if (!createResponse.ok) {
    throw createSanitizedError(`VEO generate failed: ${createResponse.status} - ${responseText}`, "Video generation")
  }

  let createData: KieTaskResponse
  try {
    createData = JSON.parse(responseText) as KieTaskResponse
  } catch {
    throw createSanitizedError(`VEO response is not valid JSON: ${responseText}`, "Video generation")
  }

  if (createData.code !== 0 && createData.code !== 200 && createData.code !== undefined) {
    throw createSanitizedError(`VEO generate error (code ${createData.code}): ${createData.message ?? JSON.stringify(createData)}`, "Video generation")
  }

  if (!createData.data?.taskId) {
    throw createSanitizedError(`VEO generate response missing taskId: ${JSON.stringify(createData)}`, "Video generation")
  }

  const taskId = createData.data.taskId
  console.log(`[KIE.ai VEO] Task created: ${taskId}`)

  // Step 2: Poll for completion using VEO-specific endpoint (NOT the standard recordInfo!)
  // VEO endpoint: /api/v1/veo/record-info (with hyphen)
  // Status field: successFlag (0=generating, 1=success, 2=failed, 3=generation failed)
  let attempts = 0
  while (attempts < MAX_POLL_ATTEMPTS_VIDEO) {
    await sleep(POLL_INTERVAL_MS)
    attempts++

    const detailResponse = await fetch(
      `${KIE_API_BASE}/api/v1/veo/record-info?taskId=${taskId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    )

    if (!detailResponse.ok) {
      console.warn(`[KIE.ai VEO] Poll attempt ${attempts} failed: ${detailResponse.status}`)
      continue
    }

    const detailText = await detailResponse.text()
    console.log(`[KIE.ai VEO] Poll attempt ${attempts} response: ${detailText.substring(0, 300)}`)

    let detailData: VeoRecordInfoResponse
    try {
      detailData = JSON.parse(detailText) as VeoRecordInfoResponse
    } catch {
      console.warn(`[KIE.ai VEO] Poll attempt ${attempts} invalid JSON`)
      continue
    }

    const successFlag = detailData.data?.successFlag
    console.log(`[KIE.ai VEO] Task ${taskId} successFlag: ${successFlag} (attempt ${attempts})`)

    // successFlag: 0=generating, 1=success, 2=failed, 3=generation failed
    if (successFlag === 1) {
      // Success - get result URLs from data.response.resultUrls
      const resultUrls = detailData.data.response?.resultUrls
      if (!resultUrls?.length) {
        throw createSanitizedError("VEO task succeeded but no resultUrls found", "Video generation")
      }

      console.log(`[KIE.ai VEO] Video complete! URLs: ${resultUrls.join(", ")}`)

      return {
        resultJson: { resultUrls },
        costTime: undefined,
      }
    }

    if (successFlag === 2 || successFlag === 3) {
      // Failed
      const errorMsg = detailData.data.errorMessage ?? `Error code: ${detailData.data.errorCode ?? "unknown"}`
      throw createSanitizedError(`VEO task failed: ${errorMsg}`, "Video generation")
    }

    // successFlag === 0 means still generating, continue polling
  }

  throw createSanitizedError(`VEO task timed out after ${MAX_POLL_ATTEMPTS_VIDEO * POLL_INTERVAL_MS / 1000} seconds`, "Video generation")
}

export async function imageToVideoKie(
  imageUrl: string,
  prompt?: string,
  provider: string = "minimax",
  duration?: number,
  endFrameUrl?: string,
  onProgress?: ProgressCallback,
): Promise<KieResult> {
  const modelConfig = KIE_VIDEO_MODELS[provider]
  if (!modelConfig) {
    throw createSanitizedError(`does not support video provider: ${provider}`, "Video generation")
  }

  console.log(`[KIE.ai] ========== VIDEO GENERATION REQUEST ==========`)
  console.log(`[KIE.ai] Provider: ${provider}`)
  console.log(`[KIE.ai] Model: ${modelConfig.model}`)
  console.log(`[KIE.ai] Image URL: ${imageUrl}`)
  console.log(`[KIE.ai] Prompt: "${prompt ?? "(default: smooth cinematic motion)"}"`)
  console.log(`[KIE.ai] Duration requested: ${duration ?? "(default)"}`)
  console.log(`[KIE.ai] End frame URL: ${endFrameUrl ?? "(none)"}`)
  console.log(`[KIE.ai] Model config:`)
  console.log(`  - usesNFrames: ${modelConfig.usesNFrames ?? false}`)
  console.log(`  - allowedDurations: ${JSON.stringify(modelConfig.allowedDurations)}`)
  console.log(`  - extraParams: ${JSON.stringify(modelConfig.extraParams ?? {})}`)
  console.log(`  - imageParam: ${modelConfig.imageParam ?? "image"}`)
  console.log(`  - supportsEndFrame: ${modelConfig.supportsEndFrame ?? false}`)
  console.log(`[KIE.ai] ==============================================`)

  // VEO3 uses a special API endpoint
  if (provider === "veo3" || provider === "veo3.1") {
    const imageUrls = endFrameUrl ? [imageUrl, endFrameUrl] : [imageUrl]
    const { resultJson } = await runVeoTask(
      modelConfig.model,
      prompt ?? "smooth cinematic motion",
      imageUrls
    )

    const videoUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
    if (!videoUrl) {
      throw createSanitizedError("VEO video task succeeded but no URL found", "Video generation")
    }

    console.log(`[KIE.ai] VEO Video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`)
    return { url: videoUrl, cost: modelConfig.cost }
  }

  // Standard createTask endpoint for other providers
  const input: Record<string, unknown> = {
    ...(modelConfig.extraParams ?? {}),
    prompt: prompt ?? "smooth cinematic motion",
  }

  // Handle image parameter - different models use different param names
  const imageParamName = modelConfig.imageParam ?? "image"
  console.log(`[KIE.ai] Using image parameter: ${imageParamName}`)

  if (imageParamName === "image_urls") {
    // Array format for kling, grok, sora
    input[imageParamName] = [imageUrl]
  } else {
    // Single URL format for hailuo, kling-turbo
    input[imageParamName] = imageUrl
  }

  // Override duration if provided
  if (duration) {
    if (modelConfig.usesNFrames) {
      // Sora uses n_frames instead of duration
      // n_frames 10 = ~5 seconds, n_frames 15 = ~10 seconds
      input.n_frames = durationToNFrames(duration)
      console.log(`[KIE.ai] Converting duration ${duration}s to n_frames: ${input.n_frames}`)
    } else {
      input.duration = String(duration)  // KIE expects string for duration
    }
  }

  // Handle end frame for models that support it
  if (endFrameUrl) {
    if (provider === "kling-turbo") {
      input.tail_image_url = endFrameUrl
    } else if (provider === "minimax") {
      input.end_image_url = endFrameUrl  // Hailuo uses end_image_url
    } else {
      input.end_frame = endFrameUrl
    }
  }

  console.log(`[KIE.ai] Final input:`, JSON.stringify(input, null, 2))

  const { resultJson } = await runKieTask(modelConfig.model, input, MAX_POLL_ATTEMPTS_VIDEO, onProgress)

  const videoUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
  if (!videoUrl) {
    throw createSanitizedError("video task succeeded but no URL found", "Video generation")
  }

  console.log(`[KIE.ai] Video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`)

  return { url: videoUrl, cost: modelConfig.cost }
}

// =============================================================================
// TEXT-TO-VIDEO
// =============================================================================

export async function textToVideoKie(
  prompt: string,
  provider: string = "minimax",
  duration?: number,
  aspectRatio?: string,
): Promise<KieResult> {
  const modelConfig = KIE_TEXT_TO_VIDEO_MODELS[provider]
  if (!modelConfig) {
    throw createSanitizedError(`does not support text-to-video provider: ${provider}`, "Video generation")
  }

  console.log(`[KIE.ai] Generating text-to-video with provider: ${provider}, model: ${modelConfig.model}`)
  console.log(`[KIE.ai] Prompt: "${prompt}"`)
  console.log(`[KIE.ai] Duration: ${duration ?? "(default)"}, Aspect ratio: ${aspectRatio ?? "(default)"}`)

  // VEO3 uses a special API endpoint
  if (provider === "veo3") {
    const { resultJson } = await runVeoTask(modelConfig.model, prompt)

    const videoUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
    if (!videoUrl) {
      throw createSanitizedError("VEO text-to-video task succeeded but no URL found", "Video generation")
    }

    console.log(`[KIE.ai] VEO Text-to-video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`)
    return { url: videoUrl, cost: modelConfig.cost }
  }

  // Standard createTask endpoint for other providers
  const input: Record<string, unknown> = {
    ...(modelConfig.extraParams ?? {}),
    prompt,
  }

  // Override duration if provided
  if (duration) {
    if (modelConfig.usesNFrames) {
      // Sora uses n_frames instead of duration
      // n_frames 10 = ~5 seconds, n_frames 15 = ~10 seconds
      input.n_frames = durationToNFrames(duration)
      console.log(`[KIE.ai] Converting duration ${duration}s to n_frames: ${input.n_frames}`)
    } else {
      input.duration = String(duration)
    }
  }

  // Override aspect ratio if provided
  if (aspectRatio) {
    input.aspect_ratio = aspectRatio
  }

  console.log(`[KIE.ai] Final input:`, JSON.stringify(input, null, 2))

  const { resultJson } = await runKieTask(modelConfig.model, input, MAX_POLL_ATTEMPTS_VIDEO)

  const videoUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
  if (!videoUrl) {
    throw createSanitizedError("text-to-video task succeeded but no URL found", "Video generation")
  }

  console.log(`[KIE.ai] Text-to-video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`)

  return { url: videoUrl, cost: modelConfig.cost }
}

// =============================================================================
// VIDEO-TO-VIDEO (Wan 2.6 + Kling 2.6)
// These are the ONLY working V2V providers - Replicate models don't support V2V!
// =============================================================================

export async function videoToVideoKie(
  videoUrl: string,
  prompt?: string,
  provider: string = "wan",
  onProgress?: ProgressCallback,
): Promise<KieResult> {
  const modelConfig = KIE_VIDEO_TO_VIDEO_MODELS[provider]
  if (!modelConfig) {
    throw createSanitizedError(`does not support video-to-video provider: ${provider}`, "Video generation")
  }

  console.log(`[KIE.ai] ========== VIDEO-TO-VIDEO GENERATION REQUEST ==========`)
  console.log(`[KIE.ai] Provider: ${provider}`)
  console.log(`[KIE.ai] Model: ${modelConfig.model}`)
  console.log(`[KIE.ai] Video URL: ${videoUrl}`)
  console.log(`[KIE.ai] Prompt: "${prompt ?? "(default: continue this video smoothly)"}"`)
  console.log(`[KIE.ai] ==============================================`)

  const finalPrompt = prompt ?? "continue this video with smooth cinematic motion"

  // Standard createTask endpoint for all V2V providers (Wan 2.6, Kling 2.6)
  const input: Record<string, unknown> = {
    ...(modelConfig.extraParams ?? {}),
    prompt: finalPrompt,
    video_urls: [videoUrl],  // All V2V models use video_urls array
  }

  console.log(`[KIE.ai] Final input:`, JSON.stringify(input, null, 2))

  const { resultJson } = await runKieTask(modelConfig.model, input, MAX_POLL_ATTEMPTS_VIDEO, onProgress)

  const outputUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
  if (!outputUrl) {
    throw createSanitizedError("V2V task succeeded but no URL found", "Video generation")
  }

  console.log(`[KIE.ai] V2V completed: ${outputUrl} (cost: $${modelConfig.cost.toFixed(4)})`)

  return { url: outputUrl, cost: modelConfig.cost }
}

// =============================================================================
// MOTION TRANSFER (Image + Video → Motion-Applied Video)
// Uses character from image and applies motion from video
// Model: kling-2.6/motion-control
// =============================================================================

export async function motionTransferKie(
  imageUrl: string,
  videoUrl: string,
  prompt?: string,
  characterOrientation: "image" | "video" = "image",
  resolution: "720p" | "1080p" = "720p",
  onProgress?: ProgressCallback,
): Promise<KieResult> {
  const modelConfig = KIE_MOTION_TRANSFER_MODELS["kling"]
  if (!modelConfig) {
    throw createSanitizedError("Motion transfer model not configured", "Motion transfer")
  }

  console.log(`[KIE.ai] ========== MOTION TRANSFER REQUEST ==========`)
  console.log(`[KIE.ai] Model: ${modelConfig.model}`)
  console.log(`[KIE.ai] Image URL (character source): ${imageUrl}`)
  console.log(`[KIE.ai] Video URL (motion source): ${videoUrl}`)
  console.log(`[KIE.ai] Prompt: "${prompt ?? "(none)"}"`)
  console.log(`[KIE.ai] Character orientation: ${characterOrientation}`)
  console.log(`[KIE.ai] Mode: ${resolution}`)
  console.log(`[KIE.ai] Max duration: ${characterOrientation === "image" ? "10s" : "30s"}`)
  console.log(`[KIE.ai] ==============================================`)

  // Build input based on KIE.ai docs for kling-2.6/motion-control
  // NOTE: Field is "mode" not "resolution" per KIE.ai API docs
  const input: Record<string, unknown> = {
    input_urls: [imageUrl],  // Array of image URLs (character reference)
    video_urls: [videoUrl],  // Array of video URLs (motion source)
    character_orientation: characterOrientation,
    mode: resolution,  // KIE.ai uses "mode" for resolution (720p/1080p)
  }

  // Add optional prompt if provided
  if (prompt) {
    input.prompt = prompt
  }

  console.log(`[KIE.ai] Motion Transfer Request:`, JSON.stringify(input, null, 2))

  const { resultJson } = await runKieTask(modelConfig.model, input, MAX_POLL_ATTEMPTS_VIDEO, onProgress)

  const outputUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
  if (!outputUrl) {
    throw createSanitizedError("Motion transfer task succeeded but no URL found", "Motion transfer")
  }

  console.log(`[KIE.ai] Motion transfer completed: ${outputUrl} (cost: $${modelConfig.cost.toFixed(4)})`)

  return { url: outputUrl, cost: modelConfig.cost }
}

// =============================================================================
// VIDEO UPSCALE (Video → Upscaled Video)
// Model: topaz/video-upscale
// NOTE: video_url is STRING (NOT array!), max 50MB input
// =============================================================================

export async function videoUpscaleKie(
  videoUrl: string,
  upscaleFactor: "1" | "2" | "4" = "2",
  onProgress?: ProgressCallback,
): Promise<KieResult> {
  const modelConfig = KIE_VIDEO_UPSCALE_MODELS["topaz"]
  if (!modelConfig) {
    throw createSanitizedError("Video upscale model not configured", "Video upscale")
  }

  console.log(`[KIE.ai] ========== VIDEO UPSCALE REQUEST ==========`)
  console.log(`[KIE.ai] Model: ${modelConfig.model}`)
  console.log(`[KIE.ai] Video URL: ${videoUrl}`)
  console.log(`[KIE.ai] Upscale factor: ${upscaleFactor}x`)
  console.log(`[KIE.ai] NOTE: Max input size 50MB`)
  console.log(`[KIE.ai] ==============================================`)

  // Build input based on KIE.ai docs for topaz/video-upscale
  // IMPORTANT: video_url is STRING, not array!
  const input: Record<string, unknown> = {
    video_url: videoUrl,  // Single URL string (NOT array!)
    upscale_factor: upscaleFactor,
  }

  console.log(`[KIE.ai] Final input:`, JSON.stringify(input, null, 2))

  const { resultJson } = await runKieTask(modelConfig.model, input, MAX_POLL_ATTEMPTS_VIDEO, onProgress)

  const outputUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
  if (!outputUrl) {
    throw createSanitizedError("Video upscale task succeeded but no URL found", "Video upscale")
  }

  console.log(`[KIE.ai] Video upscale completed: ${outputUrl} (cost: $${modelConfig.cost.toFixed(4)})`)

  return { url: outputUrl, cost: modelConfig.cost }
}

// =============================================================================
// LIP SYNC / AI AVATAR (Image + Audio → Talking Video)
// =============================================================================

export async function lipSyncKie(
  imageUrl: string,
  audioUrl: string,
  prompt?: string,
  provider: string = "kling-avatar",
  resolution?: string,
): Promise<KieResult> {
  const modelConfig = KIE_LIP_SYNC_MODELS[provider]
  if (!modelConfig) {
    throw createSanitizedError(`does not support lip-sync provider: ${provider}`, "Lip sync generation")
  }

  console.log(`[KIE.ai] Generating lip sync video with ${modelConfig.model}`)
  console.log(`[KIE.ai] Image: ${imageUrl}, Audio: ${audioUrl}`)

  // Start with extra params from config
  const input: Record<string, unknown> = {
    ...(modelConfig.extraParams ?? {}),
    image_url: imageUrl,
    audio_url: audioUrl,
  }

  // Add optional prompt (for infinitalk especially)
  if (prompt) {
    input.prompt = prompt
  }

  // Override resolution if provided (for infinitalk: 480p or 720p)
  if (resolution) {
    input.resolution = resolution
  }

  const { resultJson } = await runKieTask(modelConfig.model, input, MAX_POLL_ATTEMPTS_VIDEO)

  const videoUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
  if (!videoUrl) {
    throw createSanitizedError("lip sync task succeeded but no URL found", "Lip sync generation")
  }

  console.log(`[KIE.ai] Lip sync completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`)

  return { url: videoUrl, cost: modelConfig.cost }
}

// =============================================================================
// MUSIC GENERATION
// =============================================================================

export async function generateMusicKie(
  prompt: string,
  provider: string = "suno",
  duration?: number,
  lyrics?: string,
): Promise<KieResult> {
  const modelConfig = KIE_MUSIC_MODELS[provider]
  if (!modelConfig) {
    throw createSanitizedError(`does not support music provider: ${provider}`, "Music generation")
  }

  console.log(`[KIE.ai] Generating music with ${modelConfig.model}: "${prompt}"`)

  const input: Record<string, unknown> = { prompt }

  if (duration) {
    input.duration = duration
  }

  if (lyrics) {
    input.lyrics = lyrics
  }

  const { resultJson } = await runKieTask(modelConfig.model, input, MAX_POLL_ATTEMPTS_VIDEO)

  const audioUrl = resultJson.resultUrls?.[0] ?? resultJson.audioUrl
  if (!audioUrl) {
    throw createSanitizedError("music task succeeded but no URL found", "Music generation")
  }

  console.log(`[KIE.ai] Music completed: ${audioUrl} (cost: $${modelConfig.cost.toFixed(4)})`)

  return { url: audioUrl, cost: modelConfig.cost }
}

// =============================================================================
// TEXT-TO-SPEECH
// =============================================================================

export async function textToSpeechKie(
  text: string,
  voice?: string,
  provider: string = "elevenlabs",
): Promise<KieResult> {
  const modelConfig = KIE_TTS_MODELS[provider]
  if (!modelConfig) {
    throw createSanitizedError(`does not support TTS provider: ${provider}`, "Speech generation")
  }

  console.log(`[KIE.ai] Generating TTS with ${modelConfig.model}, voice: ${voice ?? "default"}`)

  const input: Record<string, unknown> = {
    text,
    voice: voice ?? "Rachel",
  }

  const { resultJson } = await runKieTask(modelConfig.model, input)

  const audioUrl = resultJson.resultUrls?.[0] ?? resultJson.audioUrl
  if (!audioUrl) {
    throw createSanitizedError("TTS task succeeded but no URL found", "Speech generation")
  }

  console.log(`[KIE.ai] TTS completed: ${audioUrl} (cost: $${modelConfig.cost.toFixed(4)})`)

  return { url: audioUrl, cost: modelConfig.cost }
}

// =============================================================================
// HELPERS
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
