import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export async function videoToVideo(
  videoUrl: string,
  prompt?: string,
): Promise<string> {
  console.log(`[videoToVideo] Input video: "${videoUrl}"`)
  console.log(`[videoToVideo] Prompt: "${prompt ?? "continue this video with smooth cinematic motion"}"`)

  const output = await replicate.run(
    "minimax/video-01",
    {
      input: {
        prompt: prompt ?? "continue this video with smooth cinematic motion",
        first_frame_image: videoUrl,
        prompt_optimizer: true,
      },
    },
  )

  const resultUrl = String(output)
  console.log(`[videoToVideo] Output: "${resultUrl}"`)
  return resultUrl
}
