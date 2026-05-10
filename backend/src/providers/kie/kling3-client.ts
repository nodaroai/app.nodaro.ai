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
  motionPrompt?: string
  onProgress?: (progress: number) => Promise<void> | void
}

export interface Kling3Result {
  taskId: string
  videoUrl: string
}

type KlingElementParam = NonNullable<Kling3Params["klingElements"]>[number]

/**
 * Build kling_elements array on the input object, prefixing names with "element_".
 * Returns a map of original -> prefixed names for prompt replacement.
 */
function buildKlingElements(
  input: Record<string, unknown>,
  elements: KlingElementParam[],
): Record<string, string> {
  const namePrefixMap: Record<string, string> = {}

  input.kling_elements = elements.map((el) => {
    const description = el.description.length > 100
      ? el.description.slice(0, 100)
      : el.description

    const prefixedName = el.name.startsWith("element_")
      ? el.name
      : `element_${el.name}`

    if (el.name !== prefixedName) {
      namePrefixMap[el.name] = prefixedName
    }

    const mapped: Record<string, unknown> = { name: prefixedName, description }
    if (el.element_input_video_urls?.length) {
      mapped.element_input_video_urls = el.element_input_video_urls
    }
    if (el.element_input_urls?.length) {
      mapped.element_input_urls = el.element_input_urls
    }
    return mapped
  })

  return namePrefixMap
}

/** Replace @name references in prompt, multi_prompt, and element descriptions with @element_name prefixes. */
function applyElementNamePrefixes(
  input: Record<string, unknown>,
  namePrefixMap: Record<string, string>,
): void {
  const entries = Object.entries(namePrefixMap)
  if (entries.length === 0) return

  if (DEBUG) {
    const mapping = entries.map(([orig, prefixed]) => `${orig} -> ${prefixed}`).join(", ")
    console.log(`[Kling3] Prefixed element names: ${mapping}`)
  }

  // Sort by length descending to avoid partial matches (e.g. "cat" before "cat2")
  const sorted = entries.sort((a, b) => b[0].length - a[0].length)

  function replaceRefs(text: string): string {
    let result = text
    for (const [orig, prefixed] of sorted) {
      result = result.replaceAll(`@${orig}`, `@${prefixed}`)
    }
    return result
  }

  input.prompt = replaceRefs(input.prompt as string)

  if (input.multi_prompt) {
    input.multi_prompt = (input.multi_prompt as Array<{ prompt: string; duration: number }>).map(
      (shot) => ({ ...shot, prompt: replaceRefs(shot.prompt) })
    )
  }

  // Also replace @name refs inside element descriptions — Kling may interpret them as
  // unresolvable element refs and silently ignore the element if the short name is used.
  if (Array.isArray(input.kling_elements)) {
    input.kling_elements = (input.kling_elements as Array<Record<string, unknown>>).map(
      (el) => typeof el.description === "string"
        ? { ...el, description: replaceRefs(el.description) }
        : el
    )
  }
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
  const multiPrompt = multiShots && params.multiPrompt?.length
    ? params.multiPrompt
    : undefined

  // Multi-shot mode requires sound to be enabled
  const soundOn = multiShots || (params.sound ?? true)

  // When multi_shots is true: duration must be sum of all shot durations
  let durationNum: number
  if (multiPrompt) {
    durationNum = multiPrompt.reduce((sum, s) => sum + s.duration, 0)
  } else if (typeof params.duration === "string") {
    durationNum = parseInt(params.duration, 10) || 5
  } else {
    durationNum = params.duration ?? 5
  }

  if (durationNum < 3 || durationNum > 15) {
    throw createSanitizedError(
      `Duration ${durationNum}s is out of range (3-15s)`,
      "Kling 3.0"
    )
  }

  // motionPrompt replaces prompt for single-shot Kling 3.0; ignored in multi-shot
  const effectivePrompt = multiPrompt ? "" : (params.motionPrompt || params.prompt || "")

  const input: Record<string, unknown> = {
    prompt: effectivePrompt,
    sound: soundOn,
    duration: String(durationNum),
    mode: params.mode ?? "pro",
    multi_shots: multiShots,
    aspect_ratio: params.aspectRatio ?? "1:1",
  }

  if (params.imageUrls && params.imageUrls.length > 0) {
    input.image_urls = params.imageUrls
  }

  if (multiPrompt) {
    input.multi_prompt = multiPrompt.map((shot) => ({
      prompt: shot.prompt,
      duration: shot.duration,
    }))
  }

  // Build elements and apply "element_" name prefix required by the Kling API
  if (params.klingElements && params.klingElements.length > 0) {
    const namePrefixMap = buildKlingElements(input, params.klingElements)
    applyElementNamePrefixes(input, namePrefixMap)
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
        console.warn(`[Kling3] Poll attempt ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

    if (!detailResponse.ok) {
      console.warn(`[Kling3] Poll attempt ${attempts} HTTP ${detailResponse.status} for taskId=${taskId}`)
      continue
    }

    const detailText = await detailResponse.text()
    if (DEBUG) console.log(`[Kling3] Poll ${attempts} raw response: ${detailText.substring(0, 500)}`)

    let detailData: Record<string, unknown>
    try {
      detailData = JSON.parse(detailText)
    } catch {
      console.warn(`[Kling3] Poll attempt ${attempts} invalid JSON for taskId=${taskId}`)
      continue
    }

    const data = detailData.data as Record<string, unknown> | undefined
    if (!data) {
      console.warn(`[Kling3] Poll attempt ${attempts} missing data field for taskId=${taskId}`)
      continue
    }

    const state = (data.state as string) ?? (data.status as string)
    const progress = data.progress as number | undefined

    // Log every 5th attempt unconditionally so production has visibility
    if (attempts % 5 === 0 || attempts === 1) {
      console.log(`[Kling3] taskId=${taskId} state=${state}${progress !== undefined ? ` progress=${progress}%` : ""} attempt=${attempts}`)
    } else if (DEBUG) {
      console.log(`[Kling3] Task ${taskId} state: ${state}${progress !== undefined ? ` (${progress}%)` : ""} (attempt ${attempts})`)
    }

    if (onProgress && progress !== undefined) {
      try {
        await onProgress(progress)
      } catch (e) {
        console.warn(`[Kling3] Progress callback error for taskId=${taskId}:`, e)
      }
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
        try {
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
            console.log(`[Kling3] taskId=${taskId} completed via resultJson: ${fromResult}`)
            return fromResult
          }
        } catch (e) {
          console.warn(`[Kling3] Failed to parse resultJson for taskId=${taskId}:`, e)
        }
      }

      if (videoUrl) {
        console.log(`[Kling3] taskId=${taskId} completed: ${videoUrl}`)
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
      console.warn(`[Kling3] taskId=${taskId} failed: ${failMsg}`)
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
