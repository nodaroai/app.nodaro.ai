import type { Caption } from "@remotion/captions"
import { ADD_CAPTIONS_KINETIC_CREDIT_ID, NEMOTRON_TRANSCRIBE_ID } from "@nodaro/shared/credits"
import {
  ADD_CAPTIONS_NEMOTRON_MINUTE_IDS,
  commitNemotronCharge,
  nemotronChargeDecision,
} from "./nemotron-transcribe-settle.js"
import { discardJobScratchFile, uploadJobScratchFile } from "./job-scratch.js"
import { cleanupWorkDir } from "../providers/video/ffmpeg-utils.js"
import { extractAudioTrack, NoAudioTrackError } from "../providers/video/extract-audio-track.js"
import { transcribe } from "../providers/audio/transcribe.js"

/**
 * Add Captions transcribing on Nemotron 3.5 Transcribe (decided 2026-11-13) —
 * the run and the settle; the hold is `./add-captions-nemotron.ts`.
 *
 *  - RUN: the video worker extracts the video's audio track, stores it in the
 *    job's scratch folder (a long-lived https link KIE can fetch), sends KIE
 *    that, always with word timings and never a translation, and deletes the
 *    file once the transcription is back.
 *  - SETTLE: the render worker, the one place this job commits, charges the
 *    minutes KIE decoded through the metered commit (the Transcribe node's
 *    fallbacks, 1 s grace and alert rule); a held run that relayed, or ran no
 *    transcription, settles down to the plain render. A failed or cancelled
 *    render refunds the whole hold, as on every engine.
 */

/**
 * How the render worker settles a caption render's hold, carried on its render
 * job: the per-minute charge of a Nemotron transcription that ran here (KIE's
 * figures), or a fixed id (the plain render: a held Nemotron run that relayed
 * or transcribed nothing). Absent: the hold is committed as it is, as before.
 */
export type AddCaptionsRenderCharge =
  | {
      readonly kind: "nemotron"
      readonly heldId: string
      readonly measuredSec?: number
      readonly kieSec?: number
      readonly kieCredits?: number
      /** What KIE billed for the transcription, in USD: the job's `provider_cost`. */
      readonly providerCost?: number
    }
  | { readonly kind: "at"; readonly heldId: string; readonly creditId: string }

function optionalNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

/** The render job's charge, read back from its data (validated: a job's data is JSON). */
export function addCaptionsRenderChargeOf(data: unknown): AddCaptionsRenderCharge | undefined {
  const c = (data as { captionsCharge?: unknown } | null | undefined)?.captionsCharge
  if (!c || typeof c !== "object") return undefined
  const r = c as Record<string, unknown>
  if (typeof r.heldId !== "string") return undefined
  if (r.kind === "at" && typeof r.creditId === "string") return { kind: "at", heldId: r.heldId, creditId: r.creditId }
  if (r.kind !== "nemotron") return undefined
  const measuredSec = optionalNumber(r.measuredSec)
  const kieSec = optionalNumber(r.kieSec)
  const kieCredits = optionalNumber(r.kieCredits)
  const providerCost = optionalNumber(r.providerCost)
  return {
    kind: "nemotron",
    heldId: r.heldId,
    ...(measuredSec !== undefined ? { measuredSec } : {}),
    ...(kieSec !== undefined ? { kieSec } : {}),
    ...(kieCredits !== undefined ? { kieCredits } : {}),
    ...(providerCost !== undefined ? { providerCost } : {}),
  }
}

/**
 * The id a finished caption render is charged at, or undefined: the hold
 * committed as it is. Logs the settle's warnings and `[ALERT]`s.
 */
export function addCaptionsRenderChargeId(jobId: string, charge: AddCaptionsRenderCharge | undefined): string | undefined {
  if (!charge) return undefined
  if (charge.kind === "at") return charge.creditId
  return nemotronChargeDecision(
    { jobId, heldId: charge.heldId, measuredSec: charge.measuredSec, kieSec: charge.kieSec, kieCredits: charge.kieCredits },
    ADD_CAPTIONS_NEMOTRON_MINUTE_IDS,
  )
}

/** The ONE commit of a finished caption render: the decided charge, else the hold as it is. */
export async function commitAddCaptionsRender(
  usageLogId: string | null | undefined,
  jobId: string,
  charge: AddCaptionsRenderCharge | undefined,
  chargeId: string | undefined,
): Promise<void> {
  await commitNemotronCharge(usageLogId, jobId, charge?.heldId, chargeId)
}

