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
import { KIE_MUSIC_MODELS, KIE_TTS_MODELS, KIE_SOUND_EFFECT_MODELS, KIE_AUDIO_ISOLATION_MODELS, KIE_STT_MODELS, KIE_DIALOGUE_MODELS } from "./models.js"

// ---------------------------------------------------------------------------
// KIE.ai voice resolution
// ---------------------------------------------------------------------------
// KIE's ElevenLabs TTS endpoints accept 21 voice names but NOT arbitrary
// ElevenLabs UUIDs. When the voice browser returns a real ElevenLabs UUID,
// we must resolve it back to a name before sending to KIE.

const KIE_ACCEPTED_VOICE_NAMES = new Set([
  "Rachel", "Aria", "Roger", "Sarah", "Laura", "Charlie", "George",
  "Callum", "River", "Liam", "Charlotte", "Alice", "Matilda", "Will",
  "Jessica", "Eric", "Chris", "Brian", "Daniel", "Lily", "Bill",
])

/** Voice name cache populated from /v1/voices endpoint data */
let voiceIdToName: Map<string, string> | null = null

/**
 * Register the live voice list so KIE can resolve UUIDs → names.
 * Called from the voices route after fetching from ElevenLabs API.
 */
export function registerVoiceLookup(voices: Array<{ voice_id: string; name: string }>) {
  voiceIdToName = new Map(voices.map((v) => [v.voice_id, v.name]))
}

/**
 * Resolve a voice identifier to a value KIE.ai accepts.
 * - If it's already one of the 21 accepted names, pass through.
 * - If it's a UUID, look up the name from the cached voice list.
 * - Fall back to "Rachel" if unresolvable.
 */
function resolveVoiceForKie(voice: string | undefined): string {
  if (!voice) return "Rachel"

  // Already an accepted name
  if (KIE_ACCEPTED_VOICE_NAMES.has(voice)) return voice

  // UUID → look up name from cached voice list
  if (voiceIdToName) {
    const name = voiceIdToName.get(voice)
    if (name && KIE_ACCEPTED_VOICE_NAMES.has(name)) return name
  }

  // Unknown voice — pass through (may be a KIE-accepted UUID)
  return voice
}

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

    const resolvedVoice = resolveVoiceForKie(voice)

    console.log(
      `[KIE.ai] Resolved voice: "${voice ?? "(none)"}" → "${resolvedVoice}"`
    )

    const input: Record<string, unknown> = {
      text,
      voice: resolvedVoice,
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

  async speechToText(
    audioUrl: string,
    options?: { languageCode?: string; diarize?: boolean; tagAudioEvents?: boolean }
  ): Promise<{ text: string; language: string; cost: number }> {
    const modelConfig = KIE_STT_MODELS["elevenlabs-stt"]
    if (!modelConfig) {
      throw createSanitizedError(
        "elevenlabs-stt model not configured",
        "Speech-to-text"
      )
    }

    console.log(
      `[KIE.ai] Speech-to-text with ${modelConfig.model}`
    )

    const input: Record<string, unknown> = { audio_url: audioUrl }
    if (options?.languageCode) input.language_code = options.languageCode
    if (options?.diarize != null) input.diarize = options.diarize
    if (options?.tagAudioEvents != null) input.tag_audio_events = options.tagAudioEvents

    const { resultJson } = await runKieTask(
      modelConfig.model,
      input,
      MAX_POLL_ATTEMPTS_VIDEO
    )

    const raw = resultJson as Record<string, unknown>
    const text = (raw.text as string) ?? (raw.transcription as string) ?? ""
    const language = (raw.language_code as string) ?? (raw.detected_language as string) ?? "unknown"

    console.log(
      `[KIE.ai] STT completed: ${text.length} chars (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { text, language, cost: modelConfig.cost }
  }

  async generateDialogue(
    dialogue: Array<{ text: string; voice: string }>,
    options?: { stability?: number; languageCode?: string }
  ): Promise<ProviderResult> {
    const modelConfig = KIE_DIALOGUE_MODELS["elevenlabs-dialogue"]
    if (!modelConfig) {
      throw createSanitizedError(
        "elevenlabs-dialogue model not configured",
        "Dialogue generation"
      )
    }

    console.log(
      `[KIE.ai] Generating dialogue with ${modelConfig.model}: ${dialogue.length} lines`
    )

    // Resolve each voice UUID to a KIE-accepted name
    const resolvedDialogue = dialogue.map((line) => ({
      ...line,
      voice: resolveVoiceForKie(line.voice),
    }))

    const input: Record<string, unknown> = { dialogue: resolvedDialogue }
    if (options?.stability != null) input.stability = options.stability
    if (options?.languageCode) input.language_code = options.languageCode

    const { resultJson } = await runKieTask(
      modelConfig.model,
      input,
      MAX_POLL_ATTEMPTS_VIDEO
    )

    const audioUrl =
      resultJson.resultUrls?.[0] ?? resultJson.audioUrl
    if (!audioUrl) {
      throw createSanitizedError(
        "dialogue task succeeded but no URL found",
        "Dialogue generation"
      )
    }

    console.log(
      `[KIE.ai] Dialogue completed: ${audioUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { url: audioUrl, cost: modelConfig.cost }
  }
}
