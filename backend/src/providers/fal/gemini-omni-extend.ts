/**
 * fal.ai Gemini Omni Flash 1.2 Extend — `google/gemini-omni-flash/v1.2/extend`
 * (decided 2026-11-17), the generation step of the Extend Video provider
 * `gemini-omni-flash-1-2-extend` (lib/extend-recipe.ts). A flat function the
 * extend worker calls, like `fal/lip-sync.ts`.
 *
 * The endpoint takes `prompt` (required), `video_url` (the clip to continue;
 * the model reads its last 10 s), `duration` (3–10, the seconds ADDED) and
 * `resolution` (360p / 720p / 1080p / 4k), and nothing else: the request is
 * built from exactly those four (`geminiOmniExtendInput`). It returns
 * `{ video: { url } }`: the clip it was sent, its last frames re-rendered for
 * the join, with the new seconds after it, at the requested resolution, 16:9
 * or 9:16, with sound.
 *
 * Called with NO reconcile hook on purpose (as every tail recipe's
 * generation): the request's result is not the deliverable — the worker cuts
 * the new seconds out of it and joins them onto the user's source — so the
 * reconcile cron must never finalize the job with it, and the endpoint is not
 * in `lib/reconcile/fal.ts`'s registries. Instead the worker keeps the
 * request's id on its own BullMQ job right after submit (`onSubmitted`), so a
 * retry of the job — a stalled worker, or a failure after fal finished (the
 * download, the cut, the stitch, the upload) — polls and fetches that same
 * request (`resumeRequestId`) and never starts a second billed generation.
 * Only a request fal answered as failed (`requestEnded` on the thrown error)
 * is forgotten, so its retry submits a new one.
 */
import { runFalRequest, extractFalUrl, FalRequestError } from "./client.js"
import { DeterministicJobError, isDeterministicJobError } from "../../lib/deterministic-job-error.js"
import type { ProviderKeyCoverage } from "../provider-keys.js"

/** fal's endpoint for the engine (the slashed id never leaves this module). */
export const FAL_GEMINI_OMNI_EXTEND_ENDPOINT = "google/gemini-omni-flash/v1.2/extend"

/**
 * The nodaro.ai connection has no relay route for `extend-video`
 * (`CLOUD_ROUTE_BY_JOB_TYPE`, providers/nodaro/run-on-cloud.ts), so a keyless
 * run's message names the key without offering the connection — as Video
 * Depth's fal lane does.
 */
export const GEMINI_OMNI_EXTEND_KEY_COVERAGE: ProviderKeyCoverage = { coveredByConnection: false }

/** What the worker hands the endpoint. */
export interface GeminiOmniExtendRequest {
  /** The user's prompt, as written (fal requires one). */
  readonly prompt: string
  /** The clip to continue: the source's last seconds, on a public link. */
  readonly videoUrl: string
  /** The seconds to add (3–10). */
  readonly durationSec: number
  /** The resolution to render (360p / 720p / 1080p / 4k). */
  readonly resolution: string
}

/** The endpoint's request body: exactly its four fields, nothing else. */
export function geminiOmniExtendInput(req: GeminiOmniExtendRequest): Record<string, unknown> {
  return {
    prompt: req.prompt,
    video_url: req.videoUrl,
    duration: req.durationSec,
    resolution: req.resolution,
  }
}

/**
 * The user-facing failure for a clip the model refused to continue (fal's 422
 * "Could not generate a video with the given inputs"): final, refunded in
 * full, never the vendor's own words.
 */
export const GEMINI_OMNI_EXTEND_REFUSED_MESSAGE =
  "Gemini Omni Flash 1.2 could not continue this clip, so nothing was charged. " +
  "Recognised copyrighted footage is one cause: try another clip, or a Seedance engine."

/**
 * The user-facing failure for any other 422 — fal refused the request as sent
 * (a field it does not accept): final and refunded, as the refusal is, since
 * the same request is refused again.
 */
