import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export async function generateImage(prompt: string): Promise<string> {
  const output = await replicate.run("black-forest-labs/flux-schnell", {
    input: { prompt },
  })

  if (!Array.isArray(output) || output.length === 0) {
    throw new Error("Replicate returned no output")
  }

  const url = output[0]
  if (typeof url !== "string") {
    throw new Error(`Unexpected Replicate output type: ${typeof url}`)
  }

  return url
}
