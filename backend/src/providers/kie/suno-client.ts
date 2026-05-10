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
import { KIE_API_BASE, createSanitizedError, sleep, pollDelay } from "./client.js"

// =============================================================================
// CONSTANTS
// =============================================================================

const SUNO_POLL_INTERVAL_MS = 5000 // kept for timeout calculations
const DEBUG = config.NODE_ENV === "development"
const SUNO_MAX_POLL_ATTEMPTS = 60 // 5 minutes (60 * 5s)

// =============================================================================
// TYPES
// =============================================================================

export type SunoModel = "V4" | "V4_5" | "V4_5PLUS" | "V4_5ALL" | "V5"
export type SunoAddTrackModel = "V4_5PLUS" | "V5"

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
  /** Style weight 0-1, default 0.5 */
  styleWeight?: number
  /** Weirdness constraint 0-1, default 0 */
  weirdnessConstraint?: number
  /** Audio weight 0-1, default 0.5 */
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

export interface SunoExtendParams {
  /** Suno audio ID of the track to extend */
  audioId: string
  /** Whether to use default parameters (default true) */
  defaultParamFlag?: boolean
  /** Song description / prompt */
  prompt?: string
  /** Suno model version */
  model?: SunoModel
  /** Music style tags */
  style?: string
  /** Song title */
  title?: string
  /** Timestamp (in seconds) to continue from */
  continueAt?: number
  /** Negative style tags to avoid */
  negativeStyle?: string
  /** Vocal gender: "male" or "female" */
  vocalGender?: string
  /** Style weight 0-1 */
  styleWeight?: number
  /** Weirdness constraint 0-1 */
  weirdnessConstraint?: number
  /** Audio weight 0-1 */
  audioWeight?: number
}

export interface SunoLyricsParams {
  prompt: string
}

export interface SunoLyricsResult {
  taskId: string
  lyrics: Array<{ text: string; title: string }>
}

export type SunoSeparateType = "separate_vocal" | "split_stem"

export interface SunoSeparateParams {
  taskId: string
  audioId: string
  type: SunoSeparateType
}

export interface SunoSeparateResult {
  taskId: string
  vocalUrl?: string
  instrumentalUrl?: string
  backingVocalsUrl?: string
  drumsUrl?: string
  bassUrl?: string
  guitarUrl?: string
  pianoUrl?: string
  keyboardUrl?: string
  percussionUrl?: string
  stringsUrl?: string
  synthUrl?: string
  fxUrl?: string
  brassUrl?: string
  woodwindsUrl?: string
}

export interface SunoMusicVideoParams {
  taskId: string
  audioId: string
}

export interface SunoMusicVideoResult {
  taskId: string
  videoUrl: string
}

export interface SunoMashupParams {
  /** List of exactly 2 audio URLs to combine */
  uploadUrlList: [string, string]
  /** Suno model version */
  model?: SunoModel
  /** Whether to use custom mode */
  customMode?: boolean
  /** Music style tags */
  style?: string
  /** Song title */
  title?: string
  /** Negative style tags to avoid */
  negativeStyle?: string
  /** Vocal gender */
  vocalGender?: string
}

export interface SunoReplaceSectionParams {
  /** Suno task ID of the original track */
  taskId: string
  /** Suno audio ID of the track */
  audioId: string
  /** Start time of section to replace (seconds) */
  infillStartS: number
  /** End time of section to replace (seconds, 6-60s, max 50% of song) */
  infillEndS: number
  /** Replacement prompt */
  prompt: string
  /** Style / genre tags */
  tags: string
  /** Song title */
  title?: string
}

export interface SunoStyleBoostParams {
  /** Content text to enhance style for */
  content: string
}

export interface SunoStyleBoostResult {
  text: string
}

export interface SunoAddInstrumentalParams {
  /** Suno task ID of the original track */
  taskId: string
  /** Suno audio ID of the track */
  audioId: string
  /** Model version (V4_5PLUS or V5 only) */
  model?: SunoAddTrackModel
}

export interface SunoAddVocalsParams {
  /** Suno task ID of the original track */
  taskId: string
  /** Suno audio ID of the track */
  audioId: string
  /** Model version (V4_5PLUS or V5 only) */
  model?: SunoAddTrackModel
}

export interface SunoConvertWavParams {
  /** Suno task ID of the original track */
  taskId: string
  /** Suno audio ID of the track */
  audioId: string
}

export interface SunoConvertWavResult {
  taskId: string
  audioUrl: string
}

