import Replicate from "replicate"
import { config } from "../../lib/config.js"
import { translateToEnglish } from "../../lib/translate.js"
import { getAppSettings } from "../../lib/app-settings.js"
import { generateImageKie, type KieResult } from "../../services/kie-ai.js"
import { isKieSupported } from "../../services/model-mapping.js"

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

export interface GenerateImageResult {
  url: string
  cost: number | null  // Cost from Replicate API (null if not available)
}

export async function generateImage(prompt: string, referenceImageUrls?: string[], provider?: ImageProvider): Promise<GenerateImageResult> {
  // Check which AI provider to use from app settings
  const settings = await getAppSettings()
  const aiProvider = settings.ai_provider

  console.log(`[generateImage] AI Provider from settings: ${aiProvider}`)

  // Route to KIE.ai if configured and model is supported
  const resolvedProvider = provider ?? "nano-banana"
  if (aiProvider === "kie") {
    // Check if this provider is supported on KIE.ai
    if (isKieSupported("image", resolvedProvider)) {
      console.log(`[generateImage] Using KIE.ai API for provider: ${resolvedProvider}`)
      const englishPrompt = await translateToEnglish(prompt)
      return generateImageKie(englishPrompt, referenceImageUrls, resolvedProvider)
    } else {
      console.log(`[generateImage] Provider ${resolvedProvider} not supported on KIE.ai, falling back to Replicate`)
    }
  }

  // Default: Use Replicate API
  const model = IMAGE_MODELS[resolvedProvider] ?? IMAGE_MODELS["nano-banana"]
  console.log(`[generateImage] Provider: ${resolvedProvider}, Model: ${model}`)
  console.log(`[generateImage] Original prompt: "${prompt}"`)
  if (referenceImageUrls?.length) {
    console.log(`[generateImage] Reference images (${referenceImageUrls.length}): ${referenceImageUrls.join(", ")}`)
  }
  const englishPrompt = await translateToEnglish(prompt)
  console.log(`[generateImage] Sending to ${resolvedProvider}: "${englishPrompt}"`)

  const input: Record<string, unknown> = { prompt: englishPrompt }
  if (referenceImageUrls?.length) {
    input.image_input = referenceImageUrls
  }

  // Use predictions API to get full response including cost
  const prediction = await replicate.predictions.create({
    model: model as `${string}/${string}`,
    input,
  })

  // Wait for completion
  const completedPrediction = await replicate.wait(prediction)

  const output = completedPrediction.output

  console.log(`[generateImage] Raw output type: ${typeof output}, isArray: ${Array.isArray(output)}`)
  console.log(`[generateImage] Raw Replicate output:`, JSON.stringify(output, null, 2))

  // Extract cost from prediction metrics
  const cost = (completedPrediction.metrics as { predict_time?: number })?.predict_time
    ? ((completedPrediction.metrics as { predict_time: number }).predict_time * 0.000225) // Approximate cost per second
    : null
  console.log(`[generateImage] Prediction metrics:`, JSON.stringify(completedPrediction.metrics))
  console.log(`[generateImage] Estimated cost: $${cost?.toFixed(6) ?? "N/A"}`)

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
  return { url: resultUrl, cost }
}
