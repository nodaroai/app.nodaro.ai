import type { Caption } from "@remotion/captions"
import type { Transcript } from "@nodaro/shared/edl"
import {
  type TranscribeLane,
  transcribeLaneSupportsWordTimestamps,
  transcribeProvidersWithWordTimestamps,
  DEFAULT_TRANSCRIBE_PROVIDER,
} from "@nodaro/shared/models"
import { transcribeTranslationRefusal, transcribeTargetLanguageOf } from "@nodaro/shared/nodes"
import { replicate, extractCost } from "../replicate/client.js"
import { withReplicateRequestFailure } from "../replicate/failure-messages.js"
import { directSpeechToText } from "../elevenlabs/direct-stt.js"
import {
  mapWhisperOutput,
  mapFastWhisperOutput,
  wordTimestampContractBreak,
  type WhisperOutput,
  type FastWhisperOutput,
} from "./transcribe-output.js"
import { scribeWordsToCaptions } from "./captions-mappers.js"
import { buildTranscriptFromOutput } from "./transcript-normalize.js"
import { runNemotronTranscribe } from "../kie/nemotron-transcribe.js"

/**
 * A transcript with its non-speech annotations removed — `[music]`,
 * `[laughter]`, `(applause)`. Scribe emits those in `text` when
 * `tagAudioEvents` is on but files them as `type: "audio_event"` entries, which
 * `directSpeechToText` filters out of `words`. So "text is non-empty" is NOT
 * "there was speech", and only the stripped form can answer that question.
 */
function stripAudioEventTags(text: string): string {
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, "").trim()
}

function extractVersion(modelString: string): string {
  const parts = modelString.split(":")
  if (parts.length < 2 || !parts[1]) {
    throw new Error(`transcribe model "${modelString}" missing version hash (expected "owner/name:hash")`)
  }
  return parts[1]
}

/** Alias of the shared lane union — the capability table is keyed by it. */
export type TranscribeProvider = TranscribeLane

interface TranscribeResult {
  text: string
  language: string
  cost?: number
  segments?: Array<{
    start: number
    end: number
    text: string
  }>
  /** Caption-shaped words (ms). `speaker` present only on diarized elevenlabs-stt runs. */
  words?: Array<Caption & { speaker?: string }>
  /** Normalized `Transcript` — the node's `json` output handle (always set). */
  json?: Transcript
  /** Nemotron: KIE says the output hit its length limit for the audio (it usually repeats itself). */
  truncated?: true
  /** Nemotron: the audio's length KIE decoded and billed (seconds) — what the run is charged for. */
  billedDurationSec?: number
  /** Nemotron: KIE's `creditsConsumed` for the task — the length to charge on when it reports no duration. */
  billedKieCredits?: number
}

const TRANSCRIBE_MODELS: Record<string, string> = {
  whisper: "openai/whisper:8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e",
  "incredibly-fast-whisper": "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c",
}

