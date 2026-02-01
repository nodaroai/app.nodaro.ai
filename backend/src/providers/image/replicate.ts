import Replicate from "replicate"
import { config } from "../../lib/config.js"
import { translateToEnglish } from "../../lib/translate.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

function extractUrl(item: unknown): string {
  if (typeof item === "string") {
    return item
  }
  if (item && typeof item === "object") {
    // Replicate FileOutput: has .url property or toString() returns URL
    const obj = item as Record<string, unknown>
    if (typeof obj.url === "function") {
      return (obj.url as () => string)()
    }
    if (typeof obj.url === "string") {
      return obj.url
    }
    if (typeof obj.href === "string") {
      return obj.href
    }
    // FileOutput extends ReadableStream and has toString
    const str = String(item)
    if (str.startsWith("http")) {
      return str
    }
    // Try JSON stringification as last resort
    console.warn(`[generateImage] Unexpected object shape:`, JSON.stringify(item).slice(0, 500))
    throw new Error(`Unexpected Replicate output object: ${JSON.stringify(item).slice(0, 200)}`)
  }
  throw new Error(`Unexpected Replicate output type: ${typeof item}`)
}

export type ImageProvider = "nano-banana" | "flux" | "dalle" | "midjourney"

const IMAGE_MODELS: Record<ImageProvider, string> = {
  "nano-banana": "google/nano-banana",
  flux: "black-forest-labs/flux-schnell",
  dalle: "stability-ai/sdxl",
  midjourney: "black-forest-labs/flux-1.1-pro",
}

export async function generateImage(prompt: string, referenceImageUrl?: string, provider?: ImageProvider): Promise<string> {
  const resolvedProvider = provider ?? "nano-banana"
  const model = IMAGE_MODELS[resolvedProvider] ?? IMAGE_MODELS["nano-banana"]
  console.log(`[generateImage] Provider: ${resolvedProvider}, Model: ${model}`)
  console.log(`[generateImage] Original prompt: "${prompt}"`)
  if (referenceImageUrl) {
    console.log(`[generateImage] Reference image: "${referenceImageUrl}"`)
  }
  const englishPrompt = await translateToEnglish(prompt)
  console.log(`[generateImage] Sending to ${resolvedProvider}: "${englishPrompt}"`)

  const input: Record<string, unknown> = { prompt: englishPrompt }
  if (referenceImageUrl) {
    input.image = referenceImageUrl
  }

  const output = await replicate.run(model as `${string}/${string}`, { input })

  console.log(`[generateImage] Raw output type: ${typeof output}, isArray: ${Array.isArray(output)}`)
  console.log(`[generateImage] Raw Replicate output:`, JSON.stringify(output, null, 2))

  let resultUrl: string

  if (typeof output === "string") {
    resultUrl = output
  } else if (Array.isArray(output) && output.length > 0) {
    resultUrl = extractUrl(output[0])
  } else if (typeof output === "object" && output !== null) {
    const obj = output as Record<string, unknown>
    if (typeof obj.output === "string") {
      resultUrl = obj.output
    } else if (typeof obj.url === "string") {
      resultUrl = obj.url
    } else if (typeof obj.image === "string") {
      resultUrl = obj.image
    } else {
      resultUrl = extractUrl(output)
    }
  } else {
    throw new Error(`Unexpected Replicate output: ${JSON.stringify(output)}`)
  }

  console.log(`[generateImage] Result URL: ${resultUrl}`)
  return resultUrl
}
