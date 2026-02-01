import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export async function textToSpeech(
  text: string,
  voice?: string,
): Promise<string> {
  console.log(`[textToSpeech] Text length: ${text.length}, voice: ${voice ?? "Rachel"}`)

  const output = await replicate.run(
    "elevenlabs/turbo-v2.5",
    {
      input: {
        prompt: text,
        voice: voice || "Rachel",
        language_code: "en",
      },
    },
  )

  const resultUrl = String(output)
  console.log(`[textToSpeech] Output: "${resultUrl}"`)
  return resultUrl
}
