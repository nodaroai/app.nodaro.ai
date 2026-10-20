/**
 * Suno Separate on KIE's market lane — separation of ANY audio.
 *
 * The old lane (`/api/v1/vocal-removal/generate`, `sunoSeparate` in
 * `suno-client.ts`) only takes a Suno track by `taskId` + `audioId`. The market
 * model `ai-music-api/separate-vocals` (standard `jobs/createTask` +
 * `jobs/recordInfo`) also takes a plain `audio_url`, and adds one-instrument
 * mode (`split_stem_advanced` + `stem_name`):
 *
 *   input = { audio_url, type, stem_name? }          (any audio)
 *         | { task_id, audio_id, type, stem_name? }  (a Suno track)
 *   poll  → JSON.parse(resultJson).resultObject.origin_data[]
 *
 * Two refusals are a pure function of the input, so they surface as typed
 * `DeterministicJobError`s (no queue retry, full refund) with user copy that
 * names the way forward, instead of the generic "generation failed":
 *   - failCode 413 / "matches an existing recording in our catalog" — Suno
 *     will not separate a commercially released recording;
 *   - "14-day retention period" — Suno could not fetch the audio.
 * The raw failCode/failMsg are logged by `pollKieTask`; neither error carries
 * KIE's ids or text.
 */

import {
  DEFAULT_SUNO_STEM_NAME,
  sunoSeparateCreditId,
  type SunoSeparateType,
  type SunoStemName,
} from "@nodaro/shared/models"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import type { ReconcileOpts } from "../provider.interface.js"
import { createKieTask, createSanitizedError, pollKieTask } from "./client.js"
import type { SunoSeparateResult } from "./suno-client.js"
import { sunoStemFieldFor } from "./suno-stem-fields.js"

/** KIE market model id of Suno's separation endpoint. */
const SEPARATE_VOCALS_MODEL = "ai-music-api/separate-vocals"

// =============================================================================
// USER-FACING ERRORS
// =============================================================================

export const SUNO_CATALOG_REFUSAL_MESSAGE =
  "Suno recognised this as a commercially released recording and won't separate it. Use the Audio Separation node (Demucs), or turn on 'If Suno refuses, use Demucs'."

/** Catalog refusal in one-instrument mode, which has no Demucs fallback. */
export const SUNO_CATALOG_REFUSAL_SINGLE_MESSAGE =
  "Suno recognised this as a commercially released recording and won't separate it. One-instrument mode has no Demucs fallback — use the Audio Separation node for vocals or stems."

export const SUNO_AUDIO_UNREACHABLE_MESSAGE =
  "Suno couldn't download this audio. Check the file is reachable, or use the Audio Separation node."

export const SUNO_INPUT_TOO_LARGE_MESSAGE =
  "Suno accepts audio up to 20 MB — trim it or use Audio Separation."

/** Suno recognised the audio as a commercially released recording (KIE failCode 413). */
export class SunoCatalogRefusalError extends DeterministicJobError {
  readonly code = "suno_catalog_refusal" as const

  constructor(message: string = SUNO_CATALOG_REFUSAL_MESSAGE, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "SunoCatalogRefusalError"
  }
}

/** Suno could not download the audio it was asked to separate. */
export class SunoAudioUnreachableError extends DeterministicJobError {
  readonly code = "suno_audio_unreachable" as const

  constructor(message: string = SUNO_AUDIO_UNREACHABLE_MESSAGE, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "SunoAudioUnreachableError"
  }
}

/** The audio is over the market lane's input cap. */
export class SunoInputTooLargeError extends DeterministicJobError {
  readonly code = "suno_input_too_large" as const

  constructor(message: string = SUNO_INPUT_TOO_LARGE_MESSAGE, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "SunoInputTooLargeError"
  }
}

const CATALOG_REFUSAL_RE = /matches an existing recording/i
// KIE's text reads "The original song’s audio has expired after the 14-day
// retention period …" with a U+2019 apostrophe, so only this substring is matched.
const AUDIO_UNREACHABLE_RE = /14-day retention period/i

/** A typed error for a refusal that depends only on the input; otherwise `undefined`. */
function separateFailure(failCode: string, failMsg: string): Error | undefined {
  if (failCode === "413" || CATALOG_REFUSAL_RE.test(failMsg)) return new SunoCatalogRefusalError()
  if (AUDIO_UNREACHABLE_RE.test(failMsg)) return new SunoAudioUnreachableError()
  return undefined
}

