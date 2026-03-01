/**
 * Runway Video Generation Client (via KIE.ai)
 *
 * API: POST /api/v1/runway/generate (top-level body, NOT nested input)
 * Poll: GET /api/v1/runway/record-detail?taskId=...
 *
 * Supports T2V (prompt + aspectRatio) and I2V (prompt + imageUrl).
 * Duration: 5 or 10 seconds. Quality: "720p" or "1080p" (1080p incompatible with 10s).
 *
 * Polling uses standard `state` field: wait → queueing → generating → success / fail
 * Result at data.videoInfo.videoUrl
 */

import { config } from "../../lib/config.js"
import {
  KIE_API_BASE,
  sleep,
  pollDelay,
  createSanitizedError,
  MAX_POLL_ATTEMPTS_VIDEO,
  type KieResultJson,
} from "./client.js"

const DEBUG = config.NODE_ENV === "development"

export async function runRunwayTask(
  input: Record<string, unknown>,
): Promise<{ resultJson: KieResultJson }> {
  const apiKey = config.KIE_API_KEY

  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Video generation"
    )
  }

  if (DEBUG) {
    console.log(`[KIE.ai Runway] Creating Runway task`)
    console.log(`[KIE.ai Runway] Request body:`, JSON.stringify(input, null, 2))
  }

  // Step 1: Create task — body is top-level (prompt, duration, quality, etc.)
  const createResponse = await fetch(
    `${KIE_API_BASE}/api/v1/runway/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await createResponse.text()
  if (DEBUG) {
    console.log(`[KIE.ai Runway] Response status: ${createResponse.status}`)
    console.log(`[KIE.ai Runway] Response body: ${responseText.substring(0, 500)}`)
  }

  if (!createResponse.ok) {
    throw createSanitizedError(
      `Runway generate failed: ${createResponse.status} - ${responseText}`,
      "Video generation"
    )
  }

  let createData: { code?: number; message?: string; msg?: string; data?: { taskId?: string } }
  try {
    createData = JSON.parse(responseText)
  } catch {
    throw createSanitizedError(
      `Runway response is not valid JSON: ${responseText}`,
      "Video generation"
    )
  }

  if (
    createData.code !== 0 &&
    createData.code !== 200 &&
    createData.code !== undefined
  ) {
    throw createSanitizedError(
      `Runway generate error (code ${createData.code}): ${createData.message ?? createData.msg ?? JSON.stringify(createData)}`,
      "Video generation"
    )
  }

  if (!createData.data?.taskId) {
    throw createSanitizedError(
      `Runway generate response missing taskId: ${JSON.stringify(createData)}`,
      "Video generation"
    )
  }

  const taskId = createData.data.taskId
  console.log(`[KIE.ai Runway] Task created: ${taskId}`)

  // Step 2: Poll for completion using Runway-specific endpoint
  // State field: wait → queueing → generating → success / fail
  let attempts = 0
  while (attempts < MAX_POLL_ATTEMPTS_VIDEO) {
    attempts++
    await sleep(pollDelay(attempts))

    let detailResponse: Response
    try {
      detailResponse = await fetch(
        `${KIE_API_BASE}/api/v1/runway/record-detail?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        if (DEBUG) console.log(`[KIE.ai Runway] Poll attempt ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

    if (!detailResponse.ok) {
      console.warn(
        `[KIE.ai Runway] Poll attempt ${attempts} failed: ${detailResponse.status}`
      )
      continue
    }

    const detailText = await detailResponse.text()
    if (DEBUG) {
      console.log(`[KIE.ai Runway] Poll attempt ${attempts} response: ${detailText.substring(0, 300)}`)
    }

    let detailData: {
      code?: number
      data?: {
        state?: string
        videoInfo?: { videoUrl?: string }
        failCode?: string
        failMsg?: string
      }
    }
    try {
      detailData = JSON.parse(detailText)
    } catch {
      console.warn(
        `[KIE.ai Runway] Poll attempt ${attempts} invalid JSON`
      )
      continue
    }

    const state = detailData.data?.state
    if (!state) {
      console.warn(
        `[KIE.ai Runway] Poll attempt ${attempts} missing state`
      )
      continue
    }

    if (DEBUG) {
      console.log(`[KIE.ai Runway] Task ${taskId} state: ${state} (attempt ${attempts})`)
    }

    if (state === "success") {
      const videoUrl = detailData.data?.videoInfo?.videoUrl
      if (!videoUrl) {
        throw createSanitizedError(
          "Runway task succeeded but no videoUrl found",
          "Video generation"
        )
      }

      console.log(`[KIE.ai Runway] Video complete! URL: ${videoUrl}`)

      return {
        resultJson: { resultUrls: [videoUrl], videoUrl },
      }
    }

    if (state === "fail") {
      const failMsg = detailData.data?.failMsg ?? "Unknown error"
      const failCode = detailData.data?.failCode ?? "no_code"
      console.error(`[KIE.ai Runway] Task ${taskId} FAILED: [${failCode}] ${failMsg}`)
      throw createSanitizedError(
        `Runway task failed: [${failCode}] ${failMsg}`,
        "Video generation"
      )
    }

    // States "wait", "queueing", "generating" are all in-progress — continue polling
  }

  throw createSanitizedError(
    `Runway task timed out after ${MAX_POLL_ATTEMPTS_VIDEO} poll attempts`,
    "Video generation"
  )
}