export const GEMINI_OMNI_EXTEND_REQUEST_REFUSED_MESSAGE =
  "Gemini Omni Flash 1.2 could not accept this request, so nothing was charged. Try again with another prompt or clip."

/**
 * The most status polls of one attempt: 15 minutes at the client's 3 s
 * cadence (a run takes one to a few minutes). A request still running then
 * keeps its id, so the job's retry polls it again.
 */
export const GEMINI_OMNI_EXTEND_MAX_POLLS = 300

/** The job-data key a submitted request is kept under, for a retry of the job. */
export const GEMINI_OMNI_EXTEND_SENT_REQUEST_KEY = "falExtendRequest"

/**
 * A submitted request, kept on the job with what it was sent — so a retry
 * that picks the request up cuts, settles and records it by the run that
 * made it, never by a second reading of the source (a link can serve another
 * file on the retry).
 */
export interface GeminiOmniExtendSentRequest {
  readonly falRequestId: string
  /** The picture seconds of the tail that was sent: where the new seconds start in fal's clip. */
  readonly sentPictureSec: number
  /** The resolution the request asked for. */
  readonly resolution: string
  /** The seconds the request asked to add. */
  readonly addedSec: number
  /** The source's picture seconds the run counted (what its charge reads). */
  readonly sourcePictureSec: number
}

/** The request kept on a job's data, when one is there and whole. */
export function geminiOmniExtendSentRequestOf(jobData: unknown): GeminiOmniExtendSentRequest | undefined {
  const kept = (jobData as Record<string, unknown> | null | undefined)?.[GEMINI_OMNI_EXTEND_SENT_REQUEST_KEY] as Record<string, unknown> | null | undefined
  if (!kept || typeof kept !== "object") return undefined
  const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0
  const { falRequestId, sentPictureSec, resolution, addedSec, sourcePictureSec } = kept
  if (typeof falRequestId !== "string" || falRequestId === "" || typeof resolution !== "string") return undefined
  if (!positive(sentPictureSec) || !positive(addedSec) || !positive(sourcePictureSec)) return undefined
  return { falRequestId, sentPictureSec, resolution, addedSec, sourcePictureSec }
}

/** How many status reads in a row may fail before a poll gives up (each waits one poll interval). */
export const GEMINI_OMNI_EXTEND_STATUS_ERROR_RETRIES = 5

/** The user-facing failure for any other failed request (retried, then refunded). */
export const GEMINI_OMNI_EXTEND_FAILED_MESSAGE = "Gemini Omni Flash 1.2 could not generate the extension. Please try again."

/** The fal 422 text that means the model refused the clip, not the request's shape. */
const REFUSAL_TEXT = /could not generate a video with the given inputs/i

/** The status and the detail of a fal failure, from the typed error or a raw fal ApiError on its cause chain. */
function falFailureOf(err: unknown): { status?: number; detail?: unknown } | undefined {
  let cur: unknown = err
  for (let depth = 0; cur && typeof cur === "object" && depth < 8; depth++) {
    if (cur instanceof FalRequestError) return { status: cur.status, detail: cur.detail }
    const e = cur as Record<string, unknown>
    if (typeof e.status === "number") {
      const body = e.body
      return { status: e.status, detail: body && typeof body === "object" ? (body as Record<string, unknown>).detail : body }
    }
    cur = e.cause
  }
  return undefined
}

/**
 * Whether `err` is the model's refusal of the clip: an HTTP 422 (or a queue
 * failure that carried only its text) whose detail says it could not generate
 * from the given inputs (a string, or fal's list of `{ msg, type }` entries,
 * the type `invalid_request`). A 422 that names a field (the request's shape)
 * is not, nor is any other status.
 */
export function isGeminiOmniExtendRefusal(err: unknown): boolean {
  const failure = falFailureOf(err)
  // A 422; or a queue failure that carried only its text (no status), which
  // is judged by the text alone.
  if (!failure || (failure.status !== 422 && failure.status !== undefined)) return false
  const text = typeof failure.detail === "string" ? failure.detail : JSON.stringify(failure.detail ?? "")
  return REFUSAL_TEXT.test(text)
}

