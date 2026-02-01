import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export async function generateMusic(
  prompt: string,
  duration?: number,
  modelVersion?: string,
): Promise<string> {
  const resolvedDuration = duration ?? 8
  const resolvedModel = modelVersion ?? "stereo-large"

  console.log(`[generateMusic] prompt: "${prompt.slice(0, 80)}...", duration: ${resolvedDuration}s, model: ${resolvedModel}`)

  const output = await replicate.run(
    "meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb",
    {
      input: {
        prompt,
        model_version: resolvedModel,
        duration: resolvedDuration,
        output_format: "mp3",
        normalization_strategy: "peak",
      },
    },
  )

  const resultUrl = String(output)
  console.log(`[generateMusic] Output: "${resultUrl}"`)
  return resultUrl
}
