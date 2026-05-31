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
  ReconcileOpts,
} from "../provider.interface.js"
import { extractUrl, runReplicatePrediction } from "./client.js"
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
  /**
   * Static `owner/name` Replicate model identifier, OR `null` for synthetic
   * ids whose model+version are resolved per-request from
   * `extraParams.lora_version` (used by `flux-lora-character`).
   */
  model: `${string}/${string}` | null
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
  // Synthetic id — selected internally by payload-builder.ts when a single
  // trained @character mention is detected. NEVER appears in dropdowns.
  // The actual Replicate model+version comes from extraParams.lora_version
  // at request time (the character's stored lora_replicate_version, e.g.
  // "nodaroai/char-<uuid>:abc123...").
  "flux-lora-character": {
    model: null,
    buildInput: (prompt, _refs, extraParams) => {
      const { aspectRatio, seed } = readCommon(extraParams)
      const triggerWord = (extraParams?.lora_trigger as string | undefined) ?? ""
      const input: Record<string, unknown> = {
        prompt: triggerWord ? `${triggerWord}, ${prompt}` : prompt,
        aspect_ratio: aspectRatio,
        lora_scale: 1.0,
        num_inference_steps: 28,
      }
      if (seed != null) input.seed = seed
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
  // BFL Flux 2 Max — even larger sibling of Pro. Same safety_tolerance
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // `buildCreditModelIdentifier`). Supports up to 8 image_prompt refs.
  "flux-2-max": {
    model: "black-forest-labs/flux-2-max",
    buildInput: (prompt, referenceImageUrls, extraParams) => {
      const { aspectRatio, seed } = readCommon(extraParams)
      const refs = referenceImageUrls ?? []
      const input: Record<string, unknown> = {
        prompt,
        aspect_ratio: aspectRatio,
        output_format: "png",
        safety_tolerance: 5,
      }
      // Map up to 8 references; flux-2-max charges $0.03 per ref so the
      // cap is honored at the frontend (REF_IMAGE_MAX_LIMITS) and route
      // pricing tier as well.
      for (let i = 0; i < Math.min(refs.length, 8); i++) {
        input[`image_prompt_${i + 1}`] = refs[i]
      }
      if (seed != null) input.seed = seed
      return input
    },
  },
  // BFL Flux 2 Pro — flagship Flux 2 with `safety_tolerance` (0-5) lever.
  // We pin it to 5 (the max — Replicate caps Pro at 5, NOT 6). KIE's safety
  // filter never sees the request. Supports up to 4 image_prompt refs for
  // i2i consistency.
  "flux-2-pro": {
    model: "black-forest-labs/flux-2-pro",
    buildInput: (prompt, referenceImageUrls, extraParams) => {
      const { aspectRatio, seed } = readCommon(extraParams)
      const refs = referenceImageUrls ?? []
      const input: Record<string, unknown> = {
        prompt,
        aspect_ratio: aspectRatio,
        output_format: "png",
        safety_tolerance: 5,
      }
      if (refs[0]) input.image_prompt_1 = refs[0]
      if (refs[1]) input.image_prompt_2 = refs[1]
      if (refs[2]) input.image_prompt_3 = refs[2]
      if (refs[3]) input.image_prompt_4 = refs[3]
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
  reconcileOpts?: ReconcileOpts,
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

  // Resolve dynamic model (flux-lora-character) per-request from extraParams.
  // Versioned references contain ":" (owner/name:hash) and use the `version`
  // field on predictions.create; static specs use the `model` field.
  let dispatchTarget: { version: string } | { model: string }
  if (spec.model === null) {
    const loraVersion = extraParams?.lora_version as string | undefined
    if (!loraVersion) {
      throw new Error(
        `[Replicate:image] model=${model} requires extraParams.lora_version`,
      )
    }
    const versionHash = loraVersion.includes(":")
      ? loraVersion.split(":").pop()!
      : loraVersion
    dispatchTarget = { version: versionHash }
  } else {
    dispatchTarget = { model: spec.model }
  }

  const { output, cost } = await runReplicatePrediction({
    ...dispatchTarget,
    input,
    label: "[replicate:image]",
    reconcileOpts,
  })

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
    reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    const resolved = model ?? REPLICATE_IMAGE_MODEL_IDS[0]
    return runImagePrediction(prompt, resolved, referenceImageUrls, extraParams, reconcileOpts)
  }
}
