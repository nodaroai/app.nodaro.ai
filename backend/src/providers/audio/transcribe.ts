import type { Caption } from "@remotion/captions"
import { replicate, extractCost } from "../replicate/client.js"
import { directSpeechToText } from "../elevenlabs/direct-stt.js"
import { fastWhisperWordsToCaptions, whisperWordsToCaptions } from "./captions-mappers.js"

function extractVersion(modelString: string): string {
  const parts = modelString.split(":")
  if (parts.length < 2 || !parts[1]) {
    throw new Error(`transcribe model "${modelString}" missing version hash (expected "owner/name:hash")`)
  }
  return parts[1]
}

export type TranscribeProvider = "whisper" | "incredibly-fast-whisper" | "elevenlabs-stt"

interface WhisperOutput {
  transcription: string
  detected_language: string
  segments?: Array<{
    id: number
    start: number
    end: number
    text: string
  }>
}

interface FastWhisperOutput {
  text: string
  chunks?: Array<{
    text: string
    timestamp: [number, number]
  }>
}

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
    /** Persist the Replicate prediction id so a stall-retry reconciles instead
     *  of re-billing the transcribe call. Only fired on the Replicate paths. */
    onTaskCreated?: (taskId: string) => void | Promise<void>
  },
): Promise<TranscribeResult> {
  const resolvedProvider = provider ?? "whisper"
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
    // contract shared with the add-captions consumers.
    const words = result.words.map((w) => ({
      text: w.text,
      startMs: Math.round(w.start * 1000),
      endMs: Math.round(w.end * 1000),
      timestampMs: null,
      confidence: null,
      ...(w.speaker ? { speaker: w.speaker } : {}),
    }))
    return {
      text: result.text,
      language: result.language,
      // No metered provider cost: the KIE figure was an average estimate of KIE's
      // price, and we no longer pay KIE for this. Omitting it commits the RESERVED
      // tier (user-facing credits unchanged), the same way the youtube-audio
      // handler already commits without a metered cost.
      ...(words.length ? { words } : {}),
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

    const prediction = await replicate.predictions.create({
      version: extractVersion(model),
      input,
    })
    await options?.onTaskCreated?.(prediction.id)
    const completed = await replicate.wait(prediction)
    const cost = extractCost(completed.metrics as Record<string, unknown> | undefined, "incredibly-fast-whisper")
    const output = completed.output as FastWhisperOutput

    const segments = output.chunks?.map((chunk) => ({
      start: chunk.timestamp[0],
      end: chunk.timestamp[1],
      text: chunk.text,
    }))

    console.log(`[transcribe] Output text length: ${output.text?.length ?? 0}`)
    const result: TranscribeResult = {
      text: output.text ?? "",
      language: language && language !== "auto" ? language : "auto",
      cost: cost ?? undefined,
      segments,
    }
    if (options?.wordTimestamps) {
      result.words = fastWhisperWordsToCaptions(output)
    }
    return result
  }

  // Default: openai/whisper
  const input: Record<string, unknown> = {
    audio: audioUrl,
    transcription: "plain text",
  }
  if (options?.wordTimestamps) {
    input.word_timestamps = true
  }
  if (language && language !== "auto") {
    input.language = language
  }

  const prediction = await replicate.predictions.create({
    version: extractVersion(model),
    input,
  })
  await options?.onTaskCreated?.(prediction.id)
  const completed = await replicate.wait(prediction)
  const cost = extractCost(completed.metrics as Record<string, unknown> | undefined, "whisper")
  const output = completed.output as WhisperOutput

  const segments = output.segments?.map((seg) => ({
    start: seg.start,
    end: seg.end,
    text: seg.text,
  }))

  console.log(`[transcribe] Detected language: ${output.detected_language}`)
  console.log(`[transcribe] Output text length: ${output.transcription?.length ?? 0}`)
  const result: TranscribeResult = {
    text: output.transcription ?? "",
    language: output.detected_language ?? "unknown",
    cost: cost ?? undefined,
    segments,
  }
  if (options?.wordTimestamps) {
    result.words = whisperWordsToCaptions(output)
  }
  return result
}