// =============================================================================
// CLIENT
// =============================================================================

/** What to separate: any reachable audio, or a Suno track by its ids. */
export type SunoSeparateSource = { audioUrl: string } | { taskId: string; audioId: string }

/**
 * Separate `source` on the market lane and poll to completion. `stemName`
 * applies to one-instrument mode only (default `DEFAULT_SUNO_STEM_NAME`);
 * the other modes never send it.
 */
export async function sunoSeparateMarket(
  params: { source: SunoSeparateSource; type: SunoSeparateType; stemName?: SunoStemName },
  reconcileOpts?: ReconcileOpts,
): Promise<SunoSeparateResult> {
  const { source, type } = params
  const input: Record<string, unknown> = {
    ...("audioUrl" in source
      ? { audio_url: source.audioUrl }
      : { task_id: source.taskId, audio_id: source.audioId }),
    type,
    ...(type === "split_stem_advanced" ? { stem_name: params.stemName ?? DEFAULT_SUNO_STEM_NAME } : {}),
  }

  const { taskId } = await createKieTask(SEPARATE_VOCALS_MODEL, input, {
    modelKey: sunoSeparateCreditId(type),
    dimensions: reconcileOpts?.dimensions,
  })
  await fireOnTaskCreated(reconcileOpts, taskId, "[Suno]")
  const { resultJson } = await pollKieTask(taskId, undefined, undefined, { onFail: separateFailure })
  return parseSeparateVocalsResult(resultJson, type, taskId)
}

// =============================================================================
// RESULT PARSER
// =============================================================================

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

/**
 * Percent-encode the literal spaces KIE puts in one-instrument URLs
 * (`…_Lead Vocal.mp3`), and nothing else. A decode/re-encode round trip is not
 * encode-once: `decodeURI` keeps reserved escapes (`%2F`, `%2B`, `%3D`, …), so
 * `encodeURI` would turn them into `%252F` and corrupt a signed URL. Every
 * other character, escapes and query string included, passes through as sent.
 */
function encodeSpaces(url: string): string {
  return url.replace(/ /g, "%20")
}

function urlOf(entry: unknown): string | undefined {
  const url = asRecord(entry)?.audio_url
  return typeof url === "string" && url !== "" ? encodeSpaces(url) : undefined
}

/** One-instrument mode: entry 0 is take 1, entry 1 is take 2, each `{ extract, remove }`. */
function parseTakes(originData: readonly unknown[]): Partial<SunoSeparateResult> {
  const take = (i: number) => asRecord(originData[i])
  const fields: Array<[keyof SunoSeparateResult, string | undefined]> = [
    ["isolatedUrl", urlOf(take(0)?.extract)],
    ["withoutUrl", urlOf(take(0)?.remove)],
    ["isolated2Url", urlOf(take(1)?.extract)],
    ["without2Url", urlOf(take(1)?.remove)],
  ]
  return Object.fromEntries(fields.filter(([, url]) => url !== undefined))
}

/** Vocals/instrumental and full stems: one entry per stem, by its stem-group name. */
function parseStems(originData: readonly unknown[]): Partial<SunoSeparateResult> {
  const stems = originData.flatMap((entry) => {
    const name = asRecord(entry)?.stem_type_group_name
    if (typeof name !== "string") return []
    const field = sunoStemFieldFor(name)
    const url = urlOf(entry)
    return field && url ? [[field, url] as const] : []
  })
  return Object.fromEntries(stems)
}

/**
 * The stems in a finished task's `resultJson`. Throws when nothing maps — an
 * empty separation is a failure, never an empty success.
 */
export function parseSeparateVocalsResult(
  resultJson: unknown,
  type: SunoSeparateType,
  taskId: string,
): SunoSeparateResult {
  const originData = asRecord(asRecord(resultJson)?.resultObject)?.origin_data
  const entries: readonly unknown[] = Array.isArray(originData) ? originData : []
  const urls = type === "split_stem_advanced" ? parseTakes(entries) : parseStems(entries)
  if (Object.keys(urls).length === 0) {
    throw createSanitizedError("Suno separate returned no stems", "Stem separation")
  }
  return { taskId, ...urls }
}
