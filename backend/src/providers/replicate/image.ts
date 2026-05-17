/**
 * Replicate Image Provider
 *
 * Currently scoped to a handful of "Open" (uncensored) models that are only
 * available on Replicate — not KIE.ai. The router in `providers/router.ts`
 * walks the chain `["kie", "replicate"]`; KIE doesn't declare these model
 * ids in its `supportedModels`, so requests for them fall through here.
 */

import type {
  ImageGenerationProvider,
  ProviderResult,
} from "../provider.interface.js"
import { replicate, extractUrl, extractCost } from "./client.js"
import { translateToEnglish } from "../../lib/translate.js"

const DEFAULT_ASPECT_RATIO = "1:1"

interface CommonExtras {
  aspectRatio: string
  seed?: number
}

function readCommon(extraParams: Record<string, unknown> | undefined): CommonExtras {
  return {
    aspectRatio:
      (extraParams?.aspect_ratio as string | undefined) ?? DEFAULT_ASPECT_RATIO,
    seed: extraParams?.seed as number | undefined,
  }
}

interface ReplicateModelSpec {
  model: `${string}/${string}`
  buildInput: (
    prompt: string,
    referenceImageUrls: string[] | undefined,
    extraParams: Record<string, unknown> | undefined,
  ) => Record<string, unknown>
}

const IMAGE_MODELS: Record<string, ReplicateModelSpec> = {
  // BFL Flux 2 9B Klein — small, fast, no KIE safety filter.
  "flux-2-klein": {
    model: "black-forest-labs/flux-2-klein-9b",
    buildInput: (prompt, referenceImageUrls, extraParams) => {
      const { aspectRatio, seed } = readCommon(extraParams)
      const input: Record<string, unknown> = {
        prompt,
        aspect_ratio: aspectRatio,
      }
      if (seed != null) input.seed = seed
      if (referenceImageUrls?.length) input.image = referenceImageUrls[0]
      return input
    },
  },
  // Multi-image Flux Kontext Pro — up to 4 input images, no KIE safety filter.
  "kontext-multi": {
    model: "flux-kontext-apps/multi-image-kontext-pro",
    buildInput: (prompt, referenceImageUrls, extraParams) => {
      const { aspectRatio, seed } = readCommon(extraParams)
      const refs = referenceImageUrls ?? []
      const input: Record<string, unknown> = {
        prompt,
        aspect_ratio: aspectRatio,
        output_format: "png",
      }
      if (refs[0]) input.input_image_1 = refs[0]
      if (refs[1]) input.input_image_2 = refs[1]
      if (refs[2]) input.input_image_3 = refs[2]
      if (refs[3]) input.input_image_4 = refs[3]
      if (seed != null) input.seed = seed
      return input
    },
  },
}

// Both new models are reached via the `image-generation` router capability
// (image-to-image route invokes `generateImage` with refs, not `editImage`).
// The `editImage` router function is only used by the edit-image route, which
// has its own provider enum and doesn't dispatch to Replicate.
export const REPLICATE_IMAGE_MODEL_IDS = Object.keys(IMAGE_MODELS)

async function runImagePrediction(
  prompt: string,
  model: string,
  referenceImageUrls?: string[],
  extraParams?: Record<string, unknown>,
): Promise<ProviderResult> {
  const spec = IMAGE_MODELS[model]
  if (!spec) {
    throw new Error(`[Replicate:image] Unknown model: ${model}`)
  }

  const englishPrompt = await translateToEnglish(prompt)
  console.log(
    `[Replicate:image] model=${model} (${spec.model}) prompt="${englishPrompt}" refs=${referenceImageUrls?.length ?? 0}`,
  )

  const input = spec.buildInput(englishPrompt, referenceImageUrls, extraParams)

  const prediction = await replicate.predictions.create({
    model: spec.model,
    input,
  })
  const completed = await replicate.wait(prediction)
  const output = completed.output

  const cost = extractCost(
    completed.metrics as Record<string, unknown> | undefined,
  )

  const raw =
    typeof output === "string"
      ? output
      : Array.isArray(output) && output.length > 0
        ? output[0]
        : output
  const resultUrl = extractUrl(raw)

  console.log(
    `[Replicate:image] result=${resultUrl} cost=${cost?.toFixed(6) ?? "N/A"}`,
  )
  return { url: resultUrl, cost }
}

export class ReplicateImageProvider implements ImageGenerationProvider {
  async generateImage(
    prompt: string,
    referenceImageUrls?: string[],
    model?: string,
    extraParams?: Record<string, unknown>,
  ): Promise<ProviderResult> {
    const resolved = model ?? REPLICATE_IMAGE_MODEL_IDS[0]
    return runImagePrediction(prompt, resolved, referenceImageUrls, extraParams)
  }
}
