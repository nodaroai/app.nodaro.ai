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
  ReconcileOpts,
} from "../provider.interface.js"
import sharp from "sharp"
import { createSanitizedError, runKieTask } from "./client.js"
import { runFluxKontextTask } from "./kontext-client.js"
import { KIE_IMAGE_MODELS } from "./models.js"
import { logCreditAudit, extractCreditFields } from "../../lib/credit-audit.js"
import { uploadBufferToR2 } from "../../lib/storage.js"
import { safeFetch } from "../../lib/safe-fetch.js"

// Models that need output_format forced to "png" (legacy Nano Banana family).
// Nano Banana 2 uses its own output_format from extraParams (jpg default), so it is NOT included.
const FORCE_PNG_OUTPUT_PROVIDERS = new Set([
  "nano-banana", "nano-banana-pro", "nano-banana-edit",
])

// Models that use named image_size values instead of ratio strings (e.g. "landscape_16_9")
const NAMED_IMAGE_SIZE_PROVIDERS = new Set([
  "ideogram-remix", "ideogram-reframe", "ideogram-v3",
  "qwen", "qwen-i2i", "qwen-edit",
])

// Models that accept negative_prompt as a native API parameter.
// Keep in sync with frontend/src/components/editor/config-panels/model-options.ts
const NATIVE_NEGATIVE_PROMPT_MODELS = new Set([
  "imagen4", "imagen4-fast", "imagen4-ultra",  // up to 5000 chars
  "ideogram-remix", "ideogram-v3", // up to 500 chars
  "qwen", "qwen-edit",                          // up to 500 chars
])

// GPT Image text-to-image endpoints SILENTLY IGNORE a supplied reference image —
// they generate purely from the prompt, which destroys character/entity identity
// when an anchor is passed (e.g. Studio asset shots: angles, poses, expressions).
// Their image-to-image siblings consume the anchor via `input_urls`. When
// reference image(s) are present, `generateImage` swaps the t2i provider for its
// i2i sibling below so the anchor is actually honored.
//
// TARGETED to GPT Image only — do NOT widen to a blanket "any t2i + refs → i2i"
// rule: models like nano-banana and seedream t2i legitimately accept reference
// images via `image_input` as a STYLE reference, and remapping them would change
// their behavior. Pricing parity holds (each pair costs identically at every
// tier) and credit reservation already happened at the route on the ORIGINAL
// provider id — this swap only affects the actual KIE call.
const GPT_IMAGE_T2I_TO_I2I: Record<string, string> = {
  "gpt-image-2": "gpt-image-2-i2i",
  "gpt-image": "gpt-image-i2i",
}

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

/**
 * Download an image and return its buffer + dimensions.
 */
async function downloadAndMeasure(url: string): Promise<{ buffer: Buffer; width: number; height: number }> {
  // safeFetch: url is user-supplied (image/mask URL for ideogram-edit etc.)
  // and the bytes are decoded server-side — guard against SSRF (DNS rebinding
  // to internal IPs) at connect time, not just the syntactic safeUrlSchema.
  const res = await safeFetch(url, { timeoutMs: 30_000 })
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const meta = await sharp(buffer).metadata()
  if (!meta.width || !meta.height) throw new Error("Could not read image dimensions")
  return { buffer, width: meta.width, height: meta.height }
}

/**
 * Ensure mask dimensions match the source image. If they differ, resize
 * the mask, upload it to R2, and return the new URL.
 */
