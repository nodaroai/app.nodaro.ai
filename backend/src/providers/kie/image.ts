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
import { runFluxKontextTask } from "./kontext-client.js"
import { KIE_IMAGE_MODELS } from "./models.js"
import { logCreditAudit, extractCreditFields } from "../../lib/credit-audit.js"

// Models that need output_format forced to "png" (legacy Nano Banana family).
// Nano Banana 2 uses its own output_format from extraParams (jpg default), so it is NOT included.
const FORCE_PNG_OUTPUT_PROVIDERS = new Set([
  "nano-banana", "nano-banana-pro", "nano-banana-edit",
])

// Models that use named image_size values instead of ratio strings (e.g. "landscape_16_9")
const NAMED_IMAGE_SIZE_PROVIDERS = new Set([
  "ideogram-edit", "ideogram-remix", "ideogram-reframe", "ideogram-v3",
  "qwen", "qwen-i2i", "qwen-edit",
])

// Models that accept negative_prompt as a native API parameter.
// Keep in sync with frontend/src/components/editor/config-panels/model-options.ts
const NATIVE_NEGATIVE_PROMPT_MODELS = new Set([
  "imagen4", "imagen4-fast", "imagen4-ultra",  // up to 5000 chars
  "ideogram-remix", "ideogram-v3", // up to 500 chars
  "qwen", "qwen-edit",                          // up to 500 chars
])

// Map ratio strings → named image_size values for models that require them
const RATIO_TO_NAMED_SIZE: Record<string, string> = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
  "3:2": "landscape_4_3",   // closest match
  "2:3": "portrait_4_3",    // closest match
}

export class KieImageProvider
  implements ImageGenerationProvider, ImageEditingProvider
{
  async generateImage(
    prompt: string,
    referenceImageUrls?: string[],
    model?: string,
    extraParams?: Record<string, unknown>
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

    // Build input with model-specific parameters, then caller overrides
    const input: Record<string, unknown> = {
      prompt,
      // Apply model-specific extra params (aspect_ratio, image_size, resolution, etc.)
      ...modelConfig.extraParams,
      // Caller overrides (e.g. face generation uses 1:1 aspect ratio)
      ...extraParams,
    }

    // Legacy Nano Banana family needs forced png output_format
    if (FORCE_PNG_OUTPUT_PROVIDERS.has(provider)) {
      input.output_format = "png"
    }

    // Base Nano Banana uses `image_size` for aspect ratio (NOT `aspect_ratio`)
    // and does NOT support `resolution` — see docs.kie.ai/market/google/nano-banana.md
    // NOTE: nano-banana-pro uses `aspect_ratio` and DOES support `resolution` (1K/2K/4K)
    if (provider === "nano-banana") {
      if (input.aspect_ratio) {
        input.image_size = input.aspect_ratio
        delete input.aspect_ratio
      }
      delete input.resolution
    }

    // Ideogram, Qwen use named image_size values (e.g. "landscape_16_9")
    // Convert caller's aspect_ratio (e.g. "16:9") to named format
    if (NAMED_IMAGE_SIZE_PROVIDERS.has(provider)) {
      if (input.aspect_ratio) {
        input.image_size = RATIO_TO_NAMED_SIZE[input.aspect_ratio as string] ?? "square_hd"
        delete input.aspect_ratio
      }
      delete input.resolution
    }

    // Imagen4 family: supports negative_prompt natively, no resolution
    if (provider.startsWith("imagen4")) {
      delete input.resolution
    }

    // Z-Image: minimal params, no resolution
    if (provider === "z-image") {
      delete input.resolution
    }

    // Native negative_prompt: keep for supported models, remove for others.
    // The caller passes negative_prompt via extraParams; it was already spread into input above.
    if (input.negative_prompt && !NATIVE_NEGATIVE_PROMPT_MODELS.has(provider)) {
      delete input.negative_prompt
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

    // Flux Kontext uses a special endpoint (not standard createTask)
    const isKontext = provider === "flux-kontext" || provider === "flux-kontext-max"
    const result = isKontext
      ? await runFluxKontextTask(modelConfig.model, input)
      : await runKieTask(modelConfig.model, input)

    const imageUrl = result.resultJson.resultUrls?.[0]
    if (!imageUrl) {
      throw createSanitizedError(
        "image task succeeded but no URL in resultUrls",
        "Image generation"
      )
    }

    console.log(
      `[KIE.ai] Image completed: ${imageUrl} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    // Log credit audit entry (fire-and-forget)
    const rawInfo = "rawRecordInfo" in result ? result.rawRecordInfo : undefined
    logCreditAudit({
      modelKey: provider,
      expectedKieCredits: modelConfig.credits,
      modelConfig: { ...(extraParams ?? {}), provider },
      rawResponseSample: rawInfo,
      actualKieCredits: extractCreditFields(rawInfo)?.credits as number | undefined,
      notes: "image-generation",
    })

    return { url: imageUrl, cost: modelConfig.cost }
  }

  async editImage(
    imageUrl: string,
    prompt?: string,
    model?: string,
    extraParams?: Record<string, unknown>
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
      // Apply model-specific extra params (runtime extraParams override defaults)
      ...modelConfig.extraParams,
      ...extraParams,
    }

    // Nano Banana family supports output_format parameter
    if (provider.startsWith("nano-banana") && provider !== "nano-banana-2") {
      input.output_format = "png"
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

    // Add prompt for edit models that support it
    if (prompt && (
      provider === "nano-banana-edit" ||
      provider === "ideogram-edit" ||
      provider === "ideogram-remix" ||
      provider === "qwen-i2i" ||
      provider === "qwen-edit" ||
      provider === "seedream-edit" ||
      provider === "seedream-5-lite-i2i"
    )) {
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