export interface SunoUploadExtendParams {
  /** URL of uploaded audio to extend from */
  uploadUrl: string
  /** Timestamp (in seconds) to continue from */
  continueAt: number
  /** Whether to use default parameters */
  defaultParamFlag?: boolean
  /** Suno model version */
  model?: SunoModel
  /** Music style tags */
  style?: string
  /** Song title */
  title?: string
  /** Negative style tags to avoid */
  negativeStyle?: string
  /** Vocal gender */
  vocalGender?: string
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
    status: "SUCCESS" | "FIRST_SUCCESS" | "PENDING" | "PROCESSING" | "FAILED"
    response?: {
      sunoData?: Array<Record<string, unknown>>
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

  if (DEBUG) console.log(`[Suno] Generating song with model ${model}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno] Response status: ${response.status}`)
  if (DEBUG) console.log(`[Suno] Response: ${responseText.substring(0, 500)}`)

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

  if (DEBUG) console.log(`[Suno] Task created: ${taskId}`)
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

  if (DEBUG) console.log(`[Suno] Creating cover with model ${model}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/generate/upload-cover`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno] Cover response status: ${response.status}`)
  if (DEBUG) console.log(`[Suno] Cover response: ${responseText.substring(0, 500)}`)

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

  if (DEBUG) console.log(`[Suno] Cover task created: ${taskId}`)
  return pollSunoTask(taskId)
}

/**
 * Extend an existing Suno track from a specific timestamp
 */
export async function sunoExtend(
  params: SunoExtendParams
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
    audioId: params.audioId,
    defaultParamFlag: params.defaultParamFlag ?? true,
    model,
    callBackUrl: "https://callback.placeholder",
  }

  if (params.prompt) body.prompt = params.prompt
  if (params.style) body.style = params.style
  if (params.title) body.title = params.title
  if (params.continueAt != null) body.continueAt = params.continueAt
  if (params.negativeStyle) body.negativeTags = params.negativeStyle
  if (params.vocalGender) body.vocal_gender = params.vocalGender
  if (params.styleWeight != null) body.style_weight = params.styleWeight
  if (params.weirdnessConstraint != null) body.weirdness_constraint = params.weirdnessConstraint
  if (params.audioWeight != null) body.audio_weight = params.audioWeight

  if (DEBUG) console.log(`[Suno] Extending track ${params.audioId} with model ${model}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/generate/extend`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno] Extend response status: ${response.status}`)
  if (DEBUG) console.log(`[Suno] Extend response: ${responseText.substring(0, 500)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `Suno extend failed: ${response.status} - ${responseText}`,
      "Music generation"
    )
  }

  let createData: SunoCreateResponse
  try {
    createData = JSON.parse(responseText) as SunoCreateResponse
  } catch {
    throw createSanitizedError(
      `Suno extend response is not valid JSON: ${responseText}`,
      "Music generation"
    )
  }

  if (createData.code !== 0 && createData.code !== 200) {
    throw createSanitizedError(
      `Suno extend error (code ${createData.code}): ${createData.msg ?? createData.message ?? JSON.stringify(createData)}`,
      "Music generation"
    )
  }

  const taskId = createData.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `Suno extend response missing taskId: ${JSON.stringify(createData)}`,
      "Music generation"
    )
  }

  if (DEBUG) console.log(`[Suno] Extend task created: ${taskId}`)
  return pollSunoTask(taskId)
}

/**
 * Generate lyrics from a prompt via Suno (text only, not audio)
 */
export async function sunoLyrics(
  params: SunoLyricsParams
): Promise<SunoLyricsResult> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Lyrics generation"
    )
  }

  const body: Record<string, unknown> = {
    prompt: params.prompt,
    callBackUrl: "https://callback.placeholder",
  }

  if (DEBUG) console.log(`[Suno] Generating lyrics`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/lyrics`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno] Lyrics response status: ${response.status}`)
  if (DEBUG) console.log(`[Suno] Lyrics response: ${responseText.substring(0, 500)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `Suno lyrics failed: ${response.status} - ${responseText}`,
      "Lyrics generation"
    )
  }

  let createData: SunoCreateResponse
  try {
    createData = JSON.parse(responseText) as SunoCreateResponse
  } catch {
    throw createSanitizedError(
      `Suno lyrics response is not valid JSON: ${responseText}`,
      "Lyrics generation"
    )
  }

  if (createData.code !== 0 && createData.code !== 200) {
    throw createSanitizedError(
      `Suno lyrics error (code ${createData.code}): ${createData.msg ?? createData.message ?? JSON.stringify(createData)}`,
      "Lyrics generation"
    )
  }

  const taskId = createData.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `Suno lyrics response missing taskId: ${JSON.stringify(createData)}`,
      "Lyrics generation"
    )
  }

  if (DEBUG) console.log(`[Suno] Lyrics task created: ${taskId}`)
  return pollSunoLyricsTask(taskId)
}

/**
 * Poll a Suno task until completion
 */