async function ensureMaskDimensions(
  imageUrl: string,
  maskUrl: string,
): Promise<string> {
  const [img, mask] = await Promise.all([
    downloadAndMeasure(imageUrl),
    downloadAndMeasure(maskUrl),
  ])

  if (img.width === mask.width && img.height === mask.height) {
    return maskUrl
  }

  console.log(
    `[KIE.ai] Mask size (${mask.width}x${mask.height}) differs from image (${img.width}x${img.height}) — resizing mask`
  )

  const resized = await sharp(mask.buffer)
    .resize(img.width, img.height, { fit: "fill" })
    .png()
    .toBuffer()

  const key = `masks/resized-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  return uploadBufferToR2(resized, key, "image/png")
}

export class KieImageProvider
  implements ImageGenerationProvider, ImageEditingProvider
{
  async generateImage(
    prompt: string,
    referenceImageUrls?: string[],
    model?: string,
    extraParams?: Record<string, unknown>,
    reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    let provider = model ?? "nano-banana"
    let modelConfig = KIE_IMAGE_MODELS[provider]
    if (!modelConfig) {
      throw createSanitizedError(
        `does not support image provider: ${provider}`,
        "Image generation"
      )
    }

    // Anchor/reference image present + GPT Image t2i → route to the i2i sibling
    // that actually consumes the reference (via `input_urls`). The t2i endpoint
    // drops `image_input`, so without this the anchor is ignored and identity is
    // lost. Swapping the local `provider` too keeps the request logging and
    // credit-audit entry reflecting the model truly called. See
    // GPT_IMAGE_T2I_TO_I2I for why this is intentionally GPT-Image-only.
    if (referenceImageUrls?.length) {
      const i2iSibling = GPT_IMAGE_T2I_TO_I2I[provider]
      const i2iConfig = i2iSibling ? KIE_IMAGE_MODELS[i2iSibling] : undefined
      if (i2iSibling && i2iConfig) {
        provider = i2iSibling
        modelConfig = i2iConfig
      }
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

    // Nodaro `nano-banana` is routed to KIE's `nano-banana-pro` model (see
    // models.ts) so we can offer `image_input` reference images at the cheaper
    // 4-KIE-credit price tier. The Pro endpoint accepts `aspect_ratio`
    // natively — no field-rename needed. We DO strip `resolution` so KIE
    // defaults to 1K; 2K/4K live under the explicit `nano-banana-pro` provider
    // which prices them via composite credit identifiers. Without this,
    // callers asking for 9:16 silently got 1:1 because we used to rewrite the
    // field to `image_size`, which the Pro endpoint ignores.
    if (provider === "nano-banana") {
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

    // Ideogram character-edit: output dims come from input image + mask,
    // does NOT support aspect_ratio or resolution
    if (provider === "ideogram-edit") {
      delete input.aspect_ratio
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

        // Ideogram character models require additional params beyond image_url:
        // - ideogram-edit: mask_url (inpainting mask) + reference_image_urls (character ref)
        // - ideogram-remix: reference_image_urls (character ref)
        // When used as generic i2i, auto-fill from the source image.
        if (provider === "ideogram-edit") {
          if (!input.mask_url) input.mask_url = referenceImageUrls[0]
          if (!input.reference_image_urls) input.reference_image_urls = [referenceImageUrls[0]]
        } else if (provider === "ideogram-remix" && !input.reference_image_urls) {
          input.reference_image_urls = [referenceImageUrls[0]]
        }
      } else if (provider === "flux-kontext" || provider === "flux-kontext-max") {
        // Flux Kontext uses "inputImage" (camelCase) for image editing mode
        input.inputImage = referenceImageUrls[0]
      } else if (modelConfig.imageParam === "input_urls" || modelConfig.imageParam === "image_urls") {
        // T2I models that accept optional reference images via an array param (e.g., wan-2.7)
        input[modelConfig.imageParam] = referenceImageUrls
      } else {
        // Text-to-image models use "image_input" for reference images
        input.image_input = referenceImageUrls
      }
    }

    // Ideogram character-edit: ensure mask matches source image dimensions
    if (provider === "ideogram-edit" && input.mask_url && input.image_url) {
      input.mask_url = await ensureMaskDimensions(
        input.image_url as string,
        input.mask_url as string,
      )
    }

    console.log(
      `[KIE.ai] Request input:`,
      JSON.stringify(input, null, 2)
    )

    // Flux Kontext uses a special endpoint (not standard createTask)
    const isKontext = provider === "flux-kontext" || provider === "flux-kontext-max"
    const result = isKontext
      ? await runFluxKontextTask(modelConfig.model, input, reconcileOpts)
      : await runKieTask(modelConfig.model, input, undefined, undefined, reconcileOpts)

    const allUrls = result.resultJson.resultUrls ?? []
    const imageUrl = allUrls[0]
    if (!imageUrl) {
      throw createSanitizedError(
        "image task succeeded but no URL in resultUrls",
        "Image generation"
      )
    }
    const extraUrls = allUrls.slice(1)

    console.log(
      `[KIE.ai] Image completed: ${imageUrl}${extraUrls.length ? ` (+${extraUrls.length} variants)` : ""} (cost: $${modelConfig.cost.toFixed(4)})`
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

    const providerMs = ("providerMs" in result && typeof result.providerMs === "number")
      ? result.providerMs
      : undefined
    return {
      url: imageUrl,
      ...(extraUrls.length ? { extraUrls } : {}),
      cost: modelConfig.cost,
      ...(providerMs !== undefined && { providerMs }),
    }
  }

  async editImage(
    imageUrl: string,
    prompt?: string,
    model?: string,
    extraParams?: Record<string, unknown>,
    reconcileOpts?: ReconcileOpts,
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

    const { resultJson, providerMs } = await runKieTask(modelConfig.model, input, undefined, undefined, reconcileOpts)

    const allUrls = resultJson.resultUrls ?? []
    const outputUrl = allUrls[0]
    if (!outputUrl) {
      throw createSanitizedError(
        "edit image task succeeded but no URL in resultUrls",
        "Image editing"
      )
    }
    const extraUrls = allUrls.slice(1)

    console.log(
      `[KIE.ai] Edit image completed: ${outputUrl}${extraUrls.length ? ` (+${extraUrls.length} variants)` : ""} (cost: $${modelConfig.cost.toFixed(4)})`
    )

    return {
      url: outputUrl,
      ...(extraUrls.length ? { extraUrls } : {}),
      cost: modelConfig.cost,
      ...(providerMs !== undefined && { providerMs }),
    }
  }
}
