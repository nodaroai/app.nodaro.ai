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
  MAX_POLL_ATTEMPTS_VIDEO,
  sleep,
  createSanitizedError,
  pollDelay,
} from "./client.js"

const DEBUG = config.NODE_ENV === "development"

export interface Kling3Params {
  prompt: string
  imageUrls?: string[]
  sound?: boolean
  duration?: string | number
  aspectRatio?: string
  mode?: "std" | "pro"
  multiShots?: boolean
  multiPrompt?: Array<{ prompt: string; duration: number }>
  klingElements?: Array<{ name: string; description: string; type?: "image" | "video"; element_input_urls?: string[]; element_input_video_urls?: string[] }>
  onProgress?: (progress: number) => Promise<void> | void
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

  const multiShots = params.multiShots ?? false

  // Multi-shot mode requires sound to be enabled
  const soundOn = multiShots || (params.sound ?? true)

  const hasMultiPrompt = multiShots && params.multiPrompt && params.multiPrompt.length > 0

  // When multi_shots is true: prompt must be "", duration must be sum of all shots (number)
  const totalShotDuration = hasMultiPrompt
    ? params.multiPrompt!.reduce((sum, s) => sum + s.duration, 0)
    : 0

  const durationNum = hasMultiPrompt
    ? totalShotDuration
    : (typeof params.duration === "string" ? parseInt(params.duration, 10) : (params.duration ?? 5))

  const input: Record<string, unknown> = {
    prompt: hasMultiPrompt ? "" : params.prompt,
    sound: soundOn,
    duration: String(durationNum),
    mode: params.mode ?? "pro",
    cfg_scale: 0.5,
    multi_shots: multiShots,
    aspect_ratio: params.aspectRatio ?? "16:9",
  }

  if (params.imageUrls && params.imageUrls.length > 0) {
    input.image_urls = params.imageUrls
  }

  if (hasMultiPrompt) {
    // Duration as number per shot
    input.multi_prompt = params.multiPrompt!.map((shot) => ({
      prompt: shot.prompt,
      duration: shot.duration,
    }))
  }

  // Build name prefix map: originalName -> prefixedName
  // Kling API requires element names to start with "element_"
  const namePrefixMap: Record<string, string> = {}

  if (params.klingElements && params.klingElements.length > 0) {
    input.kling_elements = params.klingElements.map((el) => {
      let description = el.description
      if (description.length > 100) {
        if (DEBUG) console.log(`[Kling3] Truncated element "${el.name}" description from ${description.length} to 100 chars`)
        description = description.slice(0, 100)
      }

      // Prefix name with "element_" if not already present
      const originalName = el.name
      const prefixedName = originalName.startsWith("element_") ? originalName : `element_${originalName}`
      if (originalName !== prefixedName) {
        namePrefixMap[originalName] = prefixedName
      }

      const mapped: Record<string, unknown> = {
        name: prefixedName,
        description,
      }
      // Include whichever URL arrays are populated (field-presence, not type-based)
      if (el.element_input_video_urls && el.element_input_video_urls.length > 0) {
        mapped.element_input_video_urls = el.element_input_video_urls
      }
      if (el.element_input_urls && el.element_input_urls.length > 0) {
        mapped.element_input_urls = el.element_input_urls
      }
      return mapped
    })

    // Replace @name references in prompts with @element_name
    if (Object.keys(namePrefixMap).length > 0) {
      const originalNames = Object.keys(namePrefixMap)
      const newNames = Object.values(namePrefixMap)
      if (DEBUG) console.log(`[Kling3] Prefixed element names: ${originalNames.join(", ")} -> ${newNames.join(", ")}`)

      // Replace in main prompt (sort by length descending to avoid partial matches)
      const sortedEntries = Object.entries(namePrefixMap).sort((a, b) => b[0].length - a[0].length)
      let mainPrompt = input.prompt as string
      for (const [orig, prefixed] of sortedEntries) {
        mainPrompt = mainPrompt.replaceAll(`@${orig}`, `@${prefixed}`)
      }
      input.prompt = mainPrompt

      // Replace in multi_prompt shot prompts
      if (input.multi_prompt) {
        input.multi_prompt = (input.multi_prompt as Array<{ prompt: string; duration: number }>).map((shot) => {
          let shotPrompt = shot.prompt
          for (const [orig, prefixed] of sortedEntries) {
            shotPrompt = shotPrompt.replaceAll(`@${orig}`, `@${prefixed}`)
          }
          return { ...shot, prompt: shotPrompt }
        })
      }
    }
  }

  const requestBody = {
    model: "kling-3.0/video",
    input,
  }

  if (DEBUG) {
    console.log(`[Kling3] ========== KLING 3.0 VIDEO REQUEST ==========`)
    console.log(`[Kling3] Input:`, JSON.stringify(requestBody, null, 2))
  }

  const createResponse = await fetch(
    `${KIE_API_BASE}/api/v1/jobs/createTask`,
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
    console.log(`[Kling3] Response status: ${createResponse.status}`)
    console.log(`[Kling3] Response body: ${responseText.substring(0, 500)}`)
  }

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

  if (DEBUG) console.log(`[Kling3] Task created: ${taskId}`)

  const videoUrl = await pollKling3Task(taskId, apiKey, params.onProgress)

  return { taskId, videoUrl }
}

async function pollKling3Task(
  taskId: string,
  apiKey: string,
  onProgress?: (progress: number) => Promise<void> | void
): Promise<string> {
  const maxAttempts = MAX_POLL_ATTEMPTS_VIDEO
  let attempts = 0

  while (attempts < maxAttempts) {
    await sleep(pollDelay(attempts))
    attempts++

    let detailResponse: Response
    try {
      detailResponse = await fetch(
        `${KIE_API_BASE}/api/v1/jobs/recordInfo?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        if (DEBUG) console.log(`[Kling3] Poll attempt ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

    if (!detailResponse.ok) {
      if (DEBUG) console.warn(
        `[Kling3] Poll attempt ${attempts} failed: ${detailResponse.status}`
      )
      continue
    }

    const detailText = await detailResponse.text()
    if (DEBUG) console.log(`[Kling3] Poll ${attempts} raw response: ${detailText.substring(0, 500)}`)

    let detailData: Record<string, unknown>
    try {
      detailData = JSON.parse(detailText)
    } catch {
      if (DEBUG) console.warn(`[Kling3] Poll attempt ${attempts} invalid JSON`)
      continue
    }

    const data = detailData.data as Record<string, unknown> | undefined
    if (!data) {
      if (DEBUG) console.warn(`[Kling3] Poll attempt ${attempts} missing data`)
      continue
    }

    const state = (data.state as string) ?? (data.status as string)
    const progress = data.progress as number | undefined
    if (DEBUG) console.log(`[Kling3] Task ${taskId} state: ${state}${progress !== undefined ? ` (${progress}%)` : ""} (attempt ${attempts})`)

    if (onProgress && progress !== undefined) {
      await onProgress(progress)
    }

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
          if (DEBUG) console.log(`[Kling3] Video completed: ${fromResult}`)
          return fromResult
        }
      }

      if (videoUrl) {
        if (DEBUG) console.log(`[Kling3] Video completed: ${videoUrl}`)
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
