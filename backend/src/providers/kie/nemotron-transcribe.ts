/**
 * Nemotron 3.5 Transcribe on KIE (`nvidia/nemotron-3-5-transcribe`): a market
 * task (`POST /api/v1/jobs/createTask`, then record-info), whose answer is a
 * `resultObject` and a JSON result FILE (words, speakers) at its `url`.
 * Docs: https://docs.kie.ai/market/nvidia/nemotron-3-5-transcribe.md
 *
 * Wire notes (`providers/kie/CLAUDE.md`):
 *  - the input is allow-listed (`additionalProperties: false`): `audio_url`,
 *    `timestamps` (only when word timings are asked) and `target_language`
 *    (only for a translation) — never `language` (the model detects it and has
 *    no such input), never both `timestamps` and `target_language` (KIE refuses
 *    the pair; every run surface refuses it first, and this is the last stop);
 *  - `audio_url` is the file as the caller gave it: our own storage's public
 *    address (an upload, a job's output, a social link's extracted sound) or a
 *    direct file link the route measured; KIE fetches it within ~3 minutes;
 *  - the result file is read at once (it expires ~14 days later): the words
 *    and the speakers are only there.
 */
import { createSanitizedError, runKieTask, sleep, MAX_POLL_ATTEMPTS_VIDEO } from "./client.js"
import { KIE_CREDIT_USD } from "./models.js"
import { kieTaskCreditsConsumed } from "./image-cost.js"
import { safeFetch } from "../../lib/safe-fetch.js"
import { NEMOTRON_TRANSCRIBE_ID } from "@nodaro/shared/credits"
import type { ReconcileOpts } from "../provider.interface.js"
import {
  mapNemotronResult,
  nemotronProviderCostUsd,
  type NemotronResultFile,
  type NemotronResultObject,
  type NemotronTranscribeOutput,
} from "../audio/nemotron-output.js"

/** KIE's model id for the engine `nemotron-3-5-transcribe`. */
export const NEMOTRON_KIE_MODEL = "nvidia/nemotron-3-5-transcribe"

export interface NemotronTranscribeRequest {
  readonly audioUrl: string
  /** Word start/end times and a speaker per word (`timestamps: true`). */
  readonly wordTimestamps?: boolean
  /** Translate the speech into this language instead (`target_language`). */
  readonly targetLanguage?: string
}

/** The allow-listed `input` body KIE takes. Throws on the pair KIE refuses. */
export function buildNemotronTranscribeInput(req: NemotronTranscribeRequest): Record<string, unknown> {
  if (req.wordTimestamps && req.targetLanguage) {
    throw new Error("Nemotron 3.5 Transcribe cannot return word timings for a translation — ask for one or the other.")
  }
  return {
    audio_url: req.audioUrl,
    ...(req.wordTimestamps ? { timestamps: true } : {}),
    ...(req.targetLanguage ? { target_language: req.targetLanguage } : {}),
  }
}

/** The waits before each retry of the result file: 1 s, 3 s, 9 s (four tries in all). */
export const RESULT_FILE_BACKOFF_MS: readonly number[] = [1_000, 3_000, 9_000]

/**
 * The result file at `url`, or undefined when it could not be read after its
 * retries (the caller decides whether a missing file is fatal: it is when word
 * timings were asked, since they are only there; a plain transcript or a
 * translation falls back to the `resultObject`'s text). The waits are the KIE
 * client's drain-aware sleep, so a deploy aborts them like any poll.
 */
export async function readNemotronResultFile(url: unknown): Promise<NemotronResultFile | undefined> {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return undefined
  for (let attempt = 0; attempt <= RESULT_FILE_BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await sleep(RESULT_FILE_BACKOFF_MS[attempt - 1]!)
    try {
      const res = await safeFetch(url, { timeoutMs: 20_000 })
      if (res.ok) {
        const body = (await res.json()) as unknown
        if (body && typeof body === "object" && !Array.isArray(body)) return body as NemotronResultFile
        return undefined
      }
      console.warn(`[KIE.ai] Nemotron result file: HTTP ${res.status} (try ${attempt + 1})`)
    } catch (err) {
      console.warn(`[KIE.ai] Nemotron result file unreadable (try ${attempt + 1}):`, err instanceof Error ? err.message : err)
    }
  }
  return undefined
}

