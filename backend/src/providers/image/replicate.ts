import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export async function generateImage(prompt: string): Promise<string> {
  const output = await replicate.run("black-forest-labs/flux-schnell", {
    input: { prompt },
  })

  // Replicate output can be: string[], FileOutput[], or a single FileOutput
  // FileOutput has a .url() method or can be coerced to string
  if (Array.isArray(output)) {
    if (output.length === 0) {
      throw new Error("Replicate returned empty output")
    }
    const item = output[0]
    return String(item)
  }

  if (output && typeof output === "object") {
    return String(output)
  }

  if (typeof output === "string") {
    return output
  }

  throw new Error(`Unexpected Replicate output: ${JSON.stringify(output)}`)
}
