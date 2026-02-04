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
    throw new Error("KIE_API_KEY is not configured")
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
    throw new Error(`KIE.ai createTask failed: ${createResponse.status} - ${responseText}`)
  }

  let createData: KieTaskResponse
  try {
    createData = JSON.parse(responseText) as KieTaskResponse
  } catch {
    throw new Error(`KIE.ai response is not valid JSON: ${responseText}`)
  }

  if (createData.code !== 0 && createData.code !== 200 && createData.code !== undefined) {
    throw new Error(`KIE.ai createTask error (code ${createData.code}): ${createData.message ?? JSON.stringify(createData)}`)
  }

  if (!createData.data?.taskId) {
    throw new Error(`KIE.ai createTask response missing taskId: ${JSON.stringify(createData)}`)
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
        throw new Error(`KIE.ai task succeeded but no resultJson found`)
      }

      let resultJson: KieResultJson
      try {
        resultJson = JSON.parse(resultJsonStr) as KieResultJson
      } catch {
        throw new Error(`KIE.ai resultJson is not valid JSON: ${resultJsonStr}`)
      }

      return { resultJson, costTime: detailData.data.costTime }
    }

    if (state === "failed") {
      const failMsg = detailData.data.failMsg ?? detailData.data.failCode ?? "Unknown error"
      throw new Error(`KIE.ai task failed: ${failMsg}`)
    }
  }

  throw new Error(`KIE.ai task timed out after ${maxAttempts * POLL_INTERVAL_MS / 1000} seconds`)
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
    throw new Error(`KIE.ai does not support image provider: ${provider}`)
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
      // Image-to-image models use "image" param for the source image
      input.image = referenceImageUrls[0]
      // Some models may support multiple images
      if (referenceImageUrls.length > 1) {
        input.image_input = referenceImageUrls.slice(1)
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
    throw new Error(`KIE.ai image task succeeded but no URL in resultUrls`)
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
    throw new Error(`KIE.ai does not support edit image provider: ${provider}`)
  }

  console.log(`[KIE.ai] Editing image with ${modelConfig.model}`)
  console.log(`[KIE.ai] Image: ${imageUrl}, Prompt: "${prompt ?? ""}"`)

  const input: Record<string, unknown> = {
    image: imageUrl,
    output_format: "png",
  }

  // Add prompt only for nano-banana-edit (general editing with instructions)
  if (provider === "nano-banana-edit" && prompt) {
    input.prompt = prompt
  }

  const { resultJson } = await runKieTask(modelConfig.model, input)

  const outputUrl = resultJson.resultUrls?.[0]
  if (!outputUrl) {
    throw new Error(`KIE.ai edit image task succeeded but no URL in resultUrls`)
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
    throw new Error(`KIE.ai does not support video provider: ${provider}`)
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
    throw new Error(`KIE.ai video task succeeded but no URL found`)
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
    throw new Error(`KIE.ai does not support text-to-video provider: ${provider}`)
  }

  console.log(`[KIE.ai] Generating text-to-video with ${modelConfig.model}: "${prompt}"`)

  const input: Record<string, unknown> = { prompt }

  if (duration) {
    input.duration = duration
  }

  const { resultJson } = await runKieTask(modelConfig.model, input, MAX_POLL_ATTEMPTS_VIDEO)

  const videoUrl = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
  if (!videoUrl) {
    throw new Error(`KIE.ai text-to-video task succeeded but no URL found`)
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
    throw new Error(`KIE.ai does not support music provider: ${provider}`)
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
    throw new Error(`KIE.ai music task succeeded but no URL found`)
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
    throw new Error(`KIE.ai does not support TTS provider: ${provider}`)
  }

  console.log(`[KIE.ai] Generating TTS with ${modelConfig.model}, voice: ${voice ?? "default"}`)

  const input: Record<string, unknown> = {
    text,
    voice: voice ?? "Rachel",
  }

  const { resultJson } = await runKieTask(modelConfig.model, input)

  const audioUrl = resultJson.resultUrls?.[0] ?? resultJson.audioUrl
  if (!audioUrl) {
    throw new Error(`KIE.ai TTS task succeeded but no URL found`)
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
