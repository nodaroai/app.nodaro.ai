/**
 * Suno Separate — split a Suno track, or any audio, into stems.
 *
 * Three lanes, picked per run (`pickSunoSeparateLane`) from the source the
 * editor and the workflow payload pick too (`pickSunoSeparateSource`,
 * @nodaro/render-rules): a task id separates the Suno track, else any audio
 * by URL — never both, so a URL beside the ids is ignored.
 *   - legacy     — a Suno track by `taskId` + `audioId` on the old
 *                  vocal-removal endpoint (`sunoSeparate`), exactly as before;
 *   - market-ids — the same Suno track in one-instrument mode, which only the
 *                  market endpoint offers (`sunoSeparateMarket`);
 *   - market-url — any audio by URL on the market endpoint.
 *
 * The market endpoint caps input at 20 MB and refuses a commercially released
 * recording. With `fallbackToDemucs` on, either case runs the Demucs provider
 * Audio Separation uses instead, and the run is charged the Demucs price for
 * its mode, not Suno's. One-instrument mode never falls back — Demucs cannot
 * isolate a named instrument.
 *
 * Every task id is registered as `providerKindForSuno()`, both lanes alike:
 * reconcile never polls a separate row (it bumps to exhaustion and refunds),
 * so a crash mid-run is "fail + refund", never a job completed with one URL
 * and no stems.
 */

import type { Job } from "bullmq"
import { pickSunoSeparateSource, type SunoSeparateSource } from "@nodaro/render-rules"
import {
  DEFAULT_SUNO_STEM_NAME,
  SUNO_SEPARATE_RESULT_FIELDS,
  sunoSeparateCreditId,
  sunoSeparatePrimaryUrl,
  type SunoSeparateType,
  type SunoStemName,
} from "@nodaro/shared/models"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import { providerKindForSuno } from "../../lib/reconcile/provider-kind.js"
import { safeFetch } from "../../lib/safe-fetch.js"
import { getR2ObjectSize, r2KeyFromOurUrl, uploadToR2 } from "../../lib/storage.js"
import { sunoSeparate, type SunoSeparateResult } from "../../providers/kie/suno-client.js"
import {
  SUNO_CATALOG_REFUSAL_SINGLE_MESSAGE,
  SunoCatalogRefusalError,
  SunoInputTooLargeError,
  sunoSeparateMarket,
} from "../../providers/kie/suno-separate-market.js"
import { isOurMediaUrl } from "../../providers/nodaro/client.js"
import type { AudioSeparationResult, ReconcileOpts } from "../../providers/provider.interface.js"
import { ReplicateAudioSeparationProvider } from "../../providers/replicate/audio-separation.js"
import {
  commitJobCredits,
  commitJobCreditsAtChargedPrice,
  markJobCompleted,
  setJobProgress,
  shouldSaveJobResult,
  withProgressRamp,
  type HandlerFn,
  type JobContext,
} from "../shared.js"
import { cloudTaskId, maybeSunoCloudOutput, type SunoProviderUsed } from "./suno-cloud.js"

/** The `suno-separate` job payload. The route enqueues exactly these keys. */
export interface SunoSeparateJobData {
  jobId: string
  taskId?: string
  audioId?: string
  audioUrl?: string
  separateType?: SunoSeparateType
  stemName?: SunoStemName
  fallbackToDemucs?: boolean
  usageLogId?: string
}

export type SunoSeparateLane = "legacy" | "market-ids" | "market-url"

const NO_SOURCE_MESSAGE = "Connect a Suno track or any audio to separate."

/** Input cap of the market endpoint, in bytes. */
export const SUNO_SEPARATE_MAX_INPUT_BYTES = 20 * 1024 * 1024

/** How long the size probe's HEAD may take before the size counts as unknown. */
const SIZE_PROBE_TIMEOUT_MS = 10_000

/**
 * Credit id of the Demucs run a refused separation falls back to, or `null`
 * for one-instrument mode — Demucs cannot isolate a named instrument, so that
 * mode never falls back.
 */
