import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export async function textToSpeech(
  text: string,
  voice?: string,
): Promise<string> {
  console.log(`[textToSpeech] Text length: ${text.length}, voice: ${voice ?? "default"}`)

  const output = await replicate.run(
    "lucataco/xtts-v2:684bc3855b37866c0c65add2ff39c78f3dea3f4ff103a436465326e0f438d55e",
    {
      input: {
        text,
        speaker: "https://replicate.delivery/pbxt/Jt79w0xsT64R1JsiJ0LQZI8SoGfoSGIyPhpYKGlFtVsfGNhE/male.wav",
        language: "en",
        cleanup_voice: false,
      },
    },
  )

  const resultUrl = String(output)
  console.log(`[textToSpeech] Output: "${resultUrl}"`)
  return resultUrl
}
