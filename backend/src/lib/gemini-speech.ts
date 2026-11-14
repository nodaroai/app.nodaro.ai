/**
 * Delivering a Gemini speech run (KIE) — one speaker (text to speech) or a
 * dialogue: its WAV → the file the request asked for → storage → the job's
 * completion. ONE path for the worker and for the reconcile's recovery of a
 * task whose worker died (lib/reconcile/kie.ts), so a recovered job carries
 * exactly what a worker-finished one does: the format asked for,
 * `billedCharacters`, `audioMimeType` and the task's own cost. A dialogue
 * takes the same formats as one speaker (decided 2026-11-13).
 *
 * The file: KIE renders a WAV (24 kHz, mono, 16-bit). `wav_24000` keeps it as
 * rendered; an MP3 format (the default when none is asked) is encoded from it
 * (providers/audio/speech-mp3.ts), so every speech model answers the same
 * `outputFormat` with the same kind of file (decided 2026-11-12).
 */
import {
  DEFAULT_TTS_OUTPUT_FORMAT,
  TTS_OUTPUT_FORMATS,
  TTS_OUTPUT_FORMAT_FILES,
  type TtsOutputFormat,
} from "@nodaro/shared/models"
import { canonicalTtsProvider, getTtsCapabilities } from "@nodaro/shared/model-catalog"
import { getDialogueCapabilities } from "@nodaro/shared/models"
import { sentDialogueLines, sentSpeechText } from "@nodaro/prompts/prompt-fields"
import { safeFetch } from "./safe-fetch.js"
import { supabase } from "./supabase.js"
import { uploadBufferToR2, mediaObjectKey } from "./storage.js"
import { runPostProcessing } from "./post-processing-error.js"
import { finalizeJobWithMedia, type FinalizeClaimant } from "./job-finalize.js"
import { KIE_CREDIT_USD, KIE_TTS_MODELS } from "../providers/kie/models.js"
import { isGeminiTtsModel } from "../providers/kie/gemini-tts-models.js"
import { isMp3SpeechFormat, wavToMp3 } from "../providers/audio/speech-mp3.js"

/** The format a request asked for when it is one the platform offers; anything else (absent, stale) is the default MP3. */
export function speechOutputFormatOf(value: unknown): TtsOutputFormat {
  return typeof value === "string" && (TTS_OUTPUT_FORMATS as readonly string[]).includes(value) ? (value as TtsOutputFormat) : DEFAULT_TTS_OUTPUT_FORMAT
}

/** The text a Gemini request sends, from the text it carries (`sentSpeechText`: its tags in the model's syntax, then the cap). Its length is what the run is billed for. */
export function geminiSpeechSentText(provider: string, text: string): string {
  return sentSpeechText(text, getTtsCapabilities(provider))
}

/**
 * The lines a Gemini dialogue sends, from the lines it carries
 * (`sentDialogueLines`: each line's tags in the model's syntax, the script cut
 * once at the model's total cap). Their lengths, summed, are what the run is
 * billed for — the count every reservation of it made (`dialogueBaseCredits`).
 */
export function geminiDialogueSentLines(provider: string, lines: unknown): string[] {
  return sentDialogueLines(lines, getDialogueCapabilities(provider))
}

/** KIE's WAV as the file `format` names. */
export async function geminiSpeechAudio(wavUrl: string, format: TtsOutputFormat): Promise<Buffer> {
  const res = await safeFetch(wavUrl)
  if (!res.ok) throw new Error(`could not download the generated audio (${res.status})`)
  const wav = Buffer.from(await res.arrayBuffer())
  return isMp3SpeechFormat(format) ? wavToMp3(wav, format) : wav
}

/** What this run cost the platform: the task's own KIE credits, else the listed rate for the characters sent. */
export function geminiSpeechCostUsd(provider: string, billedCharacters: number, kieCredits: number | undefined): number | null {
  if (kieCredits !== undefined) return kieCredits * KIE_CREDIT_USD
  const listed = KIE_TTS_MODELS[provider]?.cost
  return listed === undefined ? null : (listed * billedCharacters) / 1000
}

/** The finalize job type a Gemini run completes as: one speaker's, or a dialogue's (the ElevenLabs dialogue lane's own). */
export type GeminiSpeechJobType = "text-to-speech" | "generate-dialogue"

export interface DeliverGeminiSpeechArgs {
  jobId: string
  /** Absent ⇒ one speaker's ("text-to-speech"). */
  jobType?: GeminiSpeechJobType
  userId?: string
  provider: string
  /** KIE's WAV. */
  wavUrl: string
  /** The format the request asked for (`TTS_OUTPUT_FORMATS`); anything else is the default MP3. */
  outputFormat: unknown
  /** Characters sent (`geminiSpeechSentText(...).length`; a dialogue's sent lines, summed). */
  billedCharacters: number
  kieCredits?: number
  providerMs?: number
  claimant?: FinalizeClaimant
}

