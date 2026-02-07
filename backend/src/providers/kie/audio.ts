/**
 * KIE.ai Audio Provider
 *
 * Implements MusicGenerationProvider and TextToSpeechProvider interfaces.
 * Extracted from services/kie-ai.ts (generateMusicKie, textToSpeechKie).
 */

import type {
  MusicGenerationProvider,
  TextToSpeechProvider,
  ProviderResult,
} from "../provider.interface.js"
import {
  createSanitizedError,
  runKieTask,
  MAX_POLL_ATTEMPTS_VIDEO,
} from "./client.js"
import { KIE_MUSIC_MODELS, KIE_TTS_MODELS } from "./models.js"

export class KieAudioProvider
  implements MusicGenerationProvider, TextToSpeechProvider
{
  async generateMusic(
    prompt: string,
    model?: string,
    duration?: number,
    lyrics?: string
  ): Promise<ProviderResult> {
    const provider = model ?? "suno"
    const modelConfig = KIE_MUSIC_MODELS[provider]
    if (!modelConfig) {
      throw createSanitizedError(
        `does not support music provider: ${provider}`,
        "Music generation"
      )
    }

    console.log(
      `[KIE.ai] Generating music with ${modelConfig.model}: "${prompt}"`
    )

    const input: Record<string, unknown> = { prompt }

    if (duration) {
      input.duration = duration
    }

    if (lyrics) {
      input.lyrics = lyrics
    }

    const { resultJson } = await runKieTask(
      modelConfig.model,
      input,
      MAX_POLL_ATTEMPTS_VIDEO
    )

    const audioUrl =
      resultJson.resultUrls?.[0] ?? resultJson.audioUrl
    if (!audioUrl) {
      throw createSanitizedError(
        "music task succeeded but no URL found",
        "Music generation"
      )
    }

    console.log(
      `[KIE.ai] Music completed: ${audioUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { url: audioUrl, cost: modelConfig.cost }
  }

  async textToSpeech(
    text: string,
    voice?: string,
    model?: string
  ): Promise<ProviderResult> {
    const provider = model ?? "elevenlabs"
    const modelConfig = KIE_TTS_MODELS[provider]
    if (!modelConfig) {
      throw createSanitizedError(
        `does not support TTS provider: ${provider}`,
        "Speech generation"
      )
    }

    console.log(
      `[KIE.ai] Generating TTS with ${modelConfig.model}, voice: ${voice ?? "default"}`
    )

    const input: Record<string, unknown> = {
      text,
      voice: voice ?? "Rachel",
    }

    const { resultJson } = await runKieTask(
      modelConfig.model,
      input
    )

    const audioUrl =
      resultJson.resultUrls?.[0] ?? resultJson.audioUrl
    if (!audioUrl) {
      throw createSanitizedError(
        "TTS task succeeded but no URL found",
        "Speech generation"
      )
    }

    console.log(
      `[KIE.ai] TTS completed: ${audioUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { url: audioUrl, cost: modelConfig.cost }
  }
}