export async function transcribe(
  audioUrl: string,
  provider?: TranscribeProvider,
  language?: string,
  options?: {
    diarize?: boolean
    tagAudioEvents?: boolean
    wordTimestamps?: boolean
    /** Translate the speech into this language instead (Nemotron 3.5
     *  Transcribe only, never with word timings — refused below otherwise). */
    targetLanguage?: string
    /** Persist the provider's task id so a stall-retry reconciles instead of
     *  re-billing the transcribe call: the Replicate prediction id on the two
     *  whisper paths, the KIE task id on Nemotron (the caller picks the kind,
     *  `transcribeTaskKind`). Not fired on the direct Scribe path. */
    onTaskCreated?: (taskId: string) => void | Promise<void>
    /** Nemotron: the file's length as the route / workflow run measured it —
     *  the provider cost's fallback when KIE does not report the length. */
    durationSec?: number
  },
): Promise<TranscribeResult> {
  const resolvedProvider = provider ?? DEFAULT_TRANSCRIBE_PROVIDER
  const targetLanguage = transcribeTargetLanguageOf(options?.targetLanguage)

  // A translation is one engine's ability (Nemotron 3.5 Transcribe), into the
  // languages KIE lists, and never together with word timings. Refused here —
  // before any provider call — for every caller that bypasses the route's Zod
  // (the orchestrator/DAG path builds its payload straight from node data).
  const translationRefusal = transcribeTranslationRefusal(resolvedProvider, targetLanguage, options?.wordTimestamps)
  if (translationRefusal) {
    throw new Error(`Transcription refused: ${translationRefusal}.`)
  }

  // Word timings are a per-lane CAPABILITY, and the incapable lane fails
  // silently: Replicate drops an unknown input key, so openai/whisper returns
  // segments with no `words`, the mapper yields [], and the job "succeeds" with
  // an empty word list after the credits are spent. Fail here — before any
  // provider call — so the caller learns the request is impossible instead of
  // paying for an answer that cannot contain what was asked for. This is the
  // gate for every caller that bypasses the route's Zod (the orchestrator/DAG
  // path builds its payload straight from node data).
  // (Asked through the shared helper, not by indexing the capability table: a
  // provider string from node data / an imported workflow can be anything at
  // all, and a bare index would answer that with a TypeError instead of this
  // message.)
  if (options?.wordTimestamps && !transcribeLaneSupportsWordTimestamps(resolvedProvider)) {
    throw new Error(
      `Transcription provider "${resolvedProvider}" does not return word timestamps. ` +
        `Use ${transcribeProvidersWithWordTimestamps().join(" or ")}.`,
    )
  }

  console.log(`[transcribe] Provider: ${resolvedProvider}`)
  console.log(`[transcribe] Audio URL: "${audioUrl}", Language: ${language ?? "auto"}`)

  if (resolvedProvider === "elevenlabs-stt") {
    // DIRECT Scribe — not KIE. KIE wraps this exact model behind a job queue that
    // stalls ("[500] The upstream API service timed out") and has hung ~15 min on a
    // stuck task; voice-changer-pro's diarizer already moved to direct Scribe after
    // that incident (~1-2s on real clips) and this route now matches it, so speaker
    // detection stops inheriting the flakiness.
    const result = await directSpeechToText(audioUrl, {
      languageCode: language && language !== "auto" ? language : undefined,
      diarize: options?.diarize,
      tagAudioEvents: options?.tagAudioEvents,
    })
    // Caption-shaped (ms), never raw seconds — `output_data.words` is a wire
    // contract shared with the add-captions consumers; the mapper adds the
    // leading-space word delimiter the kinetic overlays rely on.
    const words = scribeWordsToCaptions(result.words)
    // Scribe is declared ALWAYS word-level (the flag changes nothing), so the
    // same contract applies here as on the incredibly-fast-whisper lane: speech
    // in, word timings out, or the job fails and refunds rather than handing
    // back a transcript whose `json.words` is empty — which every caption
    // consumer downstream reads as "this clip has no words".
    // "Speech" is measured with the audio-event tags REMOVED: with
    // `tagAudioEvents` on, a music-only clip legitimately comes back as
    // `text: "[music]"` with zero word entries, and failing that would break a
    // run that works today.
    if (words.length === 0 && stripAudioEventTags(result.text).length > 0) {
      throw wordTimestampContractBreak("the response carried speech but no word entries")
    }
    return {
      text: result.text,
      language: result.language,
      // No metered provider cost: the KIE figure was an average estimate of KIE's
      // price, and we no longer pay KIE for this. Omitting it commits the RESERVED
      // tier (user-facing credits unchanged), the same way the youtube-audio
      // handler already commits without a metered cost.
      ...(words.length ? { words } : {}),
      // Scribe is word-level regardless of `wordTimestamps`, so the json handle
      // always carries word timings for the default provider (no segments —
      // Scribe emits none). The mapper layer sets `json` on the whisper paths.
      json: buildTranscriptFromOutput({ language: result.language, words }),
    }
  }

  if (resolvedProvider === "nemotron-3-5-transcribe") {
    // KIE-hosted; priced per minute of the file (the route and the workflow
    // run measured it before the hold). No `language` is sent: the model
    // detects it and has no such input. Words (with a speaker each) only when
    // asked — and the "speech in, words out" contract is enforced by the mapper.
    const result = await runNemotronTranscribe(
      {
        audioUrl,
        wordTimestamps: options?.wordTimestamps,
        targetLanguage,
        fallbackDurationSec: options?.durationSec,
      },
      options?.onTaskCreated ? { onTaskCreated: async (taskId) => { await options.onTaskCreated?.(taskId) } } : undefined,
    )
    return {
      text: result.text,
      language: result.language,
      ...(result.words ? { words: result.words } : {}),
      ...(result.segments ? { segments: result.segments } : {}),
      json: result.json,
      ...(result.cost !== undefined ? { cost: result.cost } : {}),
      ...(result.truncated ? { truncated: true as const } : {}),
      ...(result.durationSec !== undefined ? { billedDurationSec: result.durationSec } : {}),
      ...(result.kieCredits !== undefined ? { billedKieCredits: result.kieCredits } : {}),
    }
  }

  const model = TRANSCRIBE_MODELS[resolvedProvider as keyof typeof TRANSCRIBE_MODELS] ?? TRANSCRIBE_MODELS.whisper

  if (resolvedProvider === "incredibly-fast-whisper") {
    const input: Record<string, unknown> = {
      audio: audioUrl,
      task: "transcribe",
      timestamp: options?.wordTimestamps ? "word" : "chunk",
      batch_size: 24,
    }
    if (language && language !== "auto") {
      input.language = language
    } else {
      input.language = "None"
    }

    const prediction = await withReplicateRequestFailure("[transcribe]", () =>
      replicate.predictions.create({
        version: extractVersion(model),
        input,
      }),
    )
    await options?.onTaskCreated?.(prediction.id)
    const completed = await withReplicateRequestFailure("[transcribe]", () => replicate.wait(prediction))
    const cost = extractCost(completed.metrics as Record<string, unknown> | undefined, "incredibly-fast-whisper")
    const output = completed.output as FastWhisperOutput

    console.log(`[transcribe] Output text length: ${output.text?.length ?? 0}`)
    return {
      // enforceWordTimestamps: this is the live lane, so an empty word list on
      // audio that has speech is a provider contract break — fail (and refund)
      // rather than hand back a silently word-less transcript.
      ...mapFastWhisperOutput(output, {
        language,
        wordTimestamps: options?.wordTimestamps,
        enforceWordTimestamps: options?.wordTimestamps,
      }),
      cost: cost ?? undefined,
    }
  }

  // Default: openai/whisper. No `word_timestamps` key is sent — the model has
  // no such input in any published version, so Replicate silently dropped it
  // and the flag never did anything. `wordTimestamps` is rejected above for
  // this lane, so nothing reaches here asking for them.
  const input: Record<string, unknown> = {
    audio: audioUrl,
    transcription: "plain text",
  }
  if (language && language !== "auto") {
    input.language = language
  }

  const prediction = await withReplicateRequestFailure("[transcribe]", () =>
    replicate.predictions.create({
      version: extractVersion(model),
      input,
    }),
  )
  await options?.onTaskCreated?.(prediction.id)
  const completed = await withReplicateRequestFailure("[transcribe]", () => replicate.wait(prediction))
  const cost = extractCost(completed.metrics as Record<string, unknown> | undefined, "whisper")
  const output = completed.output as WhisperOutput

  console.log(`[transcribe] Detected language: ${output.detected_language}`)
  console.log(`[transcribe] Output text length: ${output.transcription?.length ?? 0}`)
  return {
    ...mapWhisperOutput(output, { wordTimestamps: options?.wordTimestamps }),
    cost: cost ?? undefined,
  }
}