/** What KIE billed for the task in USD, from its own `creditsConsumed` on the record; undefined when it says none. */
export function nemotronKieCostUsd(rawRecordInfo: Record<string, unknown> | undefined): number | undefined {
  return nemotronKieCostUsdOf(kieTaskCreditsConsumed(rawRecordInfo))
}

/** KIE credits → USD; undefined for none. */
export function nemotronKieCostUsdOf(kieCredits: number | undefined): number | undefined {
  return kieCredits === undefined ? undefined : Math.round(kieCredits * KIE_CREDIT_USD * 1e6) / 1e6
}

/** The `resultObject` of a finished task's `resultJson`, or a sanitized error when it is missing. */
export function nemotronResultObjectOf(resultJson: unknown): NemotronResultObject {
  const ro = (resultJson as { resultObject?: unknown } | null | undefined)?.resultObject
  if (!ro || typeof ro !== "object" || Array.isArray(ro)) {
    throw createSanitizedError("Nemotron task succeeded but no resultObject found", "Transcription")
  }
  return ro as NemotronResultObject
}

/**
 * A finished task's answer → the transcribe output, with what it cost us
 * (`cost`, USD): KIE's own figure (`kieCostUsd`, its `creditsConsumed`), else
 * its rate × the audio's length it decoded (`fallbackDurationSec` — our own
 * probe — when KIE did not say). Shared by the worker and the reconcile.
 */
export async function nemotronOutputFromResult(
  resultJson: unknown,
  opts: {
    readonly wordTimestamps?: boolean
    readonly targetLanguage?: string
    readonly fallbackDurationSec?: number
    /** KIE's `creditsConsumed` for the task: what it billed, and the length to charge on when it reports no `duration`. */
    readonly kieCredits?: number
  },
): Promise<NemotronTranscribeOutput & { cost?: number; kieCredits?: number }> {
  const resultObject = nemotronResultObjectOf(resultJson)
  const file = await readNemotronResultFile(resultObject.url)
  const mapped = mapNemotronResult(resultObject, file, { ...opts, measuredSec: opts.fallbackDurationSec })
  const billedSec = mapped.durationSec ?? opts.fallbackDurationSec
  const kieCostUsd = nemotronKieCostUsdOf(opts.kieCredits)
  const cost = kieCostUsd ?? (billedSec !== undefined ? nemotronProviderCostUsd(billedSec) : undefined)
  return { ...mapped, ...(cost !== undefined ? { cost } : {}), ...(opts.kieCredits !== undefined ? { kieCredits: opts.kieCredits } : {}) }
}

/** Run one transcription (or translation) on KIE and map its answer. */
export async function runNemotronTranscribe(
  req: NemotronTranscribeRequest & { readonly fallbackDurationSec?: number },
  reconcileOpts?: ReconcileOpts,
): Promise<NemotronTranscribeOutput & { cost?: number; kieCredits?: number }> {
  const input = buildNemotronTranscribeInput(req)
  console.log(
    `[KIE.ai] Nemotron 3.5 Transcribe (${req.targetLanguage ? `translate → ${req.targetLanguage}` : req.wordTimestamps ? "word timings" : "transcript"})`,
  )
  const { resultJson, rawRecordInfo } = await runKieTask(NEMOTRON_KIE_MODEL, input, MAX_POLL_ATTEMPTS_VIDEO, undefined, {
    ...reconcileOpts,
    modelKey: NEMOTRON_TRANSCRIBE_ID,
    // KIE bills this model per second of the audio: the measured length is the
    // billing dimension an egress decorator reads (the body carries none).
    ...(req.fallbackDurationSec !== undefined
      ? { dimensions: { ...reconcileOpts?.dimensions, duration: req.fallbackDurationSec, durationLabel: `${Math.round(req.fallbackDurationSec)}s` } }
      : {}),
  })
  const kieCredits = kieTaskCreditsConsumed(rawRecordInfo)
  const out = await nemotronOutputFromResult(resultJson, { ...req, ...(kieCredits !== undefined ? { kieCredits } : {}) })
  if (out.truncated) {
    console.warn("[KIE.ai] Nemotron: the output hit its length limit for the audio (truncated) — it may repeat itself")
  }
  return out
}
