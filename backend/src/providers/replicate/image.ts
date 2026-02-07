/**
 * Replicate Image Provider
 *
 * Implements ImageGenerationProvider interface.
 * Extracted from providers/image/replicate.ts (generateImage).
 */

import type {
  ImageGenerationProvider,
  ProviderResult,
} from "../provider.interface.js"
import { replicate, extractUrl, extractCost } from "./client.js"
import { translateToEnglish } from "../../lib/translate.js"

const IMAGE_MODELS: Record<string, string> = {
  "nano-banana": "google/nano-banana",
  flux: "black-forest-labs/flux-schnell",
  dalle: "stability-ai/sdxl",
  midjourney: "black-forest-labs/flux-1.1-pro",
}

export class ReplicateImageProvider implements ImageGenerationProvider {
  async generateImage(
    prompt: string,
    referenceImageUrls?: string[],
    model?: string
  ): Promise<ProviderResult> {
    const resolvedModel = model ?? "nano-banana"
    const replicateModel =
      IMAGE_MODELS[resolvedModel] ?? IMAGE_MODELS["nano-banana"]

    const englishPrompt = await translateToEnglish(prompt)
    console.log(
      `[Replicate:generateImage] Provider: ${resolvedModel}, Model: ${replicateModel}`
    )
    console.log(
      `[Replicate:generateImage] Original prompt: "${prompt}"`
    )
    console.log(
      `[Replicate:generateImage] Sending: "${englishPrompt}"`
    )
    if (referenceImageUrls?.length) {
      console.log(
        `[Replicate:generateImage] Reference images (${referenceImageUrls.length}): ${referenceImageUrls.join(", ")}`
      )
    }

    const input: Record<string, unknown> = {
      prompt: englishPrompt,
    }
    if (referenceImageUrls?.length) {
      input.image_input = referenceImageUrls
    }

    // Use predictions API to get full response including cost
    const prediction = await replicate.predictions.create({
      model: replicateModel as `${string}/${string}`,
      input,
    })

    // Wait for completion
    const completed = await replicate.wait(prediction)

    const output = completed.output

    console.log(
      `[Replicate:generateImage] Raw output type: ${typeof output}, isArray: ${Array.isArray(output)}`
    )
    console.log(
      `[Replicate:generateImage] Raw Replicate output:`,
      JSON.stringify(output, null, 2)
    )

    // Extract cost from prediction metrics
    const cost = extractCost(
      completed.metrics as Record<string, unknown> | undefined
    )
    console.log(
      `[Replicate:generateImage] Prediction metrics:`,
      JSON.stringify(completed.metrics)
    )
    console.log(
      `[Replicate:generateImage] Estimated cost: $${cost?.toFixed(6) ?? "N/A"}`
    )

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
      throw new Error(
        `Unexpected Replicate output: ${JSON.stringify(output)}`
      )
    }

    console.log(
      `[Replicate:generateImage] Result URL: ${resultUrl}`
    )
    return { url: resultUrl, cost }
  }
}
