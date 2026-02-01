import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

const VALID_VOICES = new Set([
  "Rachel", "Drew", "Clyde", "Paul", "Aria", "Domi", "Dave", "Roger",
  "Fin", "Sarah", "James", "Jane", "Juniper", "Arabella", "Hope",
  "Bradford", "Reginald", "Gaming", "Austin", "Kuon", "Blondie",
  "Priyanka", "Alexandra", "Monika", "Mark", "Grimblewood",
])

function resolveVoice(voice?: string): string {
  if (voice && VALID_VOICES.has(voice)) {
    return voice
  }
  console.log(`[textToSpeech] Invalid voice "${voice}", falling back to "Rachel"`)
  return "Rachel"
}

export async function textToSpeech(
  text: string,
  voice?: string,
): Promise<string> {
  const resolvedVoice = resolveVoice(voice)
  console.log(`[textToSpeech] Text length: ${text.length}, voice: ${resolvedVoice}`)

  const output = await replicate.run(
    "elevenlabs/turbo-v2.5",
    {
      input: {
        prompt: text,
        voice: resolvedVoice,
        language_code: "en",
      },
    },
  )

  const resultUrl = String(output)
  console.log(`[textToSpeech] Output: "${resultUrl}"`)
  return resultUrl
}
