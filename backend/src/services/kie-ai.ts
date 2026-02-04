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

  console.log(`[KIE.ai] Generating video with ${modelConfig.model}`)
  console.log(`[KIE.ai] Image: ${imageUrl}, Prompt: "${prompt ?? ""}"`)

  const input: Record<string, unknown> = {
    image: imageUrl,
    prompt: prompt ?? "smooth cinematic motion",
  }

  if (duration) {
    input.duration = duration
  }

  if (endFrameUrl) {
    input.end_frame = endFrameUrl
  }

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
): Promise<KieResult> {
  const modelConfig = KIE_TEXT_TO_VIDEO_MODELS[provider]
  if (!modelConfig) {
    throw createSanitizedError(`does not support text-to-video provider: ${provider}`, "Video generation")
  }

  console.log(`[KIE.ai] Generating text-to-video with ${modelConfig.model}: "${prompt}"`)

  const input: Record<string, unknown> = { prompt }

  if (duration) {
    input.duration = duration
  }

  const { resultJson } = await runKieTask(modelConfig.model, input, MAX_POLL_ATTEMPTS_VIDEO)

  const videoUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
  if (!videoUrl) {
    throw createSanitizedError("text-to-video task succeeded but no URL found", "Video generation")
  }

  console.log(`[KIE.ai] Text-to-video completed: ${videoUrl} (cost: $${modelConfig.cost.toFixed(4)})`)

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