/** Store the run's file and complete its job. `ok` false when another claimant finished it first. */
export async function deliverGeminiSpeech(args: DeliverGeminiSpeechArgs): Promise<{ ok: boolean; url: string }> {
  const { jobId } = args
  const format = speechOutputFormatOf(args.outputFormat)
  const file = TTS_OUTPUT_FORMAT_FILES[format]
  // POST-PROVIDER: KIE already delivered the audio (we were billed) — a failure
  // from here on is post-delivery, as an ElevenLabs run's upload is.
  const audio = await runPostProcessing(() => geminiSpeechAudio(args.wavUrl, format))
  // The job's own slot, the key the worker's ElevenLabs path stores under.
  const url = await runPostProcessing(() => uploadBufferToR2(audio, mediaObjectKey(jobId, "audio", file.ext), file.mime, args.userId))
  const { ok } = await finalizeJobWithMedia({
    jobId,
    jobType: args.jobType ?? "text-to-speech",
    ...(args.claimant ? { claimant: args.claimant } : {}),
    result: {
      url,
      cost: geminiSpeechCostUsd(args.provider, args.billedCharacters, args.kieCredits),
      providerUsed: "kie",
      ...(args.providerMs !== undefined && { providerMs: args.providerMs }),
    },
    extraOutputData: { billedCharacters: args.billedCharacters, audioMimeType: file.mime },
    mediaUrl: url,
  })
  return { ok, url }
}

/** A stuck job row as the reconcile reads it. */
export interface SpeechJobRow {
  id: string
  job_type: string | null
  input_data?: Record<string, unknown> | null
}

/** A recorded Gemini run, as its recovery delivers it. */
export interface GeminiSpeechJob {
  jobType: GeminiSpeechJobType
  provider: string
  /** What the run was sent and billed for, from the request it recorded (the worker's own rule). */
  billedCharacters: number
  outputFormat: unknown
}

/**
 * The Gemini speech request a job row recorded, or undefined for any other
 * row: a text-to-speech row (the route's and the workflow engine's
 * `input_data` both carry `text`, the model and the format asked for) or a
 * text-to-dialogue row (both carry `dialogue`, the model and the format asked for).
 */
export function geminiSpeechJobOf(row: SpeechJobRow): GeminiSpeechJob | undefined {
  if (row.job_type !== "text-to-speech" && row.job_type !== "text-to-dialogue") return undefined
  const input = row.input_data ?? {}
  const named = typeof input.resolvedModel === "string" ? input.resolvedModel : typeof input.provider === "string" ? input.provider : undefined
  if (row.job_type === "text-to-dialogue") {
    if (!isGeminiTtsModel(named)) return undefined
    return {
      jobType: "generate-dialogue",
      provider: named,
      billedCharacters: geminiDialogueSentLines(named, input.dialogue).reduce((n, t) => n + t.length, 0),
      outputFormat: input.outputFormat,
    }
  }
  const provider = named === undefined ? undefined : canonicalTtsProvider(named)
  if (!isGeminiTtsModel(provider)) return undefined
  const text = typeof input.text === "string" ? input.text : ""
  return { jobType: "text-to-speech", provider, billedCharacters: geminiSpeechSentText(provider, text).length, outputFormat: input.outputFormat }
}

/**
 * Deliver a Gemini speech task whose worker died, from its finished result,
 * exactly as the worker would have.
 */
export async function recoverGeminiSpeechJob(
  row: SpeechJobRow,
  result: { url: string; kieCredits?: number; providerMs?: number },
  claimant: FinalizeClaimant,
): Promise<void> {
  const job = geminiSpeechJobOf(row)
  if (!job) throw new Error(`not a Gemini speech job: ${row.id}`)
  // trash-read: the reconcile delivers the job it recovers, as the worker would — a job's own lifecycle finishes whether or not it was deleted (its owner, for the stored file's account)
  const { data } = await supabase.from("jobs").select("user_id").eq("id", row.id).maybeSingle()
  const userId = (data as { user_id?: string | null } | null)?.user_id ?? undefined
  await deliverGeminiSpeech({
    jobId: row.id,
    jobType: job.jobType,
    ...(userId ? { userId } : {}),
    provider: job.provider,
    wavUrl: result.url,
    outputFormat: job.outputFormat,
    billedCharacters: job.billedCharacters,
    ...(result.kieCredits !== undefined && { kieCredits: result.kieCredits }),
    ...(result.providerMs !== undefined && { providerMs: result.providerMs }),
    claimant,
  })
}
