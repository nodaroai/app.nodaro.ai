import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export async function textToVideo(
  prompt: string,
): Promise<string> {
  console.log(`[textToVideo] Prompt: "${prompt}"`)

  const output = await replicate.run(
    "minimax/video-01",
    {
      input: {
        prompt,
        prompt_optimizer: true,
      },
    },
  )

  const resultUrl = String(output)
  console.log(`[textToVideo] Output: "${resultUrl}"`)
  return resultUrl
}