async function pollSunoTask(taskId: string): Promise<SunoTaskResult> {
  const apiKey = config.KIE_API_KEY!

  let attempts = 0
  while (attempts < SUNO_MAX_POLL_ATTEMPTS) {
    await sleep(pollDelay(attempts))
    attempts++

    let detailResponse: Response
    try {
      detailResponse = await fetch(
        `${KIE_API_BASE}/api/v1/generate/record-info?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        console.warn(`[Suno] Poll attempt ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

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
    if (DEBUG) console.log(
      `[Suno] Task ${taskId} status: ${status ?? "unknown"} (attempt ${attempts})`
    )

    if (status === "FIRST_SUCCESS") {
      if (DEBUG) console.log(`[Suno] Task ${taskId} FIRST_SUCCESS — tracks still processing, continuing to poll`)
      continue
    }

    if (status === "SUCCESS") {
      const sunoData = detailData.data?.response?.sunoData
      if (!sunoData?.length) {
        throw createSanitizedError(
          "Suno task succeeded but no tracks returned",
          "Music generation"
        )
      }

      // Log raw track data for debugging
      if (DEBUG) console.log(`[Suno] Raw track data:`, JSON.stringify(sunoData[0], null, 2))

      const tracks: SunoTrack[] = sunoData.map((t) => {
        // Handle both audio_url and audioUrl field names
        const audioUrl = (t.audio_url ?? t.audioUrl ?? t.song_url ?? t.songUrl ?? t.url) as string | undefined
        if (!audioUrl) {
          console.error(`[Suno] Track missing audio URL. Keys: ${Object.keys(t).join(", ")}`)
          console.error(`[Suno] Full track object:`, JSON.stringify(t))
        }
        return {
          id: (t.id ?? t.taskId ?? "") as string,
          audioUrl: audioUrl ?? "",
          title: (t.title ?? t.song_name) as string | undefined,
          duration: (t.duration ?? t.song_duration) as number | undefined,
          imageUrl: (t.image_url ?? t.imageUrl ?? t.image_large_url ?? t.cover_url) as string | undefined,
        }
      })

      // Validate at least one track has a URL
      const validTracks = tracks.filter((t) => t.audioUrl)
      if (validTracks.length === 0) {
        throw createSanitizedError(
          `Suno tracks returned but none have audio URLs. Keys: ${Object.keys(sunoData[0]).join(", ")}`,
          "Music generation"
        )
      }

      if (DEBUG) console.log(
        `[Suno] Task ${taskId} completed with ${validTracks.length} valid track(s) of ${tracks.length} total`
      )
      return { taskId, tracks: validTracks }
    }

    if (status === "FAILED" || status?.includes("FAILED") || status?.includes("ERROR")) {
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

/**
 * Poll a Suno lyrics task until completion.
 * Different endpoint and response structure from pollSunoTask.
 */
async function pollSunoLyricsTask(taskId: string): Promise<SunoLyricsResult> {
  const apiKey = config.KIE_API_KEY!

  let attempts = 0
  while (attempts < SUNO_MAX_POLL_ATTEMPTS) {
    await sleep(pollDelay(attempts))
    attempts++

    let detailResponse: Response
    try {
      detailResponse = await fetch(
        `${KIE_API_BASE}/api/v1/lyrics/record-info?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        console.warn(`[Suno] Lyrics poll attempt ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

    if (!detailResponse.ok) {
      console.warn(
        `[Suno] Lyrics poll attempt ${attempts} failed: ${detailResponse.status}`
      )
      continue
    }

    const detailText = await detailResponse.text()
    let detailData: SunoRecordInfoResponse
    try {
      detailData = JSON.parse(detailText) as SunoRecordInfoResponse
    } catch {
      console.warn(`[Suno] Lyrics poll attempt ${attempts} invalid JSON`)
      continue
    }

    const status = detailData.data?.status
    if (DEBUG) console.log(
      `[Suno] Lyrics task ${taskId} status: ${status ?? "unknown"} (attempt ${attempts})`
    )

    if (status === "SUCCESS" || status === "FIRST_SUCCESS") {
      const responseData = (detailData.data?.response as Record<string, unknown>)?.data as Array<Record<string, unknown>> | undefined
      if (!responseData?.length) {
        throw createSanitizedError(
          "Suno lyrics task succeeded but no lyrics returned",
          "Lyrics generation"
        )
      }

      const lyrics = responseData.map((d) => ({
        text: (d.text ?? "") as string,
        title: (d.title ?? "") as string,
      }))

      if (DEBUG) console.log(
        `[Suno] Lyrics task ${taskId} completed with ${lyrics.length} result(s)`
      )
      return { taskId, lyrics }
    }

    if (status === "FAILED" || status?.includes("FAILED") || status?.includes("ERROR")) {
      const reason =
        detailData.data?.failReason ??
        detailData.data?.errorMessage ??
        "Unknown error"
      throw createSanitizedError(
        `Suno lyrics task failed: ${reason}`,
        "Lyrics generation"
      )
    }

    // PENDING / PROCESSING — continue polling
  }

  throw createSanitizedError(
    `Suno lyrics task timed out after ${(SUNO_MAX_POLL_ATTEMPTS * SUNO_POLL_INTERVAL_MS) / 1000} seconds`,
    "Lyrics generation"
  )
}

/**
 * Separate a Suno track into stems (vocal + instrumental, or up to 12 stems)
 */
export async function sunoSeparate(
  params: SunoSeparateParams
): Promise<SunoSeparateResult> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Stem separation"
    )
  }

  const body: Record<string, unknown> = {
    taskId: params.taskId,
    audioId: params.audioId,
    type: params.type,
    callBackUrl: "https://callback.placeholder",
  }

  if (DEBUG) console.log(`[Suno] Separating audio (type: ${params.type})`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/vocal-removal/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno] Separate response status: ${response.status}`)
  if (DEBUG) console.log(`[Suno] Separate response: ${responseText.substring(0, 500)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `Suno separate failed: ${response.status} - ${responseText}`,
      "Stem separation"
    )
  }

  let createData: SunoCreateResponse
  try {
    createData = JSON.parse(responseText) as SunoCreateResponse
  } catch {
    throw createSanitizedError(
      `Suno separate response is not valid JSON: ${responseText}`,
      "Stem separation"
    )
  }

  if (createData.code !== 0 && createData.code !== 200) {
    throw createSanitizedError(
      `Suno separate error (code ${createData.code}): ${createData.msg ?? createData.message ?? JSON.stringify(createData)}`,
      "Stem separation"
    )
  }

  const taskId = createData.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `Suno separate response missing taskId: ${JSON.stringify(createData)}`,
      "Stem separation"
    )
  }

  if (DEBUG) console.log(`[Suno] Separate task created: ${taskId}`)
  return pollSunoSeparateTask(taskId)
}

/**
 * Poll a Suno separate/stem-split task until completion.
 * Uses vocal-removal/record-info endpoint.
 * Response contains originData array with stem_type_group_name + audio_url per stem.
 */
async function pollSunoSeparateTask(taskId: string): Promise<SunoSeparateResult> {
  const apiKey = config.KIE_API_KEY!

  const STEM_NAME_MAP: Record<string, keyof SunoSeparateResult> = {
    vocals: "vocalUrl",
    instrumental: "instrumentalUrl",
    "backing vocals": "backingVocalsUrl",
    drums: "drumsUrl",
    bass: "bassUrl",
    guitar: "guitarUrl",
    piano: "pianoUrl",
    keyboard: "keyboardUrl",
    percussion: "percussionUrl",
    strings: "stringsUrl",
    synth: "synthUrl",
    fx: "fxUrl",
    brass: "brassUrl",
    woodwinds: "woodwindsUrl",
  }

  let attempts = 0
  while (attempts < SUNO_MAX_POLL_ATTEMPTS) {
    await sleep(pollDelay(attempts))
    attempts++

    let detailResponse: Response
    try {
      detailResponse = await fetch(
        `${KIE_API_BASE}/api/v1/vocal-removal/record-info?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        console.warn(`[Suno] Separate poll attempt ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

    if (!detailResponse.ok) {
      console.warn(
        `[Suno] Separate poll attempt ${attempts} failed: ${detailResponse.status}`
      )
      continue
    }

    const detailText = await detailResponse.text()
    let detailData: Record<string, unknown>
    try {
      detailData = JSON.parse(detailText) as Record<string, unknown>
    } catch {
      console.warn(`[Suno] Separate poll attempt ${attempts} invalid JSON`)
      continue
    }

    const data = detailData.data as Record<string, unknown> | undefined
    const status = data?.status as string | undefined
    const resp = data?.response as Record<string, unknown> | undefined
    const originData = resp?.originData as Array<Record<string, unknown>> | undefined

    if (DEBUG) console.log(
      `[Suno] Separate task ${taskId} status: ${status ?? "unknown"} (attempt ${attempts})`
    )
    if (DEBUG) console.log(`[Suno] Separate raw response:`, JSON.stringify(detailData).substring(0, 500))

    // Check for failure statuses
    if (status === "FAILED" || status?.includes("FAILED") || status?.includes("ERROR")) {
      const reason =
        data?.failReason ??
        data?.errorMessage ??
        "Unknown error"
      throw createSanitizedError(
        `Suno separate task failed: ${reason}`,
        "Stem separation"
      )
    }

    // Success: originData is a non-empty array of stems
    if (originData && originData.length > 0) {
      const result: SunoSeparateResult = { taskId }

      for (const stem of originData) {
        const stemName = (stem.stem_type_group_name as string | undefined)?.toLowerCase()
        const audioUrl = stem.audio_url as string | undefined
        if (!stemName || !audioUrl) continue

        const resultKey = STEM_NAME_MAP[stemName]
        if (resultKey) {
          ;(result as unknown as Record<string, unknown>)[resultKey] = audioUrl
        }
      }

      const stemCount = Object.values(result).filter((v) => typeof v === "string" && v.startsWith("http")).length
      if (DEBUG) console.log(
        `[Suno] Separate task ${taskId} completed with ${stemCount} stem(s)`
      )
      return result
    }

    // originData missing or empty — still pending, continue polling
  }

  throw createSanitizedError(
    `Suno separate task timed out after ${(SUNO_MAX_POLL_ATTEMPTS * SUNO_POLL_INTERVAL_MS) / 1000} seconds`,
    "Stem separation"
  )
}

// =============================================================================
// MUSIC VIDEO
// =============================================================================

/**
 * Generate a music video from a Suno track via KIE.ai.
 * Endpoint: POST /api/v1/mp4/generate
 */
export async function sunoMusicVideo(
  params: SunoMusicVideoParams
): Promise<SunoMusicVideoResult> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Music video generation"
    )
  }

  const body: Record<string, unknown> = {
    taskId: params.taskId,
    audioId: params.audioId,
    callBackUrl: "https://callback.placeholder",
  }

  if (DEBUG) console.log(`[Suno] Generating music video for task ${params.taskId}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/mp4/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno] Music video response status: ${response.status}`)
  if (DEBUG) console.log(`[Suno] Music video response: ${responseText.substring(0, 500)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `Suno music video failed: ${response.status} - ${responseText}`,
      "Music video generation"
    )
  }

  let createData: SunoCreateResponse
  try {
    createData = JSON.parse(responseText) as SunoCreateResponse
  } catch {
    throw createSanitizedError(
      `Suno music video response is not valid JSON: ${responseText}`,
      "Music video generation"
    )
  }

  if (createData.code !== 0 && createData.code !== 200) {
    throw createSanitizedError(
      `Suno music video error (code ${createData.code}): ${createData.msg ?? createData.message ?? JSON.stringify(createData)}`,
      "Music video generation"
    )
  }

  const taskId = createData.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `Suno music video response missing taskId: ${JSON.stringify(createData)}`,
      "Music video generation"
    )
  }

  if (DEBUG) console.log(`[Suno] Music video task created: ${taskId}`)
  return pollSunoMusicVideoTask(taskId)
}

/**
 * Poll a Suno music video task until completion.
 * Uses mp4/record-info endpoint.
 */
async function pollSunoMusicVideoTask(taskId: string): Promise<SunoMusicVideoResult> {
  const apiKey = config.KIE_API_KEY!

  for (let attempts = 1; attempts <= SUNO_MAX_POLL_ATTEMPTS; attempts++) {
    await sleep(pollDelay(attempts))

    let detailResponse: Response
    try {
      detailResponse = await fetch(
        `${KIE_API_BASE}/api/v1/mp4/record-info?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        console.warn(`[Suno] Music video poll attempt ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

    if (!detailResponse.ok) {
      console.warn(`[Suno] Music video poll attempt ${attempts} HTTP ${detailResponse.status} for taskId=${taskId}`)
      continue
    }

    const detailText = await detailResponse.text()
    let detailData: Record<string, unknown>
    try {
      detailData = JSON.parse(detailText) as Record<string, unknown>
    } catch {
      console.warn(`[Suno] Music video poll attempt ${attempts} invalid JSON`)
      continue
    }

    const data = detailData.data as Record<string, unknown> | undefined
    const status = data?.status as string | undefined
    const resp = data?.response as Record<string, unknown> | undefined

    if (DEBUG) console.log(
      `[Suno] Music video task ${taskId} status: ${status ?? "unknown"} (attempt ${attempts})`
    )
    if (DEBUG) console.log(`[Suno] Music video raw response:`, JSON.stringify(detailData).substring(0, 500))

    // Check for failure statuses
    if (status === "FAILED" || status?.includes("FAILED") || status?.includes("ERROR")) {
      const reason =
        data?.failReason ??
        data?.errorMessage ??
        "Unknown error"
      throw createSanitizedError(
        `Suno music video task failed: ${reason}`,
        "Music video generation"
      )
    }

    // Success: look for videoUrl in response
    const videoUrl = (resp?.videoUrl ?? resp?.video_url ?? resp?.mp4Url ?? resp?.mp4_url) as string | undefined
    if (videoUrl) {
      if (DEBUG) console.log(`[Suno] Music video task ${taskId} completed`)
      return { taskId, videoUrl }
    }

    // Check top-level success status with response data
    if ((status === "SUCCESS" || status === "FIRST_SUCCESS") && resp) {
      // Try to find a video URL in any field
      const possibleUrl = Object.values(resp).find(
        (v) => typeof v === "string" && (v.endsWith(".mp4") || v.includes("mp4"))
      ) as string | undefined
      if (possibleUrl) {
        if (DEBUG) console.log(`[Suno] Music video task ${taskId} completed (from status)`)
        return { taskId, videoUrl: possibleUrl }
      }
    }
  }

  throw createSanitizedError(
    `Suno music video task timed out after ${(SUNO_MAX_POLL_ATTEMPTS * SUNO_POLL_INTERVAL_MS) / 1000} seconds`,
    "Music video generation"
  )
}

// =============================================================================
// MASHUP
// =============================================================================

/**
 * Combine 2 tracks into a mashup via KIE.ai Suno API.
 * Endpoint: POST /api/v1/generate/mashup
 */
export async function sunoMashup(
  params: SunoMashupParams
): Promise<SunoTaskResult> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Music mashup"
    )
  }

  const model = params.model ?? "V5"

  const body: Record<string, unknown> = {
    upload_url_list: params.uploadUrlList,
    model,
    customMode: params.customMode ?? false,
    callBackUrl: "https://callback.placeholder",
  }

  if (params.style) body.style = params.style
  if (params.title) body.title = params.title
  if (params.negativeStyle) body.negative_style = params.negativeStyle
  if (params.vocalGender) body.vocal_gender = params.vocalGender

  if (DEBUG) console.log(`[Suno] Creating mashup with model ${model}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/generate/mashup`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno] Mashup response status: ${response.status}`)
  if (DEBUG) console.log(`[Suno] Mashup response: ${responseText.substring(0, 500)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `Suno mashup failed: ${response.status} - ${responseText}`,
      "Music mashup"
    )
  }

  let createData: SunoCreateResponse
  try {
    createData = JSON.parse(responseText) as SunoCreateResponse
  } catch {
    throw createSanitizedError(
      `Suno mashup response is not valid JSON: ${responseText}`,
      "Music mashup"
    )
  }

  if (createData.code !== 0 && createData.code !== 200) {
    throw createSanitizedError(
      `Suno mashup error (code ${createData.code}): ${createData.msg ?? createData.message ?? JSON.stringify(createData)}`,
      "Music mashup"
    )
  }

  const taskId = createData.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `Suno mashup response missing taskId: ${JSON.stringify(createData)}`,
      "Music mashup"
    )
  }

  if (DEBUG) console.log(`[Suno] Mashup task created: ${taskId}`)
  return pollSunoTask(taskId)
}

// =============================================================================
// REPLACE SECTION
// =============================================================================

/**
 * Replace a section of an existing Suno track.
 * Endpoint: POST /api/v1/generate/replace-section
 */
export async function sunoReplaceSection(
  params: SunoReplaceSectionParams
): Promise<SunoTaskResult> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Replace section"
    )
  }

  const body: Record<string, unknown> = {
    taskId: params.taskId,
    audioId: params.audioId,
    infill_start_s: params.infillStartS,
    infill_end_s: params.infillEndS,
    prompt: params.prompt,
    tags: params.tags,
    callBackUrl: "https://callback.placeholder",
  }

  if (params.title) body.title = params.title

  if (DEBUG) console.log(`[Suno] Replacing section for task ${params.taskId}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/generate/replace-section`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno] Replace section response status: ${response.status}`)
  if (DEBUG) console.log(`[Suno] Replace section response: ${responseText.substring(0, 500)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `Suno replace section failed: ${response.status} - ${responseText}`,
      "Replace section"
    )
  }

  let createData: SunoCreateResponse
  try {
    createData = JSON.parse(responseText) as SunoCreateResponse
  } catch {
    throw createSanitizedError(
      `Suno replace section response is not valid JSON: ${responseText}`,
      "Replace section"
    )
  }

  if (createData.code !== 0 && createData.code !== 200) {
    throw createSanitizedError(
      `Suno replace section error (code ${createData.code}): ${createData.msg ?? createData.message ?? JSON.stringify(createData)}`,
      "Replace section"
    )
  }

  const taskId = createData.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `Suno replace section response missing taskId: ${JSON.stringify(createData)}`,
      "Replace section"
    )
  }

  if (DEBUG) console.log(`[Suno] Replace section task created: ${taskId}`)
  return pollSunoTask(taskId)
}

// =============================================================================
// STYLE BOOST (SYNCHRONOUS)
// =============================================================================

/**
 * Enhance style text via Suno style boost.
 * Endpoint: POST /api/v1/style/generate — synchronous, returns immediately.
 */
export async function sunoStyleBoost(
  params: SunoStyleBoostParams
): Promise<SunoStyleBoostResult> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Style boost"
    )
  }

  const body: Record<string, unknown> = {
    content: params.content,
  }

  if (DEBUG) console.log(`[Suno] Style boost request`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/style/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno] Style boost response status: ${response.status}`)
  if (DEBUG) console.log(`[Suno] Style boost response: ${responseText.substring(0, 500)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `Suno style boost failed: ${response.status} - ${responseText}`,
      "Style boost"
    )
  }

  let responseData: Record<string, unknown>
  try {
    responseData = JSON.parse(responseText) as Record<string, unknown>
  } catch {
    throw createSanitizedError(
      `Suno style boost response is not valid JSON: ${responseText}`,
      "Style boost"
    )
  }

  if ((responseData.code as number) !== 0 && (responseData.code as number) !== 200) {
    throw createSanitizedError(
      `Suno style boost error (code ${responseData.code}): ${(responseData.msg ?? responseData.message ?? JSON.stringify(responseData)) as string}`,
      "Style boost"
    )
  }

  // Extract text from the response data
  const data = responseData.data as Record<string, unknown> | string | undefined
  let text: string
  if (typeof data === "string") {
    text = data
  } else if (data && typeof data === "object") {
    text = ((data as Record<string, unknown>).text ?? (data as Record<string, unknown>).style ?? (data as Record<string, unknown>).content ?? JSON.stringify(data)) as string
  } else {
    text = JSON.stringify(responseData.data ?? responseData)
  }

  if (DEBUG) console.log(`[Suno] Style boost completed: ${text.substring(0, 100)}...`)
  return { text }
}

// =============================================================================
// ADD INSTRUMENTAL
// =============================================================================

/**
 * Add instrumental track to a Suno song.
 * Endpoint: POST /api/v1/generate/add-instrumental
 */
export async function sunoAddInstrumental(
  params: SunoAddInstrumentalParams
): Promise<SunoTaskResult> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Add instrumental"
    )
  }

  const model = params.model ?? "V5"

  const body: Record<string, unknown> = {
    taskId: params.taskId,
    audioId: params.audioId,
    model,
    callBackUrl: "https://callback.placeholder",
  }

  if (DEBUG) console.log(`[Suno] Adding instrumental to task ${params.taskId}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/generate/add-instrumental`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno] Add instrumental response status: ${response.status}`)
  if (DEBUG) console.log(`[Suno] Add instrumental response: ${responseText.substring(0, 500)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `Suno add instrumental failed: ${response.status} - ${responseText}`,
      "Add instrumental"
    )
  }

  let createData: SunoCreateResponse
  try {
    createData = JSON.parse(responseText) as SunoCreateResponse
  } catch {
    throw createSanitizedError(
      `Suno add instrumental response is not valid JSON: ${responseText}`,
      "Add instrumental"
    )
  }

  if (createData.code !== 0 && createData.code !== 200) {
    throw createSanitizedError(
      `Suno add instrumental error (code ${createData.code}): ${createData.msg ?? createData.message ?? JSON.stringify(createData)}`,
      "Add instrumental"
    )
  }

  const taskId = createData.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `Suno add instrumental response missing taskId: ${JSON.stringify(createData)}`,
      "Add instrumental"
    )
  }

  if (DEBUG) console.log(`[Suno] Add instrumental task created: ${taskId}`)
  return pollSunoTask(taskId)
}

// =============================================================================
// ADD VOCALS
// =============================================================================

/**
 * Add vocals to a Suno song.
 * Endpoint: POST /api/v1/generate/add-vocals
 */
export async function sunoAddVocals(
  params: SunoAddVocalsParams
): Promise<SunoTaskResult> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Add vocals"
    )
  }

  const model = params.model ?? "V5"

  const body: Record<string, unknown> = {
    taskId: params.taskId,
    audioId: params.audioId,
    model,
    callBackUrl: "https://callback.placeholder",
  }

  if (DEBUG) console.log(`[Suno] Adding vocals to task ${params.taskId}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/generate/add-vocals`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno] Add vocals response status: ${response.status}`)
  if (DEBUG) console.log(`[Suno] Add vocals response: ${responseText.substring(0, 500)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `Suno add vocals failed: ${response.status} - ${responseText}`,
      "Add vocals"
    )
  }

  let createData: SunoCreateResponse
  try {
    createData = JSON.parse(responseText) as SunoCreateResponse
  } catch {
    throw createSanitizedError(
      `Suno add vocals response is not valid JSON: ${responseText}`,
      "Add vocals"
    )
  }

  if (createData.code !== 0 && createData.code !== 200) {
    throw createSanitizedError(
      `Suno add vocals error (code ${createData.code}): ${createData.msg ?? createData.message ?? JSON.stringify(createData)}`,
      "Add vocals"
    )
  }

  const taskId = createData.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `Suno add vocals response missing taskId: ${JSON.stringify(createData)}`,
      "Add vocals"
    )
  }

  if (DEBUG) console.log(`[Suno] Add vocals task created: ${taskId}`)
  return pollSunoTask(taskId)
}

// =============================================================================
// CONVERT WAV
// =============================================================================

/**
 * Convert a Suno track to WAV format.
 * Endpoint: POST /api/v1/wav/generate
 * Poll: GET /api/v1/wav/record-info?taskId=
 */
export async function sunoConvertWav(
  params: SunoConvertWavParams
): Promise<SunoConvertWavResult> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "WAV conversion"
    )
  }

  const body: Record<string, unknown> = {
    taskId: params.taskId,
    audioId: params.audioId,
    callBackUrl: "https://callback.placeholder",
  }

  if (DEBUG) console.log(`[Suno] Converting to WAV for task ${params.taskId}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/wav/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno] WAV convert response status: ${response.status}`)
  if (DEBUG) console.log(`[Suno] WAV convert response: ${responseText.substring(0, 500)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `Suno WAV convert failed: ${response.status} - ${responseText}`,
      "WAV conversion"
    )
  }

  let createData: SunoCreateResponse
  try {
    createData = JSON.parse(responseText) as SunoCreateResponse
  } catch {
    throw createSanitizedError(
      `Suno WAV convert response is not valid JSON: ${responseText}`,
      "WAV conversion"
    )
  }

  if (createData.code !== 0 && createData.code !== 200) {
    throw createSanitizedError(
      `Suno WAV convert error (code ${createData.code}): ${createData.msg ?? createData.message ?? JSON.stringify(createData)}`,
      "WAV conversion"
    )
  }

  const taskId = createData.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `Suno WAV convert response missing taskId: ${JSON.stringify(createData)}`,
      "WAV conversion"
    )
  }

  if (DEBUG) console.log(`[Suno] WAV convert task created: ${taskId}`)
  return pollSunoWavTask(taskId)
}

