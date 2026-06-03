import { ELEVENLABS_BASE_URL, getElevenLabsHeaders, fetchAudioFromUrl } from "./client.js"

export interface VoiceChangerOptions {
  modelId?: string
  removeBackgroundNoise?: boolean
  stability?: number
  similarityBoost?: number
  /** Style exaggeration (0–1). Amplifies the source speaker's stylistic
   *  delivery; >0 adds latency and can reduce stability, so 0 is the default. */
  style?: number
}

export async function directVoiceChanger(
  audioBuffer: Buffer,
  voiceId: string,
  options?: VoiceChangerOptions,
): Promise<Buffer> {
  const headers = getElevenLabsHeaders()

  const formData = new FormData()
  const blob = new Blob([audioBuffer as BlobPart], { type: "audio/mpeg" })
  formData.append("audio", blob, "audio.mp3")
  formData.append("model_id", options?.modelId ?? "eleven_english_sts_v2")

  if (options?.removeBackgroundNoise) {
    formData.append("remove_background_noise", "true")
  }

  if (options?.stability != null || options?.similarityBoost != null || options?.style != null) {
    const voiceSettings: Record<string, number> = {
      stability: options?.stability ?? 0.5,
      similarity_boost: options?.similarityBoost ?? 0.75,
    }
    // Only send style when explicitly set, so default requests stay byte-for-byte
    // identical to before this lever existed.
    if (options?.style != null) voiceSettings.style = options.style
    formData.append("voice_settings", JSON.stringify(voiceSettings))
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/speech-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      ...headers,
      Accept: "audio/mpeg",
    },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs Voice Changer failed (${response.status}): ${errorText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export async function voiceChangerFromUrl(
  audioUrl: string,
  voiceId: string,
  options?: VoiceChangerOptions,
): Promise<Buffer> {
  const audioBuffer = await fetchAudioFromUrl(audioUrl)
  return directVoiceChanger(audioBuffer, voiceId, options)
}