export function demucsFallbackCreditId(type: SunoSeparateType): "audio-separation" | "audio-separation:stems" | null {
  if (type === "split_stem_advanced") return null
  if (type === "split_stem") return "audio-separation:stems"
  return "audio-separation"
}

/** Why a run went to Demucs instead of Suno. */
type FallbackReason = "catalog" | "too_large"

/** Who ran the separation, and so how it settles. */
interface SeparateOutcome {
  engine: "suno" | "demucs"
  provider: SunoProviderUsed | "replicate"
  fallbackReason?: FallbackReason
}

/** The source a job separates, by the shared rule. No source is a refusal. */
export function sunoSeparateSourceOf(d: Pick<SunoSeparateJobData, "taskId" | "audioId" | "audioUrl">): SunoSeparateSource {
  const source = pickSunoSeparateSource({ taskIds: [d.taskId], audioIds: [d.audioId], audioUrl: d.audioUrl })
  if (!source) throw new DeterministicJobError(NO_SOURCE_MESSAGE)
  return source
}

/**
 * The lane a source takes. A Suno track stays on the old endpoint unless it
 * asks for one instrument; any other audio goes to the market endpoint by URL.
 */
export function pickSunoSeparateLane(source: SunoSeparateSource, type: SunoSeparateType): SunoSeparateLane {
  if (source.taskId) return type === "split_stem_advanced" ? "market-ids" : "legacy"
  return "market-url"
}

// Demucs stem → the Suno result field it fills.
const DEMUCS_TO_SUNO_FIELD = [
  ["vocals", "vocalUrl"],
  ["instrumental", "instrumentalUrl"],
  ["drums", "drumsUrl"],
  ["bass", "bassUrl"],
  ["guitar", "guitarUrl"],
  ["piano", "pianoUrl"],
  ["other", "otherUrl"],
] as const

/** A Demucs result in the Suno result's field names; stems it did not return are left out. */
export function demucsToSunoFields(r: AudioSeparationResult): Partial<SunoSeparateResult> {
  return Object.fromEntries(
    DEMUCS_TO_SUNO_FIELD.flatMap(([stem, field]) => {
      const url = r[stem]
      return url ? [[field, url] as const] : []
    }),
  )
}

/**
 * The input's size in bytes, or `undefined` when it cannot be told (then the
 * run proceeds and Suno judges). Our own media is sized by the bucket; any
 * other URL by a safe HEAD's `content-length`.
 */
export async function sunoInputByteSize(url: string): Promise<number | undefined> {
  try {
    if (isOurMediaUrl(url)) {
      const key = r2KeyFromOurUrl(url)
      const stored = key ? await getR2ObjectSize(key) : 0
      if (stored > 0) return stored
    }
    const head = await safeFetch(url, { method: "HEAD", timeoutMs: SIZE_PROBE_TIMEOUT_MS })
    if (!head.ok) return undefined
    const declared = Number(head.headers.get("content-length") ?? "")
    return Number.isFinite(declared) && declared > 0 ? declared : undefined
  } catch {
    return undefined
  }
}

/** The Suno call for a source. */
function sunoCallFor(
  source: SunoSeparateSource,
  type: SunoSeparateType,
  stemName: SunoStemName | undefined,
  opts: ReconcileOpts,
): () => Promise<SunoSeparateResult> {
  const named = stemName ? { stemName } : {}
  if (source.audioUrl !== undefined) {
    const { audioUrl } = source
    return () => sunoSeparateMarket({ source: { audioUrl }, type, ...named }, opts)
  }
  const { taskId, audioId } = source
  // The `legacy` lane: the old endpoint has no one-instrument mode, so this
  // test is pickSunoSeparateLane's rule itself (a legacy run with that mode
  // cannot be built) and narrows `type` to what the endpoint takes.
  if (type !== "split_stem_advanced") return () => sunoSeparate({ taskId, audioId, type }, opts)
  return () => sunoSeparateMarket({ source: { taskId, audioId }, type, ...named }, opts)
}

