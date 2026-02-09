/**
 * Kling 3.0 Video Generation Client
 *
 * Uses the KIE createTask endpoint with recordInfo polling.
 *
 * API: POST /api/v1/jobs/createTask  (model: "kling-3.0/video")
 * Poll: GET /api/v1/jobs/recordInfo?taskId=...
 */

import { config } from "../../lib/config.js"
import {
  KIE_API_BASE,
  POLL_INTERVAL_MS,
  MAX_POLL_ATTEMPTS_VIDEO,
  sleep,
  createSanitizedError,
} from "./client.js"

export interface Kling3Params {
  prompt: string
  imageUrls?: string[]
  sound?: boolean
  duration?: string
  aspectRatio?: string
  mode?: "std" | "pro"
}

export interface Kling3Result {
  taskId: string
  videoUrl: string
}

export async function kling3Generate(
  params: Kling3Params
): Promise<Kling3Result> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY not configured",
      "Kling 3.0"
    )
  }

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    sound: params.sound ?? true,
    duration: params.duration ?? "5",
    mode: params.mode ?? "pro",
    multi_shots: false,
    aspect_ratio: params.aspectRatio ?? "16:9",
  }

  if (params.imageUrls && params.imageUrls.length > 0) {
    input.image_urls = params.imageUrls
  }

  const requestBody = {
    model: "kling-3.0/video",
    callBackUrl: "https://callback.placeholder",
    input,
  }

  console.log(`[Kling3] ========== KLING 3.0 VIDEO REQUEST ==========`)
  console.log(`[Kling3] Input:`, JSON.stringify(requestBody, null, 2))

  const createResponse = await fetch(
    `${KIE_API_BASE}/api/v1/jobs/createTask`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    }
  )

  const responseText = await createResponse.text()
  console.log(`[Kling3] Response status: ${createResponse.status}`)
  console.log(`[Kling3] Response body: ${responseText.substring(0, 500)}`)

  if (!createResponse.ok) {
    throw createSanitizedError(
      `createTask failed: ${createResponse.status} - ${responseText}`,
      "Kling 3.0"
    )
  }

  let createData: { code?: number; msg?: string; data?: { taskId?: string } }
  try {
    createData = JSON.parse(responseText)
  } catch {
    throw createSanitizedError(
      `response is not valid JSON: ${responseText}`,
      "Kling 3.0"
    )
  }

  if (createData.code !== 200 && createData.code !== 0) {
    throw createSanitizedError(
      `createTask error (code ${createData.code}): ${createData.msg ?? JSON.stringify(createData)}`,
      "Kling 3.0"
    )
  }

  const taskId = createData.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `createTask response missing taskId: ${JSON.stringify(createData)}`,
      "Kling 3.0"
    )
  }

  console.log(`[Kling3] Task created: ${taskId}`)

  const videoUrl = await pollKling3Task(taskId, apiKey)

  return { taskId, videoUrl }
}

async function pollKling3Task(
  taskId: string,
  apiKey: string
): Promise<string> {
  const maxAttempts = MAX_POLL_ATTEMPTS_VIDEO
  let attempts = 0

  while (attempts < maxAttempts) {
    await sleep(POLL_INTERVAL_MS)
    attempts++

    const detailResponse = await fetch(
      `${KIE_API_BASE}/api/v1/jobs/recordInfo?taskId=${taskId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    )

    if (!detailResponse.ok) {
      console.warn(
        `[Kling3] Poll attempt ${attempts} failed: ${detailResponse.status}`
      )
      continue
    }

    const detailText = await detailResponse.text()
    console.log(
      `[Kling3] Poll ${attempts} raw response: ${detailText.substring(0, 500)}`
    )

    let detailData: Record<string, unknown>
    try {
      detailData = JSON.parse(detailText)
    } catch {
      console.warn(`[Kling3] Poll attempt ${attempts} invalid JSON`)
      continue
    }

    const data = detailData.data as Record<string, unknown> | undefined
    if (!data) {
      console.warn(`[Kling3] Poll attempt ${attempts} missing data`)
      continue
    }

    const state = (data.state as string) ?? (data.status as string)
    const progress = data.progress as number | undefined
    console.log(
      `[Kling3] Task ${taskId} state: ${state}${progress !== undefined ? ` (${progress}%)` : ""} (attempt ${attempts})`
    )

    if (state === "success" || state === "completed") {
      // Try multiple possible video URL locations
      const videoUrl =
        (data.videoUrl as string) ??
        (data.video_url as string) ??
        (data.resultUrl as string) ??
        (data.result_url as string)

      // Check resultJson as fallback
      if (!videoUrl && data.resultJson) {
        const resultJson =
          typeof data.resultJson === "string"
            ? JSON.parse(data.resultJson as string)
            : data.resultJson
        const parsed = resultJson as Record<string, unknown>
        const fromResult =
          (parsed.resultUrls as string[])?.[0] ??
          (parsed.videoUrl as string) ??
          (parsed.video_url as string)
        if (fromResult) {
          console.log(`[Kling3] Video completed: ${fromResult}`)
          return fromResult
        }
      }

      if (videoUrl) {
        console.log(`[Kling3] Video completed: ${videoUrl}`)
        return videoUrl
      }

      throw createSanitizedError(
        `task succeeded but no video URL found in response: ${JSON.stringify(data).substring(0, 500)}`,
        "Kling 3.0"
      )
    }

    if (
      state === "fail" ||
      state === "failed" ||
      state === "error"
    ) {
      const failMsg =
        (data.failMsg as string) ??
        (data.fail_msg as string) ??
        (data.errorMessage as string) ??
        "Unknown error"
      throw createSanitizedError(
        `Kling 3.0 generation failed: ${failMsg}`,
        "Kling 3.0"
      )
    }
  }

  throw createSanitizedError(
    `Kling 3.0 polling timed out after ${maxAttempts} attempts`,
    "Kling 3.0"
  )
}
