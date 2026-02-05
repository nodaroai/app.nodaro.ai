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
  KIE_TEXT_TO_VIDEO_MODELS,
  KIE_LIP_SYNC_MODELS,
  KIE_MUSIC_MODELS,
  KIE_TTS_MODELS,
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
 * Create a sanitized error for user display while logging full details.
 * In cloud edition, we don't want to expose "KIE.ai" provider name to customers.
 */
function createSanitizedError(
  internalMessage: string,
  context: string,
): Error {
  // Log the full internal error for debugging (visible in Railway logs)
  console.error(`[KIE.ai INTERNAL ERROR] ${context}: ${internalMessage}`)

  // Parse specific error patterns and return user-friendly messages
  const lowerMsg = internalMessage.toLowerCase()

  if (lowerMsg.includes("aspect_ratio") || lowerMsg.includes("aspect ratio")) {
    return new Error("Invalid aspect ratio setting. Please try a different option.")
  }
  if (lowerMsg.includes("timed out") || lowerMsg.includes("timeout")) {
    return new Error("Generation timed out. Please try again.")
  }
  if (lowerMsg.includes("not configured") || lowerMsg.includes("api_key")) {
    return new Error("Service is not properly configured. Please contact support.")
  }
  if (lowerMsg.includes("rate limit") || lowerMsg.includes("quota") || lowerMsg.includes("429")) {
    return new Error("Service is temporarily busy. Please try again in a moment.")
  }
  if (lowerMsg.includes("invalid") || lowerMsg.includes("validation")) {
    return new Error("Invalid input parameters. Please check your settings and try again.")
  }
  if (lowerMsg.includes("not support")) {
    return new Error("This operation is not supported with the current provider.")
  }

  // Generic fallback - hide all provider-specific details
  return new Error(`${context} failed. Please try again or contact support if the issue persists.`)
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
    state: "pending" | "processing" | "success" | "failed"
    resultJson?: string  // JSON string: {"resultUrls": ["url1", "url2"]}
    failCode?: string
    failMsg?: string
    costTime?: number
    completeTime?: string
    createTime?: string
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

/**
 * Submit a task to KIE.ai and poll for completion
 */
async function runKieTask(
  model: string,
  input: Record<string, unknown>,
  maxAttempts: number = MAX_POLL_ATTEMPTS,
): Promise<{ resultJson: KieResultJson; costTime?: number }> {
  const apiKey = config.KIE_API_KEY

  if (!apiKey) {
    throw createSanitizedError("KIE_API_KEY is not configured", "Image generation")
  }

  const requestBody = { model, input }

  console.log(`[KIE.ai] Creating task for model: ${model}`)
  console.log(`[KIE.ai] Request body:`, JSON.stringify(requestBody, null, 2))

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

  if (!createResponse.ok) {
    throw createSanitizedError(`createTask failed: ${createResponse.status} - ${responseText}`, "Generation")
  }

  let createData: KieTaskResponse
  try {
    createData = JSON.parse(responseText) as KieTaskResponse
  } catch {
    throw createSanitizedError(`response is not valid JSON: ${responseText}`, "Generation")
  }

  if (createData.code !== 0 && createData.code !== 200 && createData.code !== undefined) {
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

    console.log(`[KIE.ai] Task ${taskId} state: ${state} (attempt ${attempts})`)

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

    if (state === "failed") {
      const failMsg = detailData.data.failMsg ?? detailData.data.failCode ?? "Unknown error"
      throw createSanitizedError(`task failed: ${failMsg}`, "Generation")
    }
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
): Promise<KieResult> {
  const modelConfig = KIE_VIDEO_MODELS[provider]
  if (!modelConfig) {
    throw createSanitizedError(`does not support video provider: ${provider}`, "Video generation")
  }

  console.log(`[KIE.ai] Generating video with provider: ${provider}, model: ${modelConfig.model}`)
  console.log(`[KIE.ai] Image: ${imageUrl}`)
  console.log(`[KIE.ai] Prompt: "${prompt ?? "(default)"}"`)
  console.log(`[KIE.ai] Duration: ${duration ?? "(default)"}, End frame: ${endFrameUrl ?? "(none)"}`)

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
    input.duration = String(duration)  // KIE expects string for duration
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

  const { resultJson } = await runKieTask(modelConfig.model, input, MAX_POLL_ATTEMPTS_VIDEO)

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
    input.duration = String(duration)
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