/**
 * Shared tail for suno-separate: uploads whichever result fields the run
 * carries — Suno-delivered, Demucs-delivered or the connected cloud's R2 —
 * into THIS instance's R2 under `<jobId>-<field minus Url>` keys, persists one
 * output shape, and settles: a Suno run commits as reserved, a Demucs run at
 * the Demucs price for the mode.
 */
async function finalizeSunoSeparate(
  job: Job,
  ctx: JobContext,
  result: Partial<SunoSeparateResult>,
  type: SunoSeparateType,
  stemName: SunoStemName | undefined,
  outcome: SeparateOutcome,
): Promise<void> {
  // One instrument without its isolated take is no result, not a partial one.
  if (type === "split_stem_advanced" && !result.isolatedUrl) {
    throw new Error(outcome.provider === "nodaro" ? "nodaro.ai returned no stems" : "Suno separate returned no stems")
  }
  await setJobProgress(job, ctx.jobId, 50)

  // Upload in parallel. POST-PROVIDER: these are the delivered (billed)
  // separation — an R2 upload failure here skips the refund.
  const uploaded = await runPostProcessing(() =>
    Promise.all(
      SUNO_SEPARATE_RESULT_FIELDS.flatMap((field) => {
        const url = result[field]
        if (!url) return []
        const stem = field.replace("Url", "")
        return [uploadToR2(url, `${ctx.jobId}-${stem}`, "audio", ctx.jobUserId).then((r2Url) => [field, r2Url] as const)]
      }),
    ),
  )
  const urls: Record<string, string> = Object.fromEntries(uploaded)

  const outputData: Record<string, unknown> = {
    separateType: type,
    ...(stemName ? { stemName } : {}),
    ...(result.taskId ? { sunoTaskId: result.taskId } : {}),
    ...urls,
    // Primary audioUrl for single-handle downstream routing + gallery.
    audioUrl: sunoSeparatePrimaryUrl(urls),
    engineUsed: outcome.engine,
    ...(outcome.engine === "demucs" ? { sunoRefused: true } : {}),
    ...(outcome.fallbackReason ? { fallbackReason: outcome.fallbackReason } : {}),
  }

  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, { output_data: outputData, provider: outcome.provider })
  if (!ok) return
  const fallbackId = demucsFallbackCreditId(type)
  if (outcome.engine === "demucs" && fallbackId) {
    await commitJobCreditsAtChargedPrice(ctx.usageLogId, ctx.jobId, fallbackId)
  } else {
    await commitJobCredits(ctx.usageLogId, ctx.jobId)
  }
  console.log(`[worker] Job ${ctx.jobId} completed: ${uploaded.length} stem(s) uploaded (${outcome.engine})`)
}

/** Separate on Demucs instead of Suno, and finish the job at the Demucs price. */
async function runDemucsFallback(
  job: Job,
  ctx: JobContext,
  audioUrl: string,
  type: SunoSeparateType,
  reason: FallbackReason,
): Promise<void> {
  console.log(`[worker] suno-separate ${ctx.jobId}: Suno refused (${reason}) — separating with Demucs`)
  const provider = new ReplicateAudioSeparationProvider()
  // No onTaskCreated: a crash fails + refunds rather than being single-URL
  // reconcile-recovered (which would flatten the stems) — as Audio Separation.
  const separated = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => provider.separateAudio(audioUrl, { mode: type === "split_stem" ? "stems" : "vocal_instrumental", quality: "auto" }),
  )
  const fields = demucsToSunoFields(separated)
  if (Object.keys(fields).length === 0) throw new Error("Demucs returned no stems")
  await finalizeSunoSeparate(job, ctx, fields, type, undefined, { engine: "demucs", provider: "replicate", fallbackReason: reason })
}

