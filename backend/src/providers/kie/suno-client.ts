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
import { throwIfJobCancelled } from "../../lib/job-cancellation.js"
import { KIE_API_BASE, createSanitizedError, sleep, pollDelay } from "./client.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import type { ReconcileOpts } from "../provider.interface.js"
import type { SunoModel, SunoAddTrackModel } from "@nodaro/shared"

export type { SunoModel, SunoAddTrackModel }

// =============================================================================
// CONSTANTS
// =============================================================================

const SUNO_POLL_INTERVAL_MS = 5000 // kept for timeout calculations
const DEBUG = config.NODE_ENV === "development"
const SUNO_MAX_POLL_ATTEMPTS = 60 // 5 minutes (60 * 5s)

// =============================================================================
// TYPES
// =============================================================================


export type SunoPersonaModel = "voice_persona" | "style_persona"

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
  /** Custom voice persona id (from /api/v1/voice/generate). Sent as `personaId`. */
  personaId?: string
  /** Persona kind. Defaults to "voice_persona" when personaId is set. */
  personaModel?: SunoPersonaModel
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
  /** Custom voice persona id (from /api/v1/voice/generate). Sent as `personaId`. */
  personaId?: string
  /** Persona kind. Defaults to "voice_persona" when personaId is set. */
  personaModel?: SunoPersonaModel
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
  /** Custom voice persona id (from /api/v1/voice/generate). Sent as `personaId`. */
  personaId?: string
  /** Persona kind. Defaults to "voice_persona" when personaId is set. */
  personaModel?: SunoPersonaModel
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
// SHARED HELPERS
// =============================================================================

interface CreateSunoTaskOpts {
  /** API path after KIE_API_BASE, e.g. "/api/v1/generate" */
  path: string
  /** Request body (already fully constructed by the caller) */
  body: Record<string, unknown>
  /** Operation word used in failed/error/missing-taskId messages, e.g. "generate" */
  opName: string
  /** createSanitizedError 2nd arg, e.g. "Music generation" */
  label: string
  reconcileOpts?: ReconcileOpts
  /**
   * Operation word for the "is not valid JSON" message. Defaults to `opName`.
   * sunoGenerate is the lone caller that omits it (bare "Suno response is not
   * valid JSON") — it passes "".
   */
  jsonOpName?: string
  /**
   * Prefix for the response-status / response / task-created DEBUG logs.
   * "" produces the bare "Response status" / "Response:" / "Task created:" form
   * used by sunoGenerate; any other value produces
   * "<DebugLabel> response status" / "<DebugLabel> response:" /
   * "<DebugLabel> task created:".
   */
  debugLabel: string
}

/**
 * Shared create-task preamble for the Suno endpoints that POST a body, parse a
 * `{ code, data: { taskId } }` envelope, fire the reconciliation hook, and then
 * poll. Returns the validated taskId. Behavior-preserving: reconstructs each
 * caller's exact error strings via `opName` / `jsonOpName` and DEBUG logs via
 * `debugLabel`.
 */
async function createSunoTask(opts: CreateSunoTaskOpts): Promise<string> {
  const { path, body, opName, label, reconcileOpts, debugLabel } = opts
  const jsonOpName = opts.jsonOpName ?? opName

  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(
      "KIE_API_KEY is not configured",
      label
    )
  }

  const response = await fetch(
    `${KIE_API_BASE}${path}`,
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
  if (DEBUG) console.log(
    debugLabel === ""
      ? `[Suno] Response status: ${response.status}`
      : `[Suno] ${debugLabel} response status: ${response.status}`
  )
  if (DEBUG) console.log(
    debugLabel === ""
      ? `[Suno] Response: ${responseText.substring(0, 500)}`
      : `[Suno] ${debugLabel} response: ${responseText.substring(0, 500)}`
  )

  if (!response.ok) {
    throw createSanitizedError(
      `Suno ${opName} failed: ${response.status} - ${responseText}`,
      label
    )
  }

  let createData: SunoCreateResponse
  try {
    createData = JSON.parse(responseText) as SunoCreateResponse
  } catch {
    throw createSanitizedError(
      jsonOpName === ""
        ? `Suno response is not valid JSON: ${responseText}`
        : `Suno ${jsonOpName} response is not valid JSON: ${responseText}`,
      label
    )
  }

  if (createData.code !== 0 && createData.code !== 200) {
    throw createSanitizedError(
      `Suno ${opName} error (code ${createData.code}): ${createData.msg ?? createData.message ?? JSON.stringify(createData)}`,
      label
    )
  }

  const taskId = createData.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `Suno ${opName} response missing taskId: ${JSON.stringify(createData)}`,
      label
    )
  }

  if (DEBUG) console.log(
    debugLabel === ""
      ? `[Suno] Task created: ${taskId}`
      : `[Suno] ${debugLabel} task created: ${taskId}`
  )

  await fireOnTaskCreated(reconcileOpts, taskId, "[Suno]")

  return taskId
}

