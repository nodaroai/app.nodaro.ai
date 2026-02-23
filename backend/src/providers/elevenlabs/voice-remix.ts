import { ELEVENLABS_BASE_URL, getElevenLabsHeaders } from "./client.js"

export interface VoiceRemixOptions {
  outputFormat?: string
}

interface CreatePreviewsResponse {
  previews: Array<{
    audio_base_64: string
    generated_voice_id: string
    media_type: string
    duration_secs: number
  }>
}

export async function remixVoice(
  text: string,
  voiceDescription: string,
  options?: VoiceRemixOptions,
): Promise<Buffer> {
  const headers = getElevenLabsHeaders()

  const body: Record<string, unknown> = {
    voice_description: voiceDescription,
    text,
  }
  if (options?.outputFormat) {
    body.output_format = options.outputFormat
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/text-to-voice/create-previews`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs Voice Remix failed (${response.status}): ${errorText}`)
  }

  const result = (await response.json()) as CreatePreviewsResponse

  if (!result.previews || result.previews.length === 0) {
    throw new Error("ElevenLabs Voice Remix returned no previews")
  }

  const audioBase64 = result.previews[0].audio_base_64
  return Buffer.from(audioBase64, "base64")
}
