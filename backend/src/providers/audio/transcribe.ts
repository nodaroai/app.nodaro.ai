import type { Caption } from "@remotion/captions"
import { replicate, extractCost } from "../replicate/client.js"
import { KieAudioProvider } from "../kie/audio.js"
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
  words?: Caption[]
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
    // TODO(kinetic-captions): pipe wordTimestamps through KieAudioProvider.speechToText
    // and use @remotion/elevenlabs::elevenLabsTranscriptToCaptions to populate `words`.
    const kieAudio = new KieAudioProvider()
    const result = await kieAudio.speechToText(audioUrl, {
      languageCode: language && language !== "auto" ? language : undefined,
      diarize: options?.diarize,
      tagAudioEvents: options?.tagAudioEvents,
    })
    return {
      text: result.text,
      language: result.language,
      cost: result.cost,
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
