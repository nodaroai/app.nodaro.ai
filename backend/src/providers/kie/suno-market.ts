/**
 * Suno on KIE's market lane (`POST /api/v1/jobs/createTask` +
 * `GET /api/v1/jobs/recordInfo`), for the three abilities only that lane
 * documents (decided 2026-11-17):
 *
 *   - Suno Speech        — `ai-music-api/speech`;
 *   - Cover by id        — `ai-music-api/upload-and-cover-audio` with
 *                          `task_id` + `audio_id` (a track made here) in place
 *                          of the uploaded file;
 *   - a stem to WAV      — `ai-music-api/convert-to-wav-format` with a
 *                          separation's `task_id` and the stem's id.
 *
 * Every other Suno call keeps its own endpoint and body in `suno-client.ts`,
 * byte for byte: a cover of an uploaded file, a WAV of a generated track.
 *
 * Each body here is an allow-list built from the saved schema, never a spread.
 * Where the music tracks of a finished task sit is documented as
 * `data.response.data[]` (`audio_url`, `stream_audio_url`, `image_url`, `id`,
 * `duration`); the poll also reads the shapes the other Suno endpoints use, so
 * a first real run that answers differently still delivers (to be checked on
 * staging).
 */

import { sunoSpeechProviderInput, type SunoSpeechRun } from "@nodaro/render-rules"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import type { ReconcileOpts } from "../provider.interface.js"
import { KieError, createKieTask, createSanitizedError, createUpstreamFailureError, pollKieTask } from "./client.js"
import { KIE_CREDIT_USD } from "./models.js"
import { sunoCoverByIdInput, type SunoCoverByIdParams } from "./suno-cover-by-id.js"
import {
  SUNO_MAX_POLL_ATTEMPTS,
  pollSunoEndpoint,
  type SunoConvertWavResult,
  type SunoTaskResult,
  type SunoTrack,
} from "./suno-client.js"

export const SUNO_SPEECH_MODEL = "ai-music-api/speech"

/**
 * What KIE charges for one Suno Speech request (both takes): 12 KIE credits
 * (its price list, read 2026-11-17), recorded as the job's provider cost.
 */
export const SUNO_SPEECH_KIE_CREDITS = 12
export const SUNO_SPEECH_PROVIDER_COST_USD = SUNO_SPEECH_KIE_CREDITS * KIE_CREDIT_USD
export const SUNO_COVER_MARKET_MODEL = "ai-music-api/upload-and-cover-audio"
export const SUNO_WAV_MARKET_MODEL = "ai-music-api/convert-to-wav-format"

export { sunoCoverByIdInput, type SunoCoverByIdParams } from "./suno-cover-by-id.js"

// The poll budget of a market Suno task is the bound the shared Suno poll loop
// runs to (`SUNO_MAX_POLL_ATTEMPTS`, read where it is used: `pollSunoEndpoint`
// loops to it, and the timeout message and the WAV poll name the same number).

// =============================================================================
// RESULT
// =============================================================================

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined
}

/** A `resultJson` that arrives as a JSON string or as an object. */
function parsedResultJson(v: unknown): Record<string, unknown> | undefined {
  if (typeof v === "string") {
    try {
      return asRecord(JSON.parse(v))
    } catch {
      return undefined
    }
  }
  return asRecord(v)
}

/** The first array of track entries a finished task record carries, in the documented place first. */
function trackEntriesOf(data: Record<string, unknown> | undefined): readonly unknown[] {
  const response = asRecord(data?.response)
  const result = parsedResultJson(data?.resultJson)
  const object = asRecord(result?.resultObject)
  const candidates = [response?.data, response?.sunoData, object?.data, result?.data, result?.sunoData]
  for (const c of candidates) if (Array.isArray(c) && c.length > 0) return c
  return []
}

/**
 * The tracks of a finished market Suno task record (`data` of recordInfo), the
 * shape every Suno music result uses: a track with no downloadable audio is
 * dropped (`stream_audio_url` is a stream, never stored).
 */
export function sunoMarketTracksOf(data: Record<string, unknown> | undefined): SunoTrack[] {
  return trackEntriesOf(data).flatMap((entry) => {
    const t = asRecord(entry)
    const audioUrl = str(t?.audio_url) ?? str(t?.audioUrl)
    if (!t || !audioUrl) return []
    const duration = t.duration
    return [{
      id: str(t.id) ?? "",
      audioUrl,
      ...(str(t.title) ? { title: str(t.title) } : {}),
      ...(typeof duration === "number" && Number.isFinite(duration) ? { duration } : {}),
      ...(str(t.image_url) ?? str(t.imageUrl) ? { imageUrl: str(t.image_url) ?? str(t.imageUrl) } : {}),
    }]
  })
}

/**
 * Poll a market Suno task to its tracks. `success` with no track is a failure,
 * never an empty success; `fail` is the provider's terminal failure (refunded).
 * A record still `waiting` / `queuing` / `generating` keeps polling.
 */
