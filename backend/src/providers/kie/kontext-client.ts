/**
 * Flux Kontext API Client
 *
 * Special endpoint: POST /api/v1/flux/kontext/generate
 * Polling: GET /api/v1/flux/kontext/record-info?taskId=
 * Uses successFlag pattern (same as VEO).
 */

import { config } from "../../lib/config.js"
import {
  KIE_API_BASE,
  sleep,
  pollDelay,
  createSanitizedError,
  createUpstreamFailureError,
  MAX_POLL_ATTEMPTS,
  type KieResultJson,
  type KieTaskResponse,
  type VeoRecordInfoResponse,
} from "./client.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import type { ReconcileOpts } from "../provider.interface.js"

const DEBUG = config.NODE_ENV === "development"

export async function runFluxKontextTask(
  model: string,
  input: Record<string, unknown>,
  reconcileOpts?: ReconcileOpts,
): Promise<{ resultJson: KieResultJson }> {
  const apiKey = config.KIE_API_KEY

  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Image generation"
    )
  }

  const requestBody = { model, ...input }

  if (DEBUG) {
    console.log(`[KIE.ai Kontext] Creating Kontext task with model: ${model}`)
    console.log(`[KIE.ai Kontext] Request body:`, JSON.stringify(requestBody, null, 2))
  }

  // Step 1: Create task
  const createResponse = await fetch(
    `${KIE_API_BASE}/api/v1/flux/kontext/generate`,
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
    console.log(`[KIE.ai Kontext] Response status: ${createResponse.status}`)
    console.log(`[KIE.ai Kontext] Response body: ${responseText.substring(0, 500)}`)
  }

  if (!createResponse.ok) {
    throw createSanitizedError(
      `Kontext generate failed: ${createResponse.status} - ${responseText}`,
      "Image generation"
    )
  }

  let createData: KieTaskResponse
  try {
    createData = JSON.parse(responseText) as KieTaskResponse
  } catch {
    throw createSanitizedError(
      `Kontext response is not valid JSON: ${responseText}`,
      "Image generation"
    )
  }

  if (
    createData.code !== 0 &&
    createData.code !== 200 &&
    createData.code !== undefined
  ) {
    throw createSanitizedError(
      `Kontext generate error (code ${createData.code}): ${createData.message ?? JSON.stringify(createData)}`,
      "Image generation"
    )
  }

  if (!createData.data?.taskId) {
    throw createSanitizedError(
      `Kontext generate response missing taskId: ${JSON.stringify(createData)}`,
      "Image generation"
    )
  }

  const taskId = createData.data.taskId
  console.log(`[KIE.ai Kontext] Task created: ${taskId}`)

  await fireOnTaskCreated(reconcileOpts, taskId, "[KIE.ai Kontext]")

  return pollKontextTask(taskId, MAX_POLL_ATTEMPTS)
}

/**
 * Poll an existing Kontext task until success / fail / max attempts.
 * Exported so reconciliation handlers can resume polling a task whose
 * worker died mid-poll.
 */
export async function pollKontextTask(
  taskId: string,
  maxAttempts: number = MAX_POLL_ATTEMPTS,
): Promise<{ resultJson: KieResultJson }> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError("KIE_API_KEY is not configured", "Image generation")
  }

  let attempts = 0
  while (attempts < maxAttempts) {
    attempts++
    await sleep(pollDelay(attempts))

    let detailResponse: Response
    try {
      detailResponse = await fetch(
        `${KIE_API_BASE}/api/v1/flux/kontext/record-info?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        if (DEBUG) console.log(`[KIE.ai Kontext] Poll attempt ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

    if (!detailResponse.ok) {
      console.warn(
        `[KIE.ai Kontext] Poll attempt ${attempts} failed: ${detailResponse.status}`
      )
      continue
    }

    const detailText = await detailResponse.text()
    if (DEBUG) {
      console.log(`[KIE.ai Kontext] Poll attempt ${attempts} response: ${detailText.substring(0, 300)}`)
    }

    let detailData: VeoRecordInfoResponse
    try {
      detailData = JSON.parse(detailText) as VeoRecordInfoResponse
    } catch {
      console.warn(
        `[KIE.ai Kontext] Poll attempt ${attempts} invalid JSON`
      )
      continue
    }

    const successFlag = detailData.data?.successFlag
    if (DEBUG) {
      console.log(`[KIE.ai Kontext] Task ${taskId} successFlag: ${successFlag} (attempt ${attempts})`)
    }

    if (successFlag === 1) {
      const response = detailData.data.response as Record<string, unknown> | undefined
      const resultImageUrl = response?.resultImageUrl as string | undefined
      if (!resultImageUrl) {
        throw createSanitizedError(
          "Kontext task succeeded but no resultImageUrl found",
          "Image generation"
        )
      }

      console.log(`[KIE.ai Kontext] Image complete! URL: ${resultImageUrl}`)

      return {
        resultJson: { resultUrls: [resultImageUrl] },
      }
    }

    if (successFlag === 2 || successFlag === 3) {
      const errorMsg =
        detailData.data.errorMessage ??
        `Error code: ${detailData.data.errorCode ?? "unknown"}`
      throw createUpstreamFailureError(
        `Kontext task failed: ${errorMsg}`,
        "Image generation"
      )
    }

    // successFlag === 0 means still generating, continue polling
  }

  throw createSanitizedError(
    `Kontext task timed out after ${maxAttempts} poll attempts`,
    "Image generation"
  )
}
