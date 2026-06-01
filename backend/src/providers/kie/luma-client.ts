/**
 * Luma Modify (Video-to-Video) Client (via KIE.ai)
 *
 * API: POST /api/v1/modify/generate (top-level body)
 * Poll: GET /api/v1/modify/record-info?taskId=...
 *
 * Input: prompt (English only) + videoUrl (MP4/MOV/AVI, max 500MB, max 10s)
 *
 * Polling uses `successFlag` (same as VEO):
 *   0 = generating
 *   1 = success → result at data.response.resultUrls[0]
 *   2 = create task failed
 *   3 = generate failed
 *   4 = callback failed (treat as success if resultUrls present)
 */

import { config } from "../../lib/config.js"
import { throwIfJobCancelled } from "../../lib/job-cancellation.js"
import {
  KIE_API_BASE,
  sleep,
  pollDelay,
  createSanitizedError,
  MAX_POLL_ATTEMPTS_VIDEO,
  type KieResultJson,
} from "./client.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import type { ReconcileOpts } from "../provider.interface.js"

const DEBUG = config.NODE_ENV === "development"

export async function runLumaModifyTask(
  input: Record<string, unknown>,
  reconcileOpts?: ReconcileOpts,
): Promise<{ resultJson: KieResultJson }> {
  const apiKey = config.KIE_API_KEY

  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Video generation"
    )
  }

  if (DEBUG) {
    console.log(`[KIE.ai Luma] Creating Luma Modify task`)
    console.log(`[KIE.ai Luma] Request body:`, JSON.stringify(input, null, 2))
  }

  // Step 1: Create task — body is top-level (prompt, videoUrl)
  const createResponse = await fetch(
    `${KIE_API_BASE}/api/v1/modify/generate`,
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
    console.log(`[KIE.ai Luma] Response status: ${createResponse.status}`)
    console.log(`[KIE.ai Luma] Response body: ${responseText.substring(0, 500)}`)
  }

  if (!createResponse.ok) {
    throw createSanitizedError(
      `Luma Modify generate failed: ${createResponse.status} - ${responseText}`,
      "Video generation"
    )
  }

  let createData: { code?: number; message?: string; msg?: string; data?: { taskId?: string } }
  try {
    createData = JSON.parse(responseText)
  } catch {
    throw createSanitizedError(
      `Luma Modify response is not valid JSON: ${responseText}`,
      "Video generation"
    )
  }

  if (
    createData.code !== 0 &&
    createData.code !== 200 &&
    createData.code !== undefined
  ) {
    throw createSanitizedError(
      `Luma Modify generate error (code ${createData.code}): ${createData.message ?? createData.msg ?? JSON.stringify(createData)}`,
      "Video generation"
    )
  }

  if (!createData.data?.taskId) {
    throw createSanitizedError(
      `Luma Modify generate response missing taskId: ${JSON.stringify(createData)}`,
      "Video generation"
    )
  }

  const taskId = createData.data.taskId
  console.log(`[KIE.ai Luma] Task created: ${taskId}`)

  await fireOnTaskCreated(reconcileOpts, taskId, "[KIE.ai Luma]")

  return pollLumaTask(taskId, MAX_POLL_ATTEMPTS_VIDEO)
}

/**
 * Poll an existing Luma Modify task until success / fail / max attempts.
 * Exported so reconciliation handlers can resume polling a stuck task.
 */
export async function pollLumaTask(
  taskId: string,
  maxAttempts: number = MAX_POLL_ATTEMPTS_VIDEO,
): Promise<{ resultJson: KieResultJson }> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError("KIE_API_KEY is not configured", "Video generation")
  }

  // successFlag: 0=generating, 1=success, 2=create failed, 3=generate failed, 4=callback failed
  let attempts = 0
  while (attempts < maxAttempts) {
    await throwIfJobCancelled()
    attempts++
    await sleep(pollDelay(attempts))

    let detailResponse: Response
    try {
      detailResponse = await fetch(
        `${KIE_API_BASE}/api/v1/modify/record-info?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        if (DEBUG) console.log(`[KIE.ai Luma] Poll attempt ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

    if (!detailResponse.ok) {
      console.warn(
        `[KIE.ai Luma] Poll attempt ${attempts} failed: ${detailResponse.status}`
      )
      continue
    }

    const detailText = await detailResponse.text()
    if (DEBUG) {
      console.log(`[KIE.ai Luma] Poll attempt ${attempts} response: ${detailText.substring(0, 300)}`)
    }

    let detailData: {
      code?: number
      msg?: string
      data?: {
        taskId?: string
        successFlag?: number
        errorCode?: number
        errorMessage?: string
        response?: {
          taskId?: string
          resultUrls?: string[]
        }
      }
    }
    try {
      detailData = JSON.parse(detailText)
    } catch {
      console.warn(
        `[KIE.ai Luma] Poll attempt ${attempts} invalid JSON`
      )
      continue
    }

    const successFlag = detailData.data?.successFlag
    if (DEBUG) {
      console.log(`[KIE.ai Luma] Task ${taskId} successFlag: ${successFlag} (attempt ${attempts})`)
    }

    // successFlag 1 = success
    if (successFlag === 1) {
      const resultUrls = detailData.data?.response?.resultUrls
      if (!resultUrls?.length) {
        throw createSanitizedError(
          "Luma Modify task succeeded but no resultUrls found",
          "Video generation"
        )
      }

      console.log(`[KIE.ai Luma] Video complete! URL: ${resultUrls[0]}`)

      return {
        resultJson: { resultUrls },
      }
    }

    // successFlag 4 = callback failed, but may still have results
    if (successFlag === 4) {
      const resultUrls = detailData.data?.response?.resultUrls
      if (resultUrls?.length) {
        console.warn(`[KIE.ai Luma] Callback failed but resultUrls present, treating as success`)
        return {
          resultJson: { resultUrls },
        }
      }
      // No results — treat as failure
      throw createSanitizedError(
        "Luma Modify task callback failed with no results",
        "Video generation"
      )
    }

    // successFlag 2 or 3 = failed
    if (successFlag === 2 || successFlag === 3) {
      const errorMsg =
        detailData.data?.errorMessage ??
        `Error code: ${detailData.data?.errorCode ?? "unknown"}`
      throw createSanitizedError(
        `Luma Modify task failed: ${errorMsg}`,
        "Video generation"
      )
    }

    // successFlag 0 = still generating, continue polling
  }

  throw createSanitizedError(
    `Luma Modify task timed out after ${maxAttempts} poll attempts`,
    "Video generation"
  )
}
