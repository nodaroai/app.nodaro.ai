/**
 * KIE.ai Suno API Client
 *
 * Dedicated client for Suno music generation via KIE.ai.
 * Uses separate endpoints from the standard KIE task API:
 *   - POST /api/v1/generate (create song)
 *   - POST /api/v1/generate/upload-cover (cover from audio)
 *   - GET  /api/v1/generate/record-info?taskId=xxx (poll status)
 *
 * Statuses: SUCCESS, PENDING, PROCESSING, FAILED
 */

import { config } from "../../lib/config.js"
import { KIE_API_BASE, createSanitizedError, sleep } from "./client.js"

// =============================================================================
// CONSTANTS
// =============================================================================

const SUNO_POLL_INTERVAL_MS = 5000
const SUNO_MAX_POLL_ATTEMPTS = 60 // 5 minutes (60 * 5s)

// =============================================================================
// TYPES
// =============================================================================

export type SunoModel = "V4" | "V4_5" | "V4_5PLUS" | "V4_5ALL" | "V5"

export interface SunoGenerateParams {
  /** Song description (simple mode) or ignored when custom lyrics provided */
  prompt: string
  /** Suno model version */
  model?: SunoModel
  /** Custom lyrics (enables custom mode) */
  lyrics?: string
  /** Music style tags (e.g. "pop, upbeat, energetic") */
  style?: string
  /** Song title */
  title?: string
  /** Negative style tags to avoid */
  negativeStyle?: string
  /** Vocal gender: "male" or "female" */
  vocalGender?: string
  /** Style weight 0-100, default 50 */
  styleWeight?: number
  /** Weirdness constraint 0-100, default 50 */
  weirdnessConstraint?: number
  /** Audio weight 0-100, default 50 */
  audioWeight?: number
  /** Whether to use custom mode (true when style/title/lyrics provided) */
  customMode?: boolean
  /** Whether the song is instrumental (no vocals) */
  instrumental?: boolean
}

export interface SunoCoverParams {
  /** Song description / prompt */
  prompt: string
  /** URL of source audio file (max 8 min, V4_5ALL max 1 min) */
  uploadUrl: string
  /** Suno model version */
  model?: SunoModel
  /** Custom lyrics */
  lyrics?: string
  /** Music style tags */
  style?: string
  /** Song title */
  title?: string
  /** Negative style tags */
  negativeStyle?: string
  /** Vocal gender */
  vocalGender?: string
  /** Whether to use custom mode (true when style/title/lyrics provided) */
  customMode?: boolean
  /** Whether the song is instrumental (no vocals) */
  instrumental?: boolean
}

export interface SunoTrack {
  id: string
  audioUrl: string
  title?: string
  duration?: number
  imageUrl?: string
}

export interface SunoTaskResult {
  taskId: string
  tracks: SunoTrack[]
}

interface SunoCreateResponse {
  code: number
  msg?: string
  message?: string
  data?: {
    taskId: string
  }
}

