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
 * The rule (`separateFailure`) and the errors live in
 * `suno-separate-refusals.ts`, shared with the old lane. The raw
 * failCode/failMsg are logged by `pollKieTask`; neither error carries KIE's
 * ids or text.
 */

import {
  DEFAULT_SUNO_STEM_NAME,
  sunoSeparateCreditId,
  type SunoSeparateType,
  type SunoStemName,
} from "@nodaro/shared/models"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import type { ReconcileOpts } from "../provider.interface.js"
import { createKieTask, createSanitizedError, pollKieTask } from "./client.js"
import type { SunoSeparateResult } from "./suno-client.js"
import { separateFailure } from "./suno-separate-refusals.js"
import { sunoStemFieldFor } from "./suno-stem-fields.js"

/** KIE market model id of Suno's separation endpoint. */
const SEPARATE_VOCALS_MODEL = "ai-music-api/separate-vocals"

// =============================================================================
// USER-FACING ERRORS
// =============================================================================

// The typed refusals and the rule that maps a provider failure onto them live
// in `suno-separate-refusals.ts`, shared with the old vocal-removal lane.
// Re-exported so this module stays the import path its callers already use.
export {
  SUNO_AUDIO_UNREACHABLE_MESSAGE,
  SUNO_CATALOG_REFUSAL_MESSAGE,
  SUNO_CATALOG_REFUSAL_SINGLE_MESSAGE,
  SUNO_INPUT_TOO_LARGE_MESSAGE,
  SUNO_TRACK_REFUSAL_MESSAGE,
  SUNO_TRACK_REFUSAL_SINGLE_MESSAGE,
  SUNO_TRACK_UNAVAILABLE_MESSAGE,
  SUNO_TRACK_UNAVAILABLE_SINGLE_MESSAGE,
  SunoAudioUnreachableError,
  SunoCatalogRefusalError,
  SunoInputTooLargeError,
} from "./suno-separate-refusals.js"

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

/** An entry's own Suno id (`origin_data[].id`, what Convert to WAV takes a stem by). */
function idOf(entry: unknown): string | undefined {
  const id = asRecord(entry)?.id
  return typeof id === "string" && id !== "" ? id : undefined
}

/** The URL fields of the entries that came back, and the ids of those that carry one. */
function withIds(entries: ReadonlyArray<readonly [string, unknown]>): Partial<SunoSeparateResult> {
  const kept = entries.flatMap(([field, entry]) => {
    const url = urlOf(entry)
    return url ? [{ field, url, id: idOf(entry) }] : []
  })
  const stemIds = Object.fromEntries(kept.flatMap((k) => (k.id ? [[k.field, k.id] as const] : [])))
  return {
    ...Object.fromEntries(kept.map((k) => [k.field, k.url] as const)),
    ...(Object.keys(stemIds).length > 0 ? { stemIds } : {}),
  }
}

/**
 * One-instrument mode: entry 0 is take 1, entry 1 is take 2, each `{ extract, remove }`,
 * each side with its own `id` (as the probe's recorded tasks carry them).
 */
function parseTakes(originData: readonly unknown[]): Partial<SunoSeparateResult> {
  const take = (i: number) => asRecord(originData[i])
  return withIds([
    ["isolatedUrl", take(0)?.extract],
    ["withoutUrl", take(0)?.remove],
    ["isolated2Url", take(1)?.extract],
    ["without2Url", take(1)?.remove],
  ])
}

/** Vocals/instrumental and full stems: one entry per stem, by its stem-group name. */
function parseStems(originData: readonly unknown[]): Partial<SunoSeparateResult> {
  return withIds(originData.flatMap((entry) => {
    const name = asRecord(entry)?.stem_type_group_name
    if (typeof name !== "string") return []
    const field = sunoStemFieldFor(name)
    return field ? [[field, entry] as const] : []
  }))
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
  if (Object.keys(urls).filter((k) => k !== "stemIds").length === 0) {
    throw createSanitizedError("Suno separate returned no stems", "Stem separation")
  }
  return { taskId, ...urls }
}