/** The connected cloud ran the job: re-host what it returned, keep how it ran. */
async function finalizeFromCloud(
  job: Job,
  ctx: JobContext,
  cloud: Record<string, unknown>,
  type: SunoSeparateType,
  stemName: SunoStemName | undefined,
): Promise<void> {
  // The cloud's output_data carries the SAME field names with URLs on ITS
  // storage; the shared tail re-downloads them under this instance's keys.
  // An empty separation is a failure, not an empty success.
  const fields = Object.fromEntries(
    SUNO_SEPARATE_RESULT_FIELDS.flatMap((field) => {
      const url = cloud[field]
      return typeof url === "string" && url ? [[field, url] as const] : []
    }),
  )
  if (Object.keys(fields).length === 0) throw new Error("nodaro.ai returned no stems")
  const engine = cloud.engineUsed === "demucs" ? "demucs" : "suno"
  const reason = cloud.fallbackReason === "catalog" || cloud.fallbackReason === "too_large" ? cloud.fallbackReason : undefined
  await finalizeSunoSeparate(
    job,
    ctx,
    { taskId: cloudTaskId(cloud), ...fields },
    type,
    stemName,
    { engine, provider: "nodaro", ...(reason ? { fallbackReason: reason } : {}) },
  )
}

export const handleSunoSeparate: HandlerFn = async function handleSunoSeparate(job, ctx) {
  const d = job.data as SunoSeparateJobData
  const type: SunoSeparateType = d.separateType ?? "separate_vocal"
  const stemName = type === "split_stem_advanced" ? (d.stemName ?? DEFAULT_SUNO_STEM_NAME) : undefined
  const fallbackOn = d.fallbackToDemucs === true && demucsFallbackCreditId(type) !== null
  // A URL beside the ids (a job queued before the shared rule) is ignored:
  // the ids lane neither size-probes it nor falls back to Demucs on it.
  const source = sunoSeparateSourceOf(d)
  console.log(
    `[worker] suno-separate ${ctx.jobId} (type: ${type}${stemName ? `, stem: ${stemName}` : ""}, ` +
    `lane: ${pickSunoSeparateLane(source, type)}${source.audioId ? `, audioId: ${source.audioId}` : ""}` +
    `${fallbackOn ? ", demucs fallback on" : ""})`,
  )

  const cloud = await maybeSunoCloudOutput(job, ctx, "suno-separate")
  if (cloud) return finalizeFromCloud(job, ctx, cloud, type, stemName)

  const fallbackUrl = source.audioUrl
  if (fallbackUrl) {
    const size = await sunoInputByteSize(fallbackUrl)
    if (size !== undefined && size > SUNO_SEPARATE_MAX_INPUT_BYTES) {
      if (fallbackOn) return runDemucsFallback(job, ctx, fallbackUrl, type, "too_large")
      throw new SunoInputTooLargeError()
    }
  }

  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForSuno())
  const call = sunoCallFor(source, type, stemName, { onTaskCreated, modelKey: sunoSeparateCreditId(type) })
  let result: SunoSeparateResult
  try {
    result = await withProgressRamp(job, ctx.jobId, { start: 5, cap: 45 }, call)
  } catch (err) {
    if (!(err instanceof SunoCatalogRefusalError)) throw err
    // The refused KIE task id stays on the row while Demucs runs, harmlessly:
    // reconcile never polls a separate row's task id, it only bumps the row
    // to exhaustion, so the stale id can never complete the job.
    // On the ids lane there is no URL to fall back on — Suno does not refuse
    // its own tracks, so a refusal there just fails and refunds.
    if (fallbackOn && fallbackUrl) return runDemucsFallback(job, ctx, fallbackUrl, type, "catalog")
    if (type === "split_stem_advanced") throw new SunoCatalogRefusalError(SUNO_CATALOG_REFUSAL_SINGLE_MESSAGE, { cause: err })
    throw err
  }
  await finalizeSunoSeparate(job, ctx, result, type, stemName, { engine: "suno", provider: "kie" })
}
