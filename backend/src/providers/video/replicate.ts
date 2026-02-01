import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export async function imageToVideo(
  imageUrl: string,
  prompt?: string,
): Promise<string> {
  console.log(`[imageToVideo] Input image: "${imageUrl}"`)
  console.log(`[imageToVideo] Motion prompt: "${prompt ?? "smooth cinematic motion"}"`)

  const output = await replicate.run(
    "minimax/video-01",
    {
      input: {
        prompt: prompt ?? "smooth cinematic motion",
        first_frame_image: imageUrl,
        prompt_optimizer: true,
      },
    },
  )

  const videoUrl = String(output)
  console.log(`[imageToVideo] Output: "${videoUrl}"`)
  return videoUrl
}
