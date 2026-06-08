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
  createUpstreamFailureError,
  MAX_POLL_ATTEMPTS_VIDEO,
  type KieResultJson,
} from "./client.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import type { ReconcileOpts } from "../provider.interface.js"

const DEBUG = config.NODE_ENV === "development"

/**
 * Shared task creation: POST to a KIE endpoint, parse response, extract taskId.
 * Used by Runway generate, Runway extend, and Aleph generate.
 */
async function postKieEndpoint(
  path: string,
  input: Record<string, unknown>,
  label: string,
): Promise<{ taskId: string; apiKey: string }> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError("KIE_API_KEY is not configured", label)
  }

  if (DEBUG) {
    console.log(`[KIE.ai ${label}] Creating task`)
    console.log(`[KIE.ai ${label}] Request body:`, JSON.stringify(input, null, 2))
  }

  const createResponse = await fetch(
    `${KIE_API_BASE}${path}`,
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
    console.log(`[KIE.ai ${label}] Response status: ${createResponse.status}`)
    console.log(`[KIE.ai ${label}] Response body: ${responseText.substring(0, 500)}`)
  }

  if (!createResponse.ok) {
    throw createSanitizedError(
      `${label} failed: ${createResponse.status} - ${responseText}`,
      label
    )
  }

  let createData: { code?: number; message?: string; msg?: string; data?: { taskId?: string } }
  try {
    createData = JSON.parse(responseText)
  } catch {
    throw createSanitizedError(
      `${label} response is not valid JSON: ${responseText}`,
      label
    )
  }

  if (
    createData.code !== 0 &&
    createData.code !== 200 &&
    createData.code !== undefined
  ) {
    throw createSanitizedError(
      `${label} error (code ${createData.code}): ${createData.message ?? createData.msg ?? JSON.stringify(createData)}`,
      label
    )
  }

  if (!createData.data?.taskId) {
    throw createSanitizedError(
      `${label} response missing taskId: ${JSON.stringify(createData)}`,
      label
    )
  }

  const taskId = createData.data.taskId
  console.log(`[KIE.ai ${label}] Task created: ${taskId}`)
  return { taskId, apiKey }
}

export async function runRunwayTask(
  input: Record<string, unknown>,
  reconcileOpts?: ReconcileOpts,
): Promise<{ resultJson: KieResultJson; taskId: string }> {
  const { taskId, apiKey } = await postKieEndpoint("/api/v1/runway/generate", input, "Runway generate")

  await fireOnTaskCreated(reconcileOpts, taskId, "[KIE.ai Runway]")

  const videoUrl = await pollRunwayRecordDetail(taskId, "Runway", apiKey)
  return { resultJson: { resultUrls: [videoUrl], videoUrl }, taskId }
}

/**
 * Shared Runway record-detail polling loop.
 * Polls GET /api/v1/runway/record-detail?taskId= until state=success or fail.
 * Returns videoUrl on success; throws on failure or timeout.
 *
 * Exported so reconciliation handlers can resume polling a stuck task. The
 * `label` param distinguishes log lines between "Runway" and "Runway Extend";
 * defaults to "Runway". `apiKey` defaults to `config.KIE_API_KEY`.
 */
export async function pollRunwayTask(
  taskId: string,
  label: string = "Runway",
  apiKey?: string,
): Promise<string> {
  const resolvedKey = apiKey ?? config.KIE_API_KEY
  if (!resolvedKey) throw createSanitizedError("KIE_API_KEY is not configured", "Video generation")
  return pollRunwayRecordDetail(taskId, label, resolvedKey)
}