export async function pollSunoMarketTracks(taskId: string, label: string): Promise<SunoTaskResult> {
  return pollSunoEndpoint<SunoTaskResult>(taskId, {
    path: "/api/v1/jobs/recordInfo",
    warnPrefix: `${label} poll attempt`,
    timeoutMessage: `Suno ${label} task timed out after ${SUNO_MAX_POLL_ATTEMPTS} polls`,
    timeoutLabel: label,
    onSuccess: (parsed) => {
      const data = asRecord(parsed.data)
      const state = typeof data?.state === "string" ? data.state : undefined
      if (state === "fail") {
        const failMsg = str(data?.failMsg) ?? "Unknown error"
        const failCode = str(data?.failCode) ?? "no_code"
        throw createUpstreamFailureError(`Suno ${label} task failed: [${failCode}] ${failMsg}`, label)
      }
      if (state !== "success") return undefined
      const tracks = sunoMarketTracksOf(data)
      if (tracks.length === 0) {
        throw createSanitizedError(`Suno ${label} task succeeded but no tracks returned: ${JSON.stringify(parsed).slice(0, 500)}`, label)
      }
      return { taskId, tracks }
    },
  })
}

// =============================================================================
// SUNO SPEECH
// =============================================================================

/** Create a Suno Speech task for a run and poll it to its takes (two per run). */
export async function sunoSpeech(run: SunoSpeechRun, reconcileOpts?: ReconcileOpts): Promise<SunoTaskResult> {
  const { taskId } = await createKieTask(SUNO_SPEECH_MODEL, sunoSpeechProviderInput(run), {
    modelKey: reconcileOpts?.modelKey ?? null,
    dimensions: reconcileOpts?.dimensions,
  })
  await fireOnTaskCreated(reconcileOpts, taskId, "[Suno]")
  return pollSunoMarketTracks(taskId, "Speech generation")
}

// =============================================================================
// COVER BY ID
// =============================================================================

/**
 * KIE definitely refused to CREATE a cover by id: it answered the request with
 * a client error (HTTP 4xx) or with an error code in its body — a track it no
 * longer keeps, ids it does not accept. No task was made, so the run may still
 * cover the file on the upload lane.
 */
export class SunoCoverByIdRefusedError extends Error {
  constructor(readonly refusal: KieError) {
    super(refusal.message, { cause: refusal })
    this.name = "SunoCoverByIdRefusedError"
  }
}

/** The body cannot say what the file lane would (`sunoCoverByIdInput` answered none): nothing was sent. */
export class SunoCoverByIdInexpressibleError extends Error {
  constructor() {
    super("This cover's prompt cannot be sent with a cover by id")
    this.name = "SunoCoverByIdInexpressibleError"
  }
}

/**
 * Whether a failed create is a DEFINITE refusal — one after which no task can
 * exist — read off what `createKieTask` records about KIE's answer
 * (`KieError.internalDetails`): an HTTP 4xx, or a body that carries an error
 * code. Everything else may have made a task and is never one: a gateway 5xx,
 * a 2xx whose body is not JSON, a 200 with no task id, a lost connection.
 */
export function isDefiniteCreateRefusal(err: unknown): err is KieError {
  if (!(err instanceof KieError)) return false
  const http = /createTask failed: (\d{3}) - /.exec(err.internalDetails)
  if (http) return http[1]!.startsWith("4")
  return /createTask error \(code -?\d+\): /.test(err.internalDetails)
}

/**
 * Cover a track made here by its ids (no re-upload) and poll to its takes.
 * Throws `SunoCoverByIdRefusedError` only when KIE definitely refused the
 * create (`isDefiniteCreateRefusal`), before any task exists. A create that
 * may have made a task (a 5xx, an unreadable answer, a lost connection) and a
 * task that fails later are thrown as they are: the job fails and is refunded,
 * and never asks KIE for a second task.
 */
export async function sunoCoverById(p: SunoCoverByIdParams, reconcileOpts?: ReconcileOpts): Promise<SunoTaskResult> {
  const input = sunoCoverByIdInput(p)
  if (!input) throw new SunoCoverByIdInexpressibleError()
  let taskId: string
  try {
    ;({ taskId } = await createKieTask(SUNO_COVER_MARKET_MODEL, input, {
      modelKey: reconcileOpts?.modelKey ?? null,
      dimensions: reconcileOpts?.dimensions,
    }))
  } catch (err) {
    if (isDefiniteCreateRefusal(err)) throw new SunoCoverByIdRefusedError(err)
    throw err
  }
  await fireOnTaskCreated(reconcileOpts, taskId, "[Suno]")
  return pollSunoMarketTracks(taskId, "Music generation")
}

// =============================================================================
// A STEM TO WAV
// =============================================================================

/**
 * Convert one stem of a Suno separation to WAV: the separation's task id and
 * the stem's own id (`origin_data[].id`). The WAV is `resultJson.resultUrls[0]`.
 */
export async function sunoConvertWavStem(
  p: { readonly taskId: string; readonly audioId: string },
  reconcileOpts?: ReconcileOpts,
): Promise<SunoConvertWavResult> {
  const { taskId } = await createKieTask(SUNO_WAV_MARKET_MODEL, { task_id: p.taskId, audio_id: p.audioId }, {
    modelKey: reconcileOpts?.modelKey ?? null,
    dimensions: reconcileOpts?.dimensions,
  })
  await fireOnTaskCreated(reconcileOpts, taskId, "[Suno]")
  const { resultJson } = await pollKieTask(taskId, SUNO_MAX_POLL_ATTEMPTS)
  const audioUrl = resultJson.resultUrls?.[0] ?? resultJson.audioUrl
  if (!audioUrl) throw createSanitizedError("Suno WAV conversion returned no file", "WAV conversion")
  return { taskId, audioUrl }
}