/** The plain render's id: what a held Nemotron caption run settles down to when no Nemotron transcription ran here. */
export function plainRenderCharge(heldId: string): AddCaptionsRenderCharge {
  return { kind: "at", heldId, creditId: ADD_CAPTIONS_KINETIC_CREDIT_ID }
}

/**
 * The charge a caption job hands its render, once its transcription is over:
 *  - a per-minute hold whose Nemotron transcription ran HERE → KIE's figures;
 *  - a per-minute hold with none (relayed: the cloud billed it; no audio
 *    track; nothing to transcribe) → the plain render, settled down;
 *  - the plain render held → nothing (the hold committed as it is). A Nemotron
 *    transcription that ran here on such a hold (the KIE key appeared between
 *    the hold and the run) is not charged on top: logged, never collected.
 */
export function captionsChargeAfterTranscription(
  jobId: string,
  heldId: string | undefined,
  run: NemotronCaptionTranscription | undefined,
  measuredSec: number | undefined,
): AddCaptionsRenderCharge | undefined {
  if (heldId === undefined) {
    if (run?.ranLocally) {
      console.warn(`[add-captions] job ${jobId}: Nemotron transcribed here on a hold of the render alone — charging the render`)
    }
    return undefined
  }
  if (!run?.ranLocally) return plainRenderCharge(heldId)
  return {
    kind: "nemotron",
    heldId,
    ...(measuredSec !== undefined ? { measuredSec } : {}),
    ...(run.kieSec !== undefined ? { kieSec: run.kieSec } : {}),
    ...(run.kieCredits !== undefined ? { kieCredits: run.kieCredits } : {}),
    ...(run.providerCost !== undefined ? { providerCost: run.providerCost } : {}),
  }
}

/** What a Nemotron transcription of a caption video hands the render, and what KIE billed. */
export interface NemotronCaptionTranscription {
  readonly words?: Caption[]
  readonly segments?: Array<{ start: number; end: number; text: string }>
  /** Run here (on this install's KIE key), not relayed: KIE's figures below are this job's. */
  readonly ranLocally: boolean
  readonly kieSec?: number
  readonly kieCredits?: number
  readonly providerCost?: number
}

/**
 * Transcribe a caption video on Nemotron 3.5 Transcribe: its audio track
 * extracted and stored in the job's scratch folder, and THAT sent (KIE takes a
 * file of up to 200 MB, which a video soon is not; its audio track is), always
 * with word timings; the stored file deleted once the transcription is back,
 * whatever happened. `relay` sends it to the cloud instead (a keyless,
 * connected install). Null when the video has no audio track: nothing to
 * transcribe, the same as a transcription with no words.
 */
export async function transcribeCaptionVideoOnNemotron(args: {
  readonly jobId: string
  readonly videoUrl: string
  readonly measuredSec?: number
  readonly relay?: (audioUrl: string) => Promise<{ words?: Caption[]; segments?: Array<{ start: number; end: number; text: string }> }>
}): Promise<NemotronCaptionTranscription | null> {
  let extracted: Awaited<ReturnType<typeof extractAudioTrack>>
  try {
    extracted = await extractAudioTrack(args.videoUrl)
  } catch (err) {
    if (err instanceof NoAudioTrackError) {
      console.warn(`[add-captions] job ${args.jobId}: the video has no audio track — nothing for Nemotron to transcribe`)
      return null
    }
    throw err
  }
  let audioUrl: string
  try {
    audioUrl = await uploadJobScratchFile(extracted.audioPath, "captions-audio", "mp3", "audio/mpeg", args.jobId)
  } finally {
    await cleanupWorkDir(extracted.workDir)
  }
  try {
    if (args.relay) {
      const relayed = await args.relay(audioUrl)
      return { ...relayed, ranLocally: false }
    }
    const result = await transcribe(audioUrl, NEMOTRON_TRANSCRIBE_ID, undefined, {
      wordTimestamps: true,
      ...(args.measuredSec !== undefined ? { durationSec: args.measuredSec } : {}),
    })
    return {
      ...(result.words ? { words: result.words } : {}),
      ...(result.segments ? { segments: result.segments } : {}),
      ranLocally: true,
      ...(result.billedDurationSec !== undefined ? { kieSec: result.billedDurationSec } : {}),
      ...(result.billedKieCredits !== undefined ? { kieCredits: result.billedKieCredits } : {}),
      ...(result.cost !== undefined ? { providerCost: result.cost } : {}),
    }
  } finally {
    await discardJobScratchFile(audioUrl, args.jobId)
  }
}