interface SunoRecordInfoResponse {
  code: number
  msg?: string
  message?: string
  data?: {
    taskId: string
    status: "SUCCESS" | "PENDING" | "PROCESSING" | "FAILED"
    response?: {
      sunoData?: Array<{
        id: string
        audio_url: string
        title?: string
        duration?: number
        image_url?: string
      }>
    }
    failReason?: string
    errorMessage?: string
  }
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

/**
 * Generate a song with Suno via KIE.ai
 */
export async function sunoGenerate(
  params: SunoGenerateParams
): Promise<SunoTaskResult> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Music generation"
    )
  }

  const model = params.model ?? "V5"

  // Build request body
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    model,
    customMode: params.customMode ?? false,
    instrumental: params.instrumental ?? false,
    callBackUrl: "https://callback.placeholder",
  }

  if (params.lyrics) body.lyrics = params.lyrics
  if (params.style) body.style = params.style
  if (params.title) body.title = params.title
  if (params.negativeStyle) body.negative_style = params.negativeStyle
  if (params.vocalGender) body.vocal_gender = params.vocalGender
  if (params.styleWeight != null) body.style_weight = params.styleWeight
  if (params.weirdnessConstraint != null) body.weirdness_constraint = params.weirdnessConstraint
  if (params.audioWeight != null) body.audio_weight = params.audioWeight

  console.log(`[Suno] Generating song with model ${model}`)
  console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }
  )

  const responseText = await response.text()
  console.log(`[Suno] Response status: ${response.status}`)
  console.log(`[Suno] Response: ${responseText.substring(0, 500)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `Suno generate failed: ${response.status} - ${responseText}`,
      "Music generation"
    )
  }

  let createData: SunoCreateResponse
  try {
    createData = JSON.parse(responseText) as SunoCreateResponse
  } catch {
    throw createSanitizedError(
      `Suno response is not valid JSON: ${responseText}`,
      "Music generation"
    )
  }

  if (createData.code !== 0 && createData.code !== 200) {
    throw createSanitizedError(
      `Suno generate error (code ${createData.code}): ${createData.msg ?? createData.message ?? JSON.stringify(createData)}`,
      "Music generation"
    )
  }

  const taskId = createData.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `Suno generate response missing taskId: ${JSON.stringify(createData)}`,
      "Music generation"
    )
  }

  console.log(`[Suno] Task created: ${taskId}`)
  return pollSunoTask(taskId)
}

/**
 * Create a cover version of an existing audio track
 */
export async function sunoCover(
  params: SunoCoverParams
): Promise<SunoTaskResult> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Music generation"
    )
  }

  const model = params.model ?? "V5"

  const body: Record<string, unknown> = {
    prompt: params.prompt,
    upload_url: params.uploadUrl,
    model,
    customMode: params.customMode ?? false,
    instrumental: params.instrumental ?? false,
    callBackUrl: "https://callback.placeholder",
  }

  if (params.lyrics) body.lyrics = params.lyrics
  if (params.style) body.style = params.style
  if (params.title) body.title = params.title
  if (params.negativeStyle) body.negative_style = params.negativeStyle
  if (params.vocalGender) body.vocal_gender = params.vocalGender

  console.log(`[Suno] Creating cover with model ${model}`)
  console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/generate/upload-cover`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }
  )

  const responseText = await response.text()
  console.log(`[Suno] Cover response status: ${response.status}`)
  console.log(`[Suno] Cover response: ${responseText.substring(0, 500)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `Suno cover failed: ${response.status} - ${responseText}`,
      "Music generation"
    )
  }

  let createData: SunoCreateResponse
  try {
    createData = JSON.parse(responseText) as SunoCreateResponse
  } catch {
    throw createSanitizedError(
      `Suno cover response is not valid JSON: ${responseText}`,
      "Music generation"
    )
  }

  if (createData.code !== 0 && createData.code !== 200) {
    throw createSanitizedError(
      `Suno cover error (code ${createData.code}): ${createData.msg ?? createData.message ?? JSON.stringify(createData)}`,
      "Music generation"
    )
  }

  const taskId = createData.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `Suno cover response missing taskId: ${JSON.stringify(createData)}`,
      "Music generation"
    )
  }

  console.log(`[Suno] Cover task created: ${taskId}`)
  return pollSunoTask(taskId)
}

/**
 * Poll a Suno task until completion
 */
async function pollSunoTask(taskId: string): Promise<SunoTaskResult> {
  const apiKey = config.KIE_API_KEY!

  let attempts = 0
  while (attempts < SUNO_MAX_POLL_ATTEMPTS) {
    await sleep(SUNO_POLL_INTERVAL_MS)
    attempts++

    const detailResponse = await fetch(
      `${KIE_API_BASE}/api/v1/generate/record-info?taskId=${taskId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    )

    if (!detailResponse.ok) {
      console.warn(
        `[Suno] Poll attempt ${attempts} failed: ${detailResponse.status}`
      )
      continue
    }

    const detailText = await detailResponse.text()
    let detailData: SunoRecordInfoResponse
    try {
      detailData = JSON.parse(detailText) as SunoRecordInfoResponse
    } catch {
      console.warn(`[Suno] Poll attempt ${attempts} invalid JSON`)
      continue
    }

    const status = detailData.data?.status
    console.log(
      `[Suno] Task ${taskId} status: ${status ?? "unknown"} (attempt ${attempts})`
    )

    if (status === "SUCCESS") {
      const sunoData = detailData.data?.response?.sunoData
      if (!sunoData?.length) {
        throw createSanitizedError(
          "Suno task succeeded but no tracks returned",
          "Music generation"
        )
      }

      const tracks: SunoTrack[] = sunoData.map((t) => ({
        id: t.id,
        audioUrl: t.audio_url,
        title: t.title,
        duration: t.duration,
        imageUrl: t.image_url,
      }))

      console.log(
        `[Suno] Task ${taskId} completed with ${tracks.length} track(s)`
      )
      return { taskId, tracks }
    }

    if (status === "FAILED") {
      const reason =
        detailData.data?.failReason ??
        detailData.data?.errorMessage ??
        "Unknown error"
      throw createSanitizedError(
        `Suno task failed: ${reason}`,
        "Music generation"
      )
    }

    // PENDING / PROCESSING — continue polling
  }

  throw createSanitizedError(
    `Suno task timed out after ${(SUNO_MAX_POLL_ATTEMPTS * SUNO_POLL_INTERVAL_MS) / 1000} seconds`,
    "Music generation"
  )
}