interface PollSunoEndpointOpts<T> {
  /** record-info path after KIE_API_BASE, e.g. "/api/v1/generate/record-info" */
  path: string
  /**
   * Warn-log prefix for the timeout / HTTP-failure / invalid-JSON poll logs.
   * "Poll attempt" for the music poller; "<X> poll attempt" for the others.
   */
  warnPrefix: string
  /** Full "timed out after N seconds" internal message string. */
  timeoutMessage: string
  /** createSanitizedError 2nd arg for the timeout throw. */
  timeoutLabel: string
  /**
   * Per-iteration handler. Receives the fully parsed record-info JSON and the
   * 1-based attempt number. Returns the result to stop polling, or a
   * falsy value (undefined) to keep polling. May throw to fail the task.
   */
  onSuccess: (parsed: Record<string, unknown>, attempts: number) => T | undefined
}

/**
 * Shared poll loop for the Suno record-info endpoints that use the
 * while-attempts / increment-after-sleep shape with `console.warn` retry
 * logging and a `!ok` continue guard (pollSunoTask / pollSunoLyricsTask /
 * pollSunoSeparateTask). The caller's `onSuccess` owns all status-specific
 * logging, success extraction, and FAILED throwing. Behavior-preserving.
 *
 * NOT used by pollSunoMusicVideoTask / pollSunoWavTask — those use a different
 * `for`-loop / `!ok` / timeout-logging shape and stay hand-written.
 */
