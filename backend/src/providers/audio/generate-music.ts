import { replicate } from "../replicate/client.js"

export type MusicProvider = "musicgen" | "minimax" | "lyria" | "bark"

async function runMusicGen(prompt: string, duration: number, modelVersion: string): Promise<string> {
  const output = await replicate.run(
    "meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb",
    {
      input: {
        prompt,
        model_version: modelVersion,
        duration,
        output_format: "mp3",
        normalization_strategy: "peak",
      },
    },
  )
  return String(output)
}

async function runMiniMax(prompt: string, lyrics?: string, referenceAudioUrl?: string): Promise<string> {
  const input: Record<string, unknown> = {}
  if (lyrics) {
    input.lyrics = lyrics
  } else {
    // MiniMax uses lyrics field; use prompt as lyrics if none provided
    input.lyrics = `##\n${prompt}\n##`
  }
  if (referenceAudioUrl) {
    input.song_file = referenceAudioUrl
  }
  const output = await replicate.run(
    "minimax/music-01:0254c7e2f54315b667dbae03da7c155822ba29ffe0457be5bc246d564be486bd",
    { input },
  )
  return String(output)
}

async function runLyria(prompt: string): Promise<string> {
  const output = await replicate.run(
    "google/lyria-2:bb621623ee2772c96d300b2a303c9e444b482f6b0fafcc7424923e1429971120",
    {
      input: {
        prompt,
      },
    },
  )
  return String(output)
}

async function runBark(prompt: string): Promise<string> {
  const output = await replicate.run(
    "suno-ai/bark:b76242b40d67c76ab6742e987628a2a9ac019e11d56ab96c4e91ce03b79b2787",
    {
      input: {
        prompt,
        text_temp: 0.7,
        waveform_temp: 0.7,
      },
    },
  ) as { audio_out?: string }
  return String(output?.audio_out ?? output)
}

export async function generateMusic(
  prompt: string,
  provider?: MusicProvider,
  duration?: number,
  modelVersion?: string,
  lyrics?: string,
  referenceAudioUrl?: string,
): Promise<string> {
  const resolvedProvider = provider ?? "musicgen"
  const resolvedDuration = duration ?? 8

  console.log(`[generateMusic] provider: ${resolvedProvider}, prompt: "${prompt.slice(0, 80)}...", duration: ${resolvedDuration}s`)

  let resultUrl: string

  switch (resolvedProvider) {
    case "minimax":
      resultUrl = await runMiniMax(prompt, lyrics, referenceAudioUrl)
      break
    case "lyria":
      resultUrl = await runLyria(prompt)
      break
    case "bark":
      resultUrl = await runBark(prompt)
      break
    case "musicgen":
    default:
      resultUrl = await runMusicGen(prompt, resolvedDuration, modelVersion ?? "stereo-large")
      break
  }

  console.log(`[generateMusic] Output: "${resultUrl}"`)
  return resultUrl
}
