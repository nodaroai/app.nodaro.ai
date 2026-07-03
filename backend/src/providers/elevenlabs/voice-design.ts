import { ELEVENLABS_BASE_URL, getElevenLabsHeaders } from "./client.js"
import { DEFAULT_VOICE_DESIGN_MODEL } from "@nodaro/shared"

export interface VoiceDesignOptions {
  model?: string
  loudness?: number
  guidanceScale?: number
  seed?: number
  quality?: number
  shouldEnhance?: boolean
}

interface DesignResponse {
  previews: Array<{
    audio_base_64: string
    generated_voice_id: string
    media_type: string
    duration_secs: number
  }>
}

export async function designVoice(
  text: string,
  voiceDescription: string,
  options?: VoiceDesignOptions,
): Promise<{ audioBuffer: Buffer; generatedVoiceId: string }> {
  const headers = getElevenLabsHeaders()

  const body: Record<string, unknown> = {
    voice_description: voiceDescription,
    text,
  }
  // eleven_ttv_v3 is ElevenLabs' newest text-to-voice model (all languages);
  // default in-handler when the caller omits it, same as the route above.
  body.model_id = options?.model ?? DEFAULT_VOICE_DESIGN_MODEL
  if (options?.loudness != null) body.loudness = options.loudness
  if (options?.guidanceScale != null) body.guidance_scale = options.guidanceScale
  if (options?.seed != null) body.seed = options.seed
  if (options?.quality != null) body.quality = options.quality
  if (options?.shouldEnhance != null) body.should_enhance = options.shouldEnhance

  const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/text-to-voice/design`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs Voice Design failed (${response.status}): ${errorText}`)
  }

  const result = (await response.json()) as DesignResponse

  if (!result.previews || result.previews.length === 0) {
    throw new Error("ElevenLabs Voice Design returned no previews")
  }

  const preview = result.previews[0]
  return {
    audioBuffer: Buffer.from(preview.audio_base_64, "base64"),
    generatedVoiceId: preview.generated_voice_id,
  }
}