/**
 * Poll a Suno WAV conversion task until completion.
 * Uses wav/record-info endpoint (similar to mp4/record-info).
 */
async function pollSunoWavTask(taskId: string): Promise<SunoConvertWavResult> {
  const apiKey = config.KIE_API_KEY!

  for (let attempts = 1; attempts <= SUNO_MAX_POLL_ATTEMPTS; attempts++) {
    await sleep(pollDelay(attempts))

    let detailResponse: Response
    try {
      detailResponse = await fetch(
        `${KIE_API_BASE}/api/v1/wav/record-info?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        if (DEBUG) console.log(`[Suno] WAV poll attempt ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

    const detailText = await detailResponse.text()
    let detailData: Record<string, unknown>
    try {
      detailData = JSON.parse(detailText) as Record<string, unknown>
    } catch {
      console.warn(`[Suno] WAV poll attempt ${attempts} invalid JSON`)
      continue
    }

    const data = detailData.data as Record<string, unknown> | undefined
    const status = data?.status as string | undefined
    const resp = data?.response as Record<string, unknown> | undefined

    if (DEBUG) console.log(
      `[Suno] WAV task ${taskId} status: ${status ?? "unknown"} (attempt ${attempts})`
    )
    if (DEBUG) console.log(`[Suno] WAV raw response:`, JSON.stringify(detailData).substring(0, 500))

    // Check for failure statuses
    if (status === "FAILED" || status?.includes("FAILED") || status?.includes("ERROR")) {
      const reason =
        data?.failReason ??
        data?.errorMessage ??
        "Unknown error"
      throw createSanitizedError(
        `Suno WAV task failed: ${reason}`,
        "WAV conversion"
      )
    }

    // Success: look for audioUrl / wav_url in response
    const audioUrl = (resp?.audioUrl ?? resp?.audio_url ?? resp?.wavUrl ?? resp?.wav_url) as string | undefined
    if (audioUrl) {
      if (DEBUG) console.log(`[Suno] WAV task ${taskId} completed`)
      return { taskId, audioUrl }
    }

    // Check top-level success status with response data
    if ((status === "SUCCESS" || status === "FIRST_SUCCESS") && resp) {
      const possibleUrl = Object.values(resp).find(
        (v) => typeof v === "string" && (v.endsWith(".wav") || v.includes("wav") || v.startsWith("http"))
      ) as string | undefined
      if (possibleUrl) {
        if (DEBUG) console.log(`[Suno] WAV task ${taskId} completed (from status)`)
        return { taskId, audioUrl: possibleUrl }
      }
    }
  }

  throw createSanitizedError(
    `Suno WAV task timed out after ${(SUNO_MAX_POLL_ATTEMPTS * SUNO_POLL_INTERVAL_MS) / 1000} seconds`,
    "WAV conversion"
  )
}

// =============================================================================
// UPLOAD EXTEND
// =============================================================================

/**
 * Extend from uploaded audio via KIE.ai Suno API.
 * Endpoint: POST /api/v1/generate/upload-extend
 */
export async function sunoUploadExtend(
  params: SunoUploadExtendParams
): Promise<SunoTaskResult> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      "Upload extend"
    )
  }

  const model = params.model ?? "V5"

  const body: Record<string, unknown> = {
    upload_url: params.uploadUrl,
    continueAt: params.continueAt,
    defaultParamFlag: params.defaultParamFlag ?? false,
    model,
    callBackUrl: "https://callback.placeholder",
  }

  if (params.style) body.style = params.style
  if (params.title) body.title = params.title
  if (params.negativeStyle) body.negative_style = params.negativeStyle
  if (params.vocalGender) body.vocal_gender = params.vocalGender

  if (DEBUG) console.log(`[Suno] Upload extend with model ${model}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const response = await fetch(
    `${KIE_API_BASE}/api/v1/generate/upload-extend`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  )

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno] Upload extend response status: ${response.status}`)
  if (DEBUG) console.log(`[Suno] Upload extend response: ${responseText.substring(0, 500)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `Suno upload extend failed: ${response.status} - ${responseText}`,
      "Upload extend"
    )
  }

  let createData: SunoCreateResponse
  try {
    createData = JSON.parse(responseText) as SunoCreateResponse
  } catch {
    throw createSanitizedError(
      `Suno upload extend response is not valid JSON: ${responseText}`,
      "Upload extend"
    )
  }

  if (createData.code !== 0 && createData.code !== 200) {
    throw createSanitizedError(
      `Suno upload extend error (code ${createData.code}): ${createData.msg ?? createData.message ?? JSON.stringify(createData)}`,
      "Upload extend"
    )
  }

  const taskId = createData.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `Suno upload extend response missing taskId: ${JSON.stringify(createData)}`,
      "Upload extend"
    )
  }

  if (DEBUG) console.log(`[Suno] Upload extend task created: ${taskId}`)
  return pollSunoTask(taskId)
}
