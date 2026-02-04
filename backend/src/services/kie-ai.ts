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
 * estimated costs based on their pricing page (4 credits = $0.02 for nano-banana)
 */

import { config } from "../lib/config.js"

const KIE_API_BASE = "https://api.kie.ai"
const POLL_INTERVAL_MS = 2000  // Poll every 2 seconds
const MAX_POLL_ATTEMPTS = 150  // Max 5 minutes (150 * 2s)

// KIE.ai doesn't return credits in the API response, so we use fixed costs per model
// Based on KIE.ai pricing: https://kie.ai/pricing
// 1 credit = $0.005
const KIE_MODEL_COSTS: Record<string, number> = {
  "google/nano-banana": 0.02,  // 4 credits × $0.005
  // Add more models as we integrate them
}

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
    resultJson?: string  // JSON string that needs parsing: {"resultUrls": ["url1", "url2"]}
    failCode?: string
    failMsg?: string
    costTime?: number     // Processing time in ms
    completeTime?: string
    createTime?: string
  }
}

interface KieResultJson {
  resultUrls?: string[]
}

export interface KieImageResult {
  url: string
  cost: number  // Estimated cost based on KIE.ai pricing (not from API response)
}

/**
 * Generate an image using KIE.ai API
 */
export async function generateImageKie(
  prompt: string,
  referenceImageUrls?: string[]
): Promise<KieImageResult> {
  const apiKey = config.KIE_API_KEY

  // Debug: Check if API key exists (don't log the actual key)
  console.log(`[KIE.ai] API Key configured: ${apiKey ? "YES" : "NO"} (length: ${apiKey?.length ?? 0})`)

  if (!apiKey) {
    throw new Error("KIE_API_KEY is not configured")
  }

  console.log(`[KIE.ai] Generating image: "${prompt}"`)
  if (referenceImageUrls?.length) {
    console.log(`[KIE.ai] Reference images (${referenceImageUrls.length}): ${referenceImageUrls.join(", ")}`)
  }

  // Build the request body per KIE.ai docs: https://kie.ai/nano-banana
  const requestBody = {
    model: "google/nano-banana",
    input: {
      prompt,
      output_format: "png",
      image_size: "16:9",
      ...(referenceImageUrls?.length ? { image_input: referenceImageUrls } : {}),
    },
  }

  // Debug: Log request body
  console.log(`[KIE.ai] Request URL: ${KIE_API_BASE}/api/v1/jobs/createTask`)
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

  // Debug: Log response status
  console.log(`[KIE.ai] Response status: ${createResponse.status} ${createResponse.statusText}`)

  // Get raw response text first for debugging
  const responseText = await createResponse.text()
  console.log(`[KIE.ai] Raw response:`, responseText)

  if (!createResponse.ok) {
    throw new Error(`KIE.ai createTask failed: ${createResponse.status} - ${responseText}`)
  }

  // Parse JSON
  let createData: KieTaskResponse
  try {
    createData = JSON.parse(responseText) as KieTaskResponse
  } catch (parseError) {
    throw new Error(`KIE.ai response is not valid JSON: ${responseText}`)
  }

  // Debug: Log parsed response
  console.log(`[KIE.ai] Parsed response:`, JSON.stringify(createData, null, 2))

  // Check for error codes - handle various response structures
  if (createData.code !== 0 && createData.code !== 200 && createData.code !== undefined) {
    throw new Error(`KIE.ai createTask error (code ${createData.code}): ${createData.message ?? JSON.stringify(createData)}`)
  }

  // Check if data and taskId exist
  if (!createData.data?.taskId) {
    throw new Error(`KIE.ai createTask response missing taskId: ${JSON.stringify(createData)}`)
  }

  const taskId = createData.data.taskId
  console.log(`[KIE.ai] Task created: ${taskId}`)

  // Step 2: Poll for completion
  let attempts = 0
  while (attempts < MAX_POLL_ATTEMPTS) {
    await sleep(POLL_INTERVAL_MS)
    attempts++

    const detailResponse = await fetch(
      `${KIE_API_BASE}/api/v1/jobs/recordInfo?taskId=${taskId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    )

    if (!detailResponse.ok) {
      const errorText = await detailResponse.text().catch(() => "")
      console.warn(`[KIE.ai] Poll attempt ${attempts} failed: ${detailResponse.status} - ${errorText}`)
      continue
    }

    const detailText = await detailResponse.text()
    let detailData: KieRecordInfoResponse
    try {
      detailData = JSON.parse(detailText) as KieRecordInfoResponse
    } catch {
      console.warn(`[KIE.ai] Poll attempt ${attempts} invalid JSON: ${detailText}`)
      continue
    }

    const state = detailData.data?.state
    if (!state) {
      console.warn(`[KIE.ai] Poll attempt ${attempts} missing state: ${detailText}`)
      continue
    }

    console.log(`[KIE.ai] Task ${taskId} state: ${state} (attempt ${attempts})`)

    if (state === "success") {
      // Parse resultJson string to get image URLs
      const resultJsonStr = detailData.data.resultJson
      if (!resultJsonStr) {
        throw new Error(`KIE.ai task succeeded but no resultJson found: ${JSON.stringify(detailData.data)}`)
      }

      let resultJson: KieResultJson
      try {
        resultJson = JSON.parse(resultJsonStr) as KieResultJson
      } catch {
        throw new Error(`KIE.ai resultJson is not valid JSON: ${resultJsonStr}`)
      }

      const imageUrl = resultJson.resultUrls?.[0]
      if (!imageUrl) {
        throw new Error(`KIE.ai task succeeded but no image URL in resultUrls: ${resultJsonStr}`)
      }

      // KIE.ai doesn't return credits in the API response, so we use fixed costs
      // Based on the model used (currently hardcoded to google/nano-banana)
      const modelUsed = "google/nano-banana"
      const estimatedCost = KIE_MODEL_COSTS[modelUsed] ?? 0.02  // Default to nano-banana cost

      console.log(`[KIE.ai] Task completed: ${imageUrl} (model: ${modelUsed}, estimated cost: $${estimatedCost.toFixed(4)})`)

      return { url: imageUrl, cost: estimatedCost }
    }

    if (state === "failed") {
      const failMsg = detailData.data.failMsg ?? detailData.data.failCode ?? "Unknown error"
      throw new Error(`KIE.ai task failed: ${failMsg}`)
    }

    // Continue polling for "pending" or "processing" state
  }

  throw new Error(`KIE.ai task timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000} seconds`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
