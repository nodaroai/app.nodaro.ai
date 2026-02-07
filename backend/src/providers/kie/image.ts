/**
 * KIE.ai Image Provider
 *
 * Implements ImageGenerationProvider and ImageEditingProvider interfaces.
 * Extracted from services/kie-ai.ts (generateImageKie, editImageKie).
 */

import type {
  ImageGenerationProvider,
  ImageEditingProvider,
  ProviderResult,
} from "../provider.interface.js"
import { createSanitizedError, runKieTask } from "./client.js"
import { KIE_IMAGE_MODELS } from "./models.js"

export class KieImageProvider
  implements ImageGenerationProvider, ImageEditingProvider
{
  async generateImage(
    prompt: string,
    referenceImageUrls?: string[],
    model?: string
  ): Promise<ProviderResult> {
    const provider = model ?? "nano-banana"
    const modelConfig = KIE_IMAGE_MODELS[provider]
    if (!modelConfig) {
      throw createSanitizedError(
        `does not support image provider: ${provider}`,
        "Image generation"
      )
    }

    console.log(
      `[KIE.ai] Generating image with ${modelConfig.model}: "${prompt}"`
    )
    if (referenceImageUrls?.length) {
      console.log(
        `[KIE.ai] Reference images: ${referenceImageUrls.join(", ")}`
      )
    }

    // Build input with model-specific parameters
    const input: Record<string, unknown> = {
      prompt,
      output_format: "png",
      // Apply model-specific extra params (aspect_ratio, image_size, resolution, etc.)
      ...modelConfig.extraParams,
    }

    // Add reference images based on input type
    if (referenceImageUrls?.length) {
      if (modelConfig.inputType === "image-to-image") {
        // Image-to-image models - check for custom image parameter name
        const imageParamName = modelConfig.imageParam ?? "image"

        if (
          imageParamName === "input_urls" ||
          imageParamName === "image_urls"
        ) {
          // GPT Image uses input_urls as an array, Grok uses image_urls as an array
          input[imageParamName] = referenceImageUrls
        } else {
          // Default: use "image" param for the source image (single URL)
          input[imageParamName] = referenceImageUrls[0]
          // Some models may support multiple images
          if (referenceImageUrls.length > 1) {
            input.image_input = referenceImageUrls.slice(1)
          }
        }
      } else {
        // Text-to-image models use "image_input" for reference images
        input.image_input = referenceImageUrls
      }
    }

    console.log(
      `[KIE.ai] Request input:`,
      JSON.stringify(input, null, 2)
    )

    const { resultJson } = await runKieTask(modelConfig.model, input)

    const imageUrl = resultJson.resultUrls?.[0]
    if (!imageUrl) {
      throw createSanitizedError(
        "image task succeeded but no URL in resultUrls",
        "Image generation"
      )
    }

    console.log(
      `[KIE.ai] Image completed: ${imageUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { url: imageUrl, cost: modelConfig.cost }
  }

  async editImage(
    imageUrl: string,
    prompt?: string,
    model?: string
  ): Promise<ProviderResult> {
    const provider = model ?? "recraft-upscale"
    const modelConfig = KIE_IMAGE_MODELS[provider]
    if (!modelConfig) {
      throw createSanitizedError(
        `does not support edit image provider: ${provider}`,
        "Image editing"
      )
    }

    console.log(
      `[KIE.ai] Editing image with ${modelConfig.model}`
    )
    console.log(
      `[KIE.ai] Image: ${imageUrl}, Prompt: "${prompt ?? ""}"`
    )

    const input: Record<string, unknown> = {
      output_format: "png",
      // Apply model-specific extra params
      ...modelConfig.extraParams,
    }

    // Set the image parameter based on model config
    const imageParamName = modelConfig.imageParam ?? "image"
    if (
      imageParamName === "image_urls" ||
      imageParamName === "input_urls"
    ) {
      // Array-based image parameter
      input[imageParamName] = [imageUrl]
    } else {
      // Single URL parameter
      input[imageParamName] = imageUrl
    }

    // Add prompt only for nano-banana-edit (general editing with instructions)
    if (provider === "nano-banana-edit" && prompt) {
      input.prompt = prompt
    }

    console.log(
      `[KIE.ai] Edit request input:`,
      JSON.stringify(input, null, 2)
    )

    const { resultJson } = await runKieTask(modelConfig.model, input)

    const outputUrl = resultJson.resultUrls?.[0]
    if (!outputUrl) {
      throw createSanitizedError(
        "edit image task succeeded but no URL in resultUrls",
        "Image editing"
      )
    }

    console.log(
      `[KIE.ai] Edit image completed: ${outputUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return { url: outputUrl, cost: modelConfig.cost }
  }
}