async function pollSunoEndpoint<T>(
  taskId: string,
  opts: PollSunoEndpointOpts<T>
): Promise<T> {
  const apiKey = config.KIE_API_KEY!
  const { path, warnPrefix, onSuccess } = opts

  let attempts = 0
  while (attempts < SUNO_MAX_POLL_ATTEMPTS) {
    await throwIfJobCancelled()
    await sleep(pollDelay(attempts))
    attempts++

    let detailResponse: Response
    try {
      detailResponse = await fetch(
        `${KIE_API_BASE}${path}?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        console.warn(`[Suno] ${warnPrefix} ${attempts} timeout, retrying...`)
        continue
      }
      throw err
    }

    if (!detailResponse.ok) {
      console.warn(
        `[Suno] ${warnPrefix} ${attempts} failed: ${detailResponse.status}`
      )
      continue
    }

    const detailText = await detailResponse.text()
    let detailData: Record<string, unknown>
    try {
      detailData = JSON.parse(detailText) as Record<string, unknown>
    } catch {
      console.warn(`[Suno] ${warnPrefix} ${attempts} invalid JSON`)
      continue
    }

    const result = onSuccess(detailData, attempts)
    if (result) return result

    // not done yet — continue polling
  }

  throw createSanitizedError(opts.timeoutMessage, opts.timeoutLabel)
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

/**
 * Generate a song with Suno via KIE.ai
 */
export async function sunoGenerate(
  params: SunoGenerateParams,
  reconcileOpts?: ReconcileOpts,
): Promise<SunoTaskResult> {
  const model = params.model ?? "V5_5"

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
  if (params.personaId) {
    body.personaId = params.personaId
    body.personaModel = params.personaModel ?? "voice_persona"
  }

  if (DEBUG) console.log(`[Suno] Generating song with model ${model}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const taskId = await createSunoTask({
    path: "/api/v1/generate",
    body,
    opName: "generate",
    label: "Music generation",
    reconcileOpts,
    jsonOpName: "",
    debugLabel: "",
  })

  return pollSunoTask(taskId)
}

/**
 * Create a cover version of an existing audio track
 */
export async function sunoCover(
  params: SunoCoverParams,
  reconcileOpts?: ReconcileOpts,
): Promise<SunoTaskResult> {
  const model = params.model ?? "V5_5"

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
  if (params.personaId) {
    body.personaId = params.personaId
    body.personaModel = params.personaModel ?? "voice_persona"
  }

  if (DEBUG) console.log(`[Suno] Creating cover with model ${model}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const taskId = await createSunoTask({
    path: "/api/v1/generate/upload-cover",
    body,
    opName: "cover",
    label: "Music generation",
    reconcileOpts,
    debugLabel: "Cover",
  })

  return pollSunoTask(taskId)
}

/**
 * Extend an existing Suno track from a specific timestamp
 */
export async function sunoExtend(
  params: SunoExtendParams,
  reconcileOpts?: ReconcileOpts,
): Promise<SunoTaskResult> {
  const model = params.model ?? "V5_5"

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
  if (params.personaId) {
    body.personaId = params.personaId
    body.personaModel = params.personaModel ?? "voice_persona"
  }

  if (DEBUG) console.log(`[Suno] Extending track ${params.audioId} with model ${model}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const taskId = await createSunoTask({
    path: "/api/v1/generate/extend",
    body,
    opName: "extend",
    label: "Music generation",
    reconcileOpts,
    debugLabel: "Extend",
  })

  return pollSunoTask(taskId)
}

/**
 * Generate lyrics from a prompt via Suno (text only, not audio)
 */
export async function sunoLyrics(
  params: SunoLyricsParams,
  reconcileOpts?: ReconcileOpts,
): Promise<SunoLyricsResult> {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    callBackUrl: "https://callback.placeholder",
  }

  if (DEBUG) console.log(`[Suno] Generating lyrics`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const taskId = await createSunoTask({
    path: "/api/v1/lyrics",
    body,
    opName: "lyrics",
    label: "Lyrics generation",
    reconcileOpts,
    debugLabel: "Lyrics",
  })

  return pollSunoLyricsTask(taskId)
}

/**
 * Poll a Suno music task (sunoGenerate/Cover/Extend/Mashup/ReplaceSection/
 * AddInstrumental/AddVocals/UploadExtend — all share the same SunoTaskResult
 * shape). Exported so reconciliation handlers can resume polling a stuck task.
 *
 * NOT applicable to sunoLyrics / sunoSeparate / sunoMusicVideo / sunoConvertWav
 * — those have different return shapes and stay internal.
 */
export async function pollSunoTask(taskId: string): Promise<SunoTaskResult> {
  return pollSunoEndpoint<SunoTaskResult>(taskId, {
    path: "/api/v1/generate/record-info",
    warnPrefix: "Poll attempt",
    timeoutMessage: `Suno task timed out after ${(SUNO_MAX_POLL_ATTEMPTS * SUNO_POLL_INTERVAL_MS) / 1000} seconds`,
    timeoutLabel: "Music generation",
    onSuccess: (parsed, attempts) => {
      const detailData = parsed as unknown as SunoRecordInfoResponse

      const status = detailData.data?.status
      if (DEBUG) console.log(
        `[Suno] Task ${taskId} status: ${status ?? "unknown"} (attempt ${attempts})`
      )

      if (status === "FIRST_SUCCESS") {
        if (DEBUG) console.log(`[Suno] Task ${taskId} FIRST_SUCCESS — tracks still processing, continuing to poll`)
        return undefined
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
      return undefined
    },
  })
}

/**
 * Poll a Suno lyrics task until completion.
 * Different endpoint and response structure from pollSunoTask.
 */
async function pollSunoLyricsTask(taskId: string): Promise<SunoLyricsResult> {
  return pollSunoEndpoint<SunoLyricsResult>(taskId, {
    path: "/api/v1/lyrics/record-info",
    warnPrefix: "Lyrics poll attempt",
    timeoutMessage: `Suno lyrics task timed out after ${(SUNO_MAX_POLL_ATTEMPTS * SUNO_POLL_INTERVAL_MS) / 1000} seconds`,
    timeoutLabel: "Lyrics generation",
    onSuccess: (parsed, attempts) => {
      const detailData = parsed as unknown as SunoRecordInfoResponse

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
      return undefined
    },
  })
}

/**
 * Separate a Suno track into stems (vocal + instrumental, or up to 12 stems)
 */
export async function sunoSeparate(
  params: SunoSeparateParams,
  reconcileOpts?: ReconcileOpts,
): Promise<SunoSeparateResult> {
  const body: Record<string, unknown> = {
    taskId: params.taskId,
    audioId: params.audioId,
    type: params.type,
    callBackUrl: "https://callback.placeholder",
  }

  if (DEBUG) console.log(`[Suno] Separating audio (type: ${params.type})`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const taskId = await createSunoTask({
    path: "/api/v1/vocal-removal/generate",
    body,
    opName: "separate",
    label: "Stem separation",
    reconcileOpts,
    debugLabel: "Separate",
  })

  return pollSunoSeparateTask(taskId)
}

/**
 * Poll a Suno separate/stem-split task until completion.
 * Uses vocal-removal/record-info endpoint.
 * Response contains originData array with stem_type_group_name + audio_url per stem.
 */
async function pollSunoSeparateTask(taskId: string): Promise<SunoSeparateResult> {
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

  return pollSunoEndpoint<SunoSeparateResult>(taskId, {
    path: "/api/v1/vocal-removal/record-info",
    warnPrefix: "Separate poll attempt",
    timeoutMessage: `Suno separate task timed out after ${(SUNO_MAX_POLL_ATTEMPTS * SUNO_POLL_INTERVAL_MS) / 1000} seconds`,
    timeoutLabel: "Stem separation",
    onSuccess: (detailData, attempts) => {
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
      return undefined
    },
  })
}

// =============================================================================
// MUSIC VIDEO
// =============================================================================

/**
 * Generate a music video from a Suno track via KIE.ai.
 * Endpoint: POST /api/v1/mp4/generate
 */
export async function sunoMusicVideo(
  params: SunoMusicVideoParams,
  reconcileOpts?: ReconcileOpts,
): Promise<SunoMusicVideoResult> {
  const body: Record<string, unknown> = {
    taskId: params.taskId,
    audioId: params.audioId,
    callBackUrl: "https://callback.placeholder",
  }

  if (DEBUG) console.log(`[Suno] Generating music video for task ${params.taskId}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const taskId = await createSunoTask({
    path: "/api/v1/mp4/generate",
    body,
    opName: "music video",
    label: "Music video generation",
    reconcileOpts,
    debugLabel: "Music video",
  })

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
  params: SunoMashupParams,
  reconcileOpts?: ReconcileOpts,
): Promise<SunoTaskResult> {
  const model = params.model ?? "V5_5"

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

  const taskId = await createSunoTask({
    path: "/api/v1/generate/mashup",
    body,
    opName: "mashup",
    label: "Music mashup",
    reconcileOpts,
    debugLabel: "Mashup",
  })

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
  params: SunoReplaceSectionParams,
  reconcileOpts?: ReconcileOpts,
): Promise<SunoTaskResult> {
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

  const taskId = await createSunoTask({
    path: "/api/v1/generate/replace-section",
    body,
    opName: "replace section",
    label: "Replace section",
    reconcileOpts,
    debugLabel: "Replace section",
  })

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
  params: SunoAddInstrumentalParams,
  reconcileOpts?: ReconcileOpts,
): Promise<SunoTaskResult> {
  const model = params.model ?? "V5_5"

  const body: Record<string, unknown> = {
    taskId: params.taskId,
    audioId: params.audioId,
    model,
    callBackUrl: "https://callback.placeholder",
  }

  if (DEBUG) console.log(`[Suno] Adding instrumental to task ${params.taskId}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const taskId = await createSunoTask({
    path: "/api/v1/generate/add-instrumental",
    body,
    opName: "add instrumental",
    label: "Add instrumental",
    reconcileOpts,
    debugLabel: "Add instrumental",
  })

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
  params: SunoAddVocalsParams,
  reconcileOpts?: ReconcileOpts,
): Promise<SunoTaskResult> {
  const model = params.model ?? "V5_5"

  const body: Record<string, unknown> = {
    taskId: params.taskId,
    audioId: params.audioId,
    model,
    callBackUrl: "https://callback.placeholder",
  }

  if (DEBUG) console.log(`[Suno] Adding vocals to task ${params.taskId}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const taskId = await createSunoTask({
    path: "/api/v1/generate/add-vocals",
    body,
    opName: "add vocals",
    label: "Add vocals",
    reconcileOpts,
    debugLabel: "Add vocals",
  })

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
  params: SunoConvertWavParams,
  reconcileOpts?: ReconcileOpts,
): Promise<SunoConvertWavResult> {
  const body: Record<string, unknown> = {
    taskId: params.taskId,
    audioId: params.audioId,
    callBackUrl: "https://callback.placeholder",
  }

  if (DEBUG) console.log(`[Suno] Converting to WAV for task ${params.taskId}`)
  if (DEBUG) console.log(`[Suno] Request:`, JSON.stringify(body, null, 2))

  const taskId = await createSunoTask({
    path: "/api/v1/wav/generate",
    body,
    opName: "WAV convert",
    label: "WAV conversion",
    reconcileOpts,
    debugLabel: "WAV convert",
  })

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
  params: SunoUploadExtendParams,
  reconcileOpts?: ReconcileOpts,
): Promise<SunoTaskResult> {
  const model = params.model ?? "V5_5"

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

  const taskId = await createSunoTask({
    path: "/api/v1/generate/upload-extend",
    body,
    opName: "upload extend",
    label: "Upload extend",
    reconcileOpts,
    debugLabel: "Upload extend",
  })

  return pollSunoTask(taskId)
}

// =============================================================================
// VOICE PERSONA API
// =============================================================================
//
// Two-stage human-in-the-loop flow:
//   1. validate → poll validate-info → user reads phrase
//   2. generate → poll record-info → voiceId
//
// Unlike the music functions above, voice methods are thin proxies. The
// frontend modal owns the polling loop because step (2) requires user
// interaction (recording the phrase) that happens between the two stages.

export type SunoVoiceLanguage =
  | "en" | "zh" | "es" | "fr" | "pt" | "de" | "ja" | "ko" | "hi" | "ru"

export type SunoVoiceSkillLevel =
  | "beginner" | "intermediate" | "advanced" | "professional"

export interface SunoVoiceValidateParams {
  voiceUrl: string
  vocalStartS: number
  vocalEndS: number
  language?: SunoVoiceLanguage
}

export interface SunoVoiceGenerateApiParams {
  taskId: string
  verifyUrl: string
  voiceName?: string
  description?: string
  style?: string
  singerSkillLevel?: SunoVoiceSkillLevel
}

export type SunoVoiceValidateStatus =
  | "wait_processing"
  | "processing_validate"
  | "processing_validate_fail"
  | "wait_validating"
  | "success"
  | "fail"

// KIE returns the same status enum for both stages.
export type SunoVoiceRecordStatus = SunoVoiceValidateStatus

export interface SunoVoiceValidateInfo {
  taskId: string
  validateInfo: string | null
  status: SunoVoiceValidateStatus
  errorCode: number | null
  errorMessage: string
}

export interface SunoVoiceRecordInfo {
  taskId: string
  voiceId: string | null
  status: SunoVoiceRecordStatus
  errorCode: number | null
  errorMessage: string
}

interface VoiceCreateResponse {
  code: number
  msg?: string
  message?: string
  data?: { taskId: string }
}

interface VoiceValidateInfoResponse {
  code: number
  msg?: string
  data?: {
    taskId: string
    validateInfo?: string | null
    status?: string
    errorCode?: number | null
    errorMessage?: string
  }
}

interface VoiceRecordInfoResponse {
  code: number
  msg?: string
  data?: {
    taskId: string
    voiceId?: string | null
    status?: string
    errorCode?: number | null
    errorMessage?: string
  }
}

async function postVoiceJson(
  path: string,
  body: Record<string, unknown>,
  errLabel: string
): Promise<string> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(`KIE_API_KEY is not configured`, errLabel)
  }

  if (DEBUG) console.log(`[Suno Voice] POST ${path}`, JSON.stringify(body))

  const response = await fetch(`${KIE_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno Voice] ${path} status=${response.status} body=${responseText.substring(0, 300)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `${errLabel} HTTP ${response.status}: ${responseText}`,
      errLabel
    )
  }

  let parsed: VoiceCreateResponse
  try {
    parsed = JSON.parse(responseText) as VoiceCreateResponse
  } catch {
    throw createSanitizedError(`${errLabel} response is not JSON: ${responseText}`, errLabel)
  }

  if (parsed.code !== 0 && parsed.code !== 200) {
    throw createSanitizedError(
      `${errLabel} error (code ${parsed.code}): ${parsed.msg ?? parsed.message ?? "unknown"}`,
      errLabel
    )
  }

  const taskId = parsed.data?.taskId
  if (!taskId) {
    throw createSanitizedError(
      `${errLabel} response missing taskId: ${JSON.stringify(parsed)}`,
      errLabel
    )
  }
  return taskId
}

async function getVoiceJson<T extends VoiceValidateInfoResponse | VoiceRecordInfoResponse>(
  path: string,
  taskId: string,
  errLabel: string
): Promise<T> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) {
    throw createSanitizedError(`KIE_API_KEY is not configured`, errLabel)
  }

  const url = new URL(`${KIE_API_BASE}${path}`)
  url.searchParams.set("taskId", taskId)

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  })

  const responseText = await response.text()
  if (DEBUG) console.log(`[Suno Voice] GET ${path} status=${response.status} body=${responseText.substring(0, 300)}`)

  if (!response.ok) {
    throw createSanitizedError(
      `${errLabel} HTTP ${response.status}: ${responseText}`,
      errLabel
    )
  }

  let parsed: T
  try {
    parsed = JSON.parse(responseText) as T
  } catch {
    throw createSanitizedError(`${errLabel} response is not JSON: ${responseText}`, errLabel)
  }

  if (parsed.code !== 0 && parsed.code !== 200) {
    throw createSanitizedError(
      `${errLabel} error (code ${parsed.code}): ${parsed.msg ?? "unknown"}`,
      errLabel
    )
  }

  return parsed
}

/**
 * Stage 1 — submit source audio + segment, get a validation taskId.
 * The validation phrase is generated asynchronously; poll {@link sunoVoiceValidateInfo}.
 */
export async function sunoVoiceValidate(
  params: SunoVoiceValidateParams
): Promise<{ taskId: string }> {
  const body: Record<string, unknown> = {
    voiceUrl: params.voiceUrl,
    vocalStartS: params.vocalStartS,
    vocalEndS: params.vocalEndS,
  }
  if (params.language) body.language = params.language

  const taskId = await postVoiceJson("/api/v1/voice/validate", body, "Suno voice validate")
  return { taskId }
}

/**
 * Poll for the validation phrase. Returns `validateInfo` (the phrase the user
 * must read) once status flips to `wait_validating`.
 */
export async function sunoVoiceValidateInfo(taskId: string): Promise<SunoVoiceValidateInfo> {
  const parsed = await getVoiceJson<VoiceValidateInfoResponse>(
    "/api/v1/voice/validate-info",
    taskId,
    "Suno voice validate-info"
  )
  const data = parsed.data
  return {
    taskId: data?.taskId ?? taskId,
    validateInfo: data?.validateInfo ?? null,
    status: (data?.status as SunoVoiceValidateStatus) ?? "wait_processing",
    errorCode: data?.errorCode ?? null,
    errorMessage: data?.errorMessage ?? "",
  }
}

/**
 * Regenerate the validation phrase for an existing task.
 */
export async function sunoVoiceRegenerate(taskId: string): Promise<{ taskId: string }> {
  // KIE doc uses `calBackUrl` (sic) and marks it required. We pass a placeholder
  // since we poll instead of using callbacks.
  const newTaskId = await postVoiceJson(
    "/api/v1/voice/regenerate",
    { taskId, calBackUrl: "https://callback.placeholder" },
    "Suno voice regenerate"
  )
  return { taskId: newTaskId }
}

/**
 * Stage 2 — submit the user's reading of the validation phrase. Returns the
 * generation taskId; poll {@link sunoVoiceRecordInfo} until status = success.
 */
export async function sunoVoiceGenerate(
  params: SunoVoiceGenerateApiParams
): Promise<{ taskId: string }> {
  const body: Record<string, unknown> = {
    taskId: params.taskId,
    verifyUrl: params.verifyUrl,
  }
  if (params.voiceName) body.voiceName = params.voiceName
  if (params.description) body.description = params.description
  if (params.style) body.style = params.style
  if (params.singerSkillLevel) body.singerSkillLevel = params.singerSkillLevel

  const taskId = await postVoiceJson("/api/v1/voice/generate", body, "Suno voice generate")
  return { taskId }
}

/**
 * Poll the voice creation task. Returns `voiceId` once status = "success".
 */
export async function sunoVoiceRecordInfo(taskId: string): Promise<SunoVoiceRecordInfo> {
  const parsed = await getVoiceJson<VoiceRecordInfoResponse>(
    "/api/v1/voice/record-info",
    taskId,
    "Suno voice record-info"
  )
  const data = parsed.data
  return {
    taskId: data?.taskId ?? taskId,
    voiceId: data?.voiceId ?? null,
    status: (data?.status as SunoVoiceRecordStatus) ?? "wait_processing",
    errorCode: data?.errorCode ?? null,
    errorMessage: data?.errorMessage ?? "",
  }
}