/** Whether `err` is any HTTP 422 from fal (a refusal of the clip, or of a field). */
export function isGeminiOmniExtend422(err: unknown): boolean {
  return falFailureOf(err)?.status === 422 || isGeminiOmniExtendRefusal(err)
}

/**
 * Whether fal answered that the request itself ended in failure, so a retry
 * must submit a new one: a failed queue status, an HTTP answer to the result
 * fetch, or a request fal no longer knows (404). A status read or a result
 * fetch that got no answer, and a poll that ran out, are not: the request may
 * still finish, and a retry polls it again rather than paying for a second.
 */
export function geminiOmniExtendRequestEnded(err: unknown): boolean {
  let cur: unknown = err
  for (let depth = 0; cur && typeof cur === "object" && depth < 8; depth++) {
    if (cur instanceof FalRequestError) return cur.ended
    const e = cur as Record<string, unknown>
    if (typeof e.status === "number") return e.status === 404
    cur = e.cause
  }
  return false
}

/** `err`'s own text, kept for the operator (the job's error detail, redacted on the way in). */
function operatorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Run one extend on fal. Returns the URL of fal's clip (the clip sent with the
 * new seconds after it). A refusal of the clip throws a final, refunded
 * `DeterministicJobError` in our words; any other failure a plain error in our
 * words (retried, then refunded), both carrying fal's own text for the
 * operator only.
 */
export async function falGeminiOmniExtend(
  req: GeminiOmniExtendRequest,
  opts: {
    /** A request this job already submitted (a retry): polled, never submitted again. */
    readonly resumeRequestId?: string
    /** Told a NEW request's id right after submit: the worker persists it on the job for a retry. */
    readonly onSubmitted?: (requestId: string) => Promise<void>
    /** Poll cadence override (ms); tests pass 0. */
    readonly pollIntervalMs?: number
  } = {},
): Promise<{ videoUrl: string; requestId: string }> {
  try {
    const { output, requestId } = await runFalRequest({
      endpoint: FAL_GEMINI_OMNI_EXTEND_ENDPOINT,
      input: geminiOmniExtendInput(req),
      label: "[fal:geminiOmniExtend]",
      keyCoverage: GEMINI_OMNI_EXTEND_KEY_COVERAGE,
      statusErrorRetries: GEMINI_OMNI_EXTEND_STATUS_ERROR_RETRIES,
      // One submit creates one billed run: the SDK must not re-send it after
      // an outcome it cannot read (a 502 / 503 / 504, a lost connection).
      submitOnce: true,
      maxPolls: GEMINI_OMNI_EXTEND_MAX_POLLS,
      ...(opts.resumeRequestId ? { resumeRequestId: opts.resumeRequestId } : {}),
      ...(opts.onSubmitted ? { onSubmitted: opts.onSubmitted } : {}),
      ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
    })
    return { videoUrl: extractFalUrl(output), requestId }
  } catch (err) {
    // A missing key keeps its own sentence (it names FAL_KEY and Install
    // health), and a final refusal raised on the way (a concurrency-slot wait
    // that ran out) its own.
    if (err instanceof Error && (err as { code?: unknown }).code === "provider_key_missing") throw err
    if (isDeterministicJobError(err)) throw err
    // Any 422 is final (the same request is refused again): the clip's
    // refusal in its words, any other in the request's.
    const wrapped = isGeminiOmniExtendRefusal(err)
      ? new DeterministicJobError(GEMINI_OMNI_EXTEND_REFUSED_MESSAGE, { cause: err })
      : isGeminiOmniExtend422(err)
        ? new DeterministicJobError(GEMINI_OMNI_EXTEND_REQUEST_REFUSED_MESSAGE, { cause: err })
        : new Error(GEMINI_OMNI_EXTEND_FAILED_MESSAGE, { cause: err })
    // `requestEnded`: whether the worker forgets the request's id before a retry.
    Object.assign(wrapped, { internalDetails: operatorDetail(err), requestEnded: geminiOmniExtendRequestEnded(err) })
    throw wrapped
  }
}
