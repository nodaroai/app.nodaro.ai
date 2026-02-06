import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export type TranscribeProvider = "whisper" | "incredibly-fast-whisper"

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
  segments?: Array<{
    start: number
    end: number
    text: string
  }>
}

const TRANSCRIBE_MODELS: Record<TranscribeProvider, string> = {
  whisper: "openai/whisper:8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e",
  "incredibly-fast-whisper": "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c",
}

export async function transcribe(
  audioUrl: string,
  provider?: TranscribeProvider,
  language?: string,
): Promise<TranscribeResult> {
  const resolvedProvider = provider ?? "whisper"
  const model = TRANSCRIBE_MODELS[resolvedProvider] ?? TRANSCRIBE_MODELS.whisper
  console.log(`[transcribe] Provider: ${resolvedProvider}, Model: ${model}`)
  console.log(`[transcribe] Audio URL: "${audioUrl}", Language: ${language ?? "auto"}`)

  if (resolvedProvider === "incredibly-fast-whisper") {
    const input: Record<string, unknown> = {
      audio: audioUrl,
      task: "transcribe",
      timestamp: "chunk",
      batch_size: 24,
    }
    if (language && language !== "auto") {
      input.language = language
    } else {
      input.language = "None"
    }

    const output = await replicate.run(
      model as `${string}/${string}`,
      { input },
    ) as FastWhisperOutput

    const segments = output.chunks?.map((chunk) => ({
      start: chunk.timestamp[0],
      end: chunk.timestamp[1],
      text: chunk.text,
    }))

    console.log(`[transcribe] Output text length: ${output.text?.length ?? 0}`)
    return {
      text: output.text ?? "",
      language: language && language !== "auto" ? language : "auto",
      segments,
    }
  }

  // Default: openai/whisper
  const input: Record<string, unknown> = {
    audio: audioUrl,
    transcription: "plain text",
  }
  if (language && language !== "auto") {
    input.language = language
  }

  const output = await replicate.run(
    model as `${string}/${string}`,
    { input },
  ) as WhisperOutput

  const segments = output.segments?.map((seg) => ({
    start: seg.start,
    end: seg.end,
    text: seg.text,
  }))

  console.log(`[transcribe] Detected language: ${output.detected_language}`)
  console.log(`[transcribe] Output text length: ${output.transcription?.length ?? 0}`)
  return {
    text: output.transcription ?? "",
    language: output.detected_language ?? "unknown",
    segments,
  }
}
