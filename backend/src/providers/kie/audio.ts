/**
 * KIE.ai Audio Provider
 *
 * Implements MusicGenerationProvider and TextToSpeechProvider interfaces.
 * Extracted from services/kie-ai.ts (generateMusicKie, textToSpeechKie).
 */

import type {
  MusicGenerationProvider,
  TextToSpeechProvider,
  TextToSpeechOptions,
  ProviderResult,
} from "../provider.interface.js"
import {
  createSanitizedError,
  runKieTask,
  MAX_POLL_ATTEMPTS_VIDEO,
} from "./client.js"
import { KIE_MUSIC_MODELS, KIE_TTS_MODELS, KIE_SOUND_EFFECT_MODELS, KIE_AUDIO_ISOLATION_MODELS } from "./models.js"

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
    model?: string,
    options?: TextToSpeechOptions
  ): Promise<ProviderResult> {
    // Map legacy "elevenlabs" to "elevenlabs-turbo"
    const provider = model === "elevenlabs" ? "elevenlabs-turbo" : (model ?? "elevenlabs-turbo")
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

    // Pass optional ElevenLabs parameters
    if (options?.stability != null) input.stability = options.stability
    if (options?.similarityBoost != null) input.similarity_boost = options.similarityBoost
    if (options?.style != null) input.style = options.style
    if (options?.speed != null) input.speed = options.speed
    if (options?.languageCode) input.language_code = options.languageCode

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

  async generateSoundEffect(
    text: string,
    options?: {
      duration?: number
      loop?: boolean
      promptInfluence?: number
    }
  ): Promise<ProviderResult> {
    const modelConfig = KIE_SOUND_EFFECT_MODELS["elevenlabs-sfx"]
    if (!modelConfig) {
      throw createSanitizedError(
        "elevenlabs-sfx model not configured",
        "Sound effect generation"
      )
    }

    console.log(
      `[KIE.ai] Generating sound effect with ${modelConfig.model}: "${text.slice(0, 80)}"`
    )

    const input: Record<string, unknown> = { text }

    if (options?.duration != null) input.duration_seconds = options.duration
    if (options?.loop != null) input.loop = options.loop
    if (options?.promptInfluence != null) input.prompt_influence = options.promptInfluence

    const { resultJson } = await runKieTask(
      modelConfig.model,
      input,
      MAX_POLL_ATTEMPTS_VIDEO
    )

    const audioUrl =
      resultJson.resultUrls?.[0] ?? resultJson.audioUrl
    if (!audioUrl) {
      throw createSanitizedError(
        "sound effect task succeeded but no URL found",
        "Sound effect generation"
      )
    }

    console.log(
      `[KIE.ai] Sound effect completed: ${audioUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { url: audioUrl, cost: modelConfig.cost }
  }

  async isolateAudio(audioUrl: string): Promise<ProviderResult> {
    const modelConfig = KIE_AUDIO_ISOLATION_MODELS["elevenlabs-isolation"]
    if (!modelConfig) {
      throw createSanitizedError(
        "elevenlabs-isolation model not configured",
        "Audio isolation"
      )
    }

    console.log(
      `[KIE.ai] Isolating audio with ${modelConfig.model}`
    )

    const { resultJson } = await runKieTask(
      modelConfig.model,
      { audio_url: audioUrl },
      MAX_POLL_ATTEMPTS_VIDEO
    )

    const resultUrl =
      resultJson.resultUrls?.[0] ?? resultJson.audioUrl
    if (!resultUrl) {
      throw createSanitizedError(
        "audio isolation task succeeded but no URL found",
        "Audio isolation"
      )
    }

    console.log(
      `[KIE.ai] Audio isolation completed: ${resultUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { url: resultUrl, cost: modelConfig.cost }
  }
}