async function pollRunwayRecordDetail(
  taskId: string,
  label: string,
  apiKey: string,
): Promise<string> {
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
        if (DEBUG) console.log(`[KIE.ai ${label}] Poll attempt ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

    if (!detailResponse.ok) {
      if (DEBUG) console.warn(`[KIE.ai ${label}] Poll attempt ${attempts} failed: ${detailResponse.status}`)
      continue
    }

    const detailText = await detailResponse.text()
    if (DEBUG) {
      console.log(`[KIE.ai ${label}] Poll attempt ${attempts} response: ${detailText.substring(0, 300)}`)
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
      if (DEBUG) console.warn(`[KIE.ai ${label}] Poll attempt ${attempts} invalid JSON`)
      continue
    }

    const state = detailData.data?.state
    if (!state) {
      if (DEBUG) console.warn(`[KIE.ai ${label}] Poll attempt ${attempts} missing state`)
      continue
    }

    if (DEBUG) {
      console.log(`[KIE.ai ${label}] Task ${taskId} state: ${state} (attempt ${attempts})`)
    }

    if (state === "success") {
      const videoUrl = detailData.data?.videoInfo?.videoUrl
      if (!videoUrl) {
        throw createSanitizedError(`${label} succeeded but no videoUrl found`, "Video generation")
      }
      console.log(`[KIE.ai ${label}] Complete! URL: ${videoUrl}`)
      return videoUrl
    }

    if (state === "fail") {
      const failMsg = detailData.data?.failMsg ?? "Unknown error"
      const failCode = detailData.data?.failCode ?? "no_code"
      throw createUpstreamFailureError(`${label} failed: [${failCode}] ${failMsg}`, "Video generation")
    }
  }

  throw createSanitizedError(`${label} timed out after ${MAX_POLL_ATTEMPTS_VIDEO} poll attempts`, "Video generation")
}

/**
 * Runway Extend — continue a Runway video with a new prompt.
 * API: POST /api/v1/runway/extend
 * Poll: GET /api/v1/runway/record-detail (same as runRunwayTask)
 */
export async function runRunwayExtendTask(
  taskId: string,
  prompt: string,
  quality: "720p" | "1080p" = "720p",
  reconcileOpts?: ReconcileOpts,
): Promise<{ resultJson: KieResultJson; taskId: string }> {
  const { taskId: extendTaskId, apiKey } = await postKieEndpoint(
    "/api/v1/runway/extend",
    { taskId, prompt, quality },
    "Runway extend"
  )

  await fireOnTaskCreated(reconcileOpts, extendTaskId, "[KIE.ai Runway Extend]")

  const videoUrl = await pollRunwayRecordDetail(extendTaskId, "Runway Extend", apiKey)
  return { resultJson: { resultUrls: [videoUrl], videoUrl }, taskId: extendTaskId }
}

/**
 * Runway Aleph — video-to-video AI conversion.
 * API: POST /api/v1/aleph/generate
 * Poll: GET /api/v1/aleph/record-info?taskId=...
 *
 * Polling uses `successFlag` field: 0=processing, 1=success
 * Result at data.response.resultVideoUrl
 */
export async function runAlephTask(
  input: Record<string, unknown>,
  reconcileOpts?: ReconcileOpts,
): Promise<{ resultJson: KieResultJson; taskId: string }> {
  const { taskId, apiKey } = await postKieEndpoint("/api/v1/aleph/generate", input, "Aleph generate")

  await fireOnTaskCreated(reconcileOpts, taskId, "[KIE.ai Aleph]")

  const videoUrl = await pollAlephRecordInfo(taskId, apiKey)
  return { resultJson: { resultUrls: [videoUrl], videoUrl }, taskId }
}

/**
 * Poll GET /api/v1/aleph/record-info?taskId= until successFlag=1.
 * Returns resultVideoUrl on success; throws on failure or timeout.
 *
 * Exported wrapper for reconciliation handlers. `apiKey` defaults to
 * `config.KIE_API_KEY`.
 */
export async function pollAlephTask(
  taskId: string,
  apiKey?: string,
): Promise<string> {
  const resolvedKey = apiKey ?? config.KIE_API_KEY
  if (!resolvedKey) throw createSanitizedError("KIE_API_KEY is not configured", "Video generation")
  return pollAlephRecordInfo(taskId, resolvedKey)
}

async function pollAlephRecordInfo(
  taskId: string,
  apiKey: string,
): Promise<string> {
  let attempts = 0
  while (attempts < MAX_POLL_ATTEMPTS_VIDEO) {
    attempts++
    await sleep(pollDelay(attempts))

    let detailResponse: Response
    try {
      detailResponse = await fetch(
        `${KIE_API_BASE}/api/v1/aleph/record-info?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        if (DEBUG) console.log(`[KIE.ai Aleph] Poll attempt ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

    if (!detailResponse.ok) {
      if (DEBUG) console.warn(`[KIE.ai Aleph] Poll attempt ${attempts} failed: ${detailResponse.status}`)
      continue
    }

    const detailText = await detailResponse.text()
    if (DEBUG) {
      console.log(`[KIE.ai Aleph] Poll attempt ${attempts} response: ${detailText.substring(0, 300)}`)
    }

    let detailData: {
      code?: number
      data?: {
        successFlag?: number
        errorCode?: number
        errorMessage?: string
        response?: {
          resultVideoUrl?: string
          resultImageUrl?: string
        }
      }
    }
    try {
      detailData = JSON.parse(detailText)
    } catch {
      if (DEBUG) console.warn(`[KIE.ai Aleph] Poll attempt ${attempts} invalid JSON`)
      continue
    }

    const successFlag = detailData.data?.successFlag
    if (successFlag === undefined || successFlag === null) {
      if (DEBUG) console.warn(`[KIE.ai Aleph] Poll attempt ${attempts} missing successFlag`)
      continue
    }

    if (DEBUG) {
      console.log(`[KIE.ai Aleph] Task ${taskId} successFlag: ${successFlag} (attempt ${attempts})`)
    }

    if (successFlag === 1) {
      const videoUrl = detailData.data?.response?.resultVideoUrl
      if (!videoUrl) {
        throw createSanitizedError("Aleph succeeded but no resultVideoUrl found", "Video generation")
      }
      console.log(`[KIE.ai Aleph] Complete! URL: ${videoUrl}`)
      return videoUrl
    }

    // successFlag 2/3 = failed (the VEO convention this client mirrors). Fail fast
    // rather than fall through to "continue polling" and burn the full ~20-min
    // timeout when KIE reports failure WITHOUT also setting errorCode. Matches the
    // VEO (client.ts) and Kontext failure handling.
    if (successFlag === 2 || successFlag === 3) {
      const errorMsg = detailData.data?.errorMessage ?? "task failed"
      throw createUpstreamFailureError(`Aleph failed: ${errorMsg}`, "Video generation")
    }

    if (detailData.data?.errorCode && detailData.data.errorCode !== 0) {
      const errorMsg = detailData.data?.errorMessage ?? "Unknown error"
      throw createUpstreamFailureError(`Aleph failed: [${detailData.data.errorCode}] ${errorMsg}`, "Video generation")
    }

    // successFlag === 0 means still processing — continue polling
  }

  throw createSanitizedError(`Aleph timed out after ${MAX_POLL_ATTEMPTS_VIDEO} poll attempts`, "Video generation")
}
