import Replicate from "replicate"
import { config } from "../../lib/config.js"
import { translateToEnglish } from "../../lib/translate.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export async function generateImage(prompt: string): Promise<string> {
  console.log(`[generateImage] Original prompt: "${prompt}"`)
  const englishPrompt = await translateToEnglish(prompt)
  console.log(`[generateImage] Sending to nano-banana: "${englishPrompt}"`)

  const output = await replicate.run("google/nano-banana", {
    input: { prompt: englishPrompt },
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
