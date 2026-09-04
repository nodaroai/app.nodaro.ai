/**
 * Nodaro Cloud image provider (community cloud-connect, Phase 4a).
 *
 * Implements ImageGenerationProvider by POSTing to the connected cloud's own
 * public POST /v1/generate-image route (the exact body its Zod schema
 * accepts), then polling GET /v1/jobs/:id until completion. The connected
 * cloud account's wallet is billed; the instance sees no USD cost, so
 * `cost` is always null ("cost unknown" per ProviderResult).
 */

import type {
  ImageEditingProvider,
  ImageGenerationProvider,
  ProviderResult,
  ReconcileOpts,
} from "../provider.interface.js"
import {
  createCloudJob,
  waitForCloudJob,
  NodaroCloudError,
  ensureCloudReachableMediaUrl,
  ensureCloudReachableMediaUrls,
  type CloudJob,
} from "./client.js"
import { relayResultFields } from "./relay-cost.js"

/**
 * The worker handler (workers/handlers/image-ai.ts) hands providers KIE-style
 * snake_case extraParams; the cloud route speaks the camelCase field names of
 * `generateImageBody`. Map the known levers back; unknown keys are dropped
 * (the cloud route would strip them anyway).
 */
const EXTRA_PARAM_TO_BODY_FIELD: Readonly<Record<string, string>> = {
  aspect_ratio: "aspectRatio",
  resolution: "resolution",
  quality: "quality",
  negative_prompt: "negativePrompt",
  seed: "seed",
  rendering_speed: "renderingSpeed",
  style_type: "styleType",
  expand_prompt: "expandPrompt",
  strength: "strength",
  guidance_scale: "guidanceScale",
}

function mapExtraParams(
  extraParams?: Record<string, unknown>,
): Record<string, unknown> {
  if (!extraParams) return {}
  return Object.entries(extraParams).reduce<Record<string, unknown>>(
    (acc, [key, value]) => {
      const bodyField = EXTRA_PARAM_TO_BODY_FIELD[key]
      if (bodyField === undefined || value === undefined) return acc
      return { ...acc, [bodyField]: value }
    },
    {},
  )
}


/** Read the finalized image URL(s) out of a completed cloud job. Shared by
 *  generateImage and editImage — both cloud routes answer the same shape. */
function extractImageResult(
  job: CloudJob,
  jobId: string,
): ProviderResult {
  const output = (job.output_data ?? {}) as { imageUrl?: unknown; imageUrls?: unknown }
  const url = typeof output.imageUrl === "string" ? output.imageUrl : undefined
  if (!url) {
    throw new NodaroCloudError(
      `nodaro.ai: image job ${jobId} completed but returned no imageUrl`,
    )
  }
  // Multi-variant results land as output_data.imageUrls with the primary at
  // index 0 (workers/shared.ts buildImageOutputData) — the rest are extras.
  const allUrls = Array.isArray(output.imageUrls)
    ? output.imageUrls.filter((u): u is string => typeof u === "string")
    : []
  const extraUrls = allUrls.slice(1)
  // `cost` stays null — the instance sees no USD. What it DOES get is the far
  // end's job id and reserved credits (spec §8.2 lane 1): the handler persists
  // them onto its own job row, which is what a self-host settles its users on
  // and what stops the delete paths destroying an object the far end owns.
  return {
    url,
    ...(extraUrls.length ? { extraUrls } : {}),
    cost: null,
    ...relayResultFields(job),
  }
}

export class NodaroCloudImageProvider
  implements ImageGenerationProvider, ImageEditingProvider
{
  async generateImage(
    prompt: string,
    referenceImageUrls?: string[],
    model?: string,
    extraParams?: Record<string, unknown>,
    _reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    // NOTE: reconcileOpts.onTaskCreated is deliberately NOT called. The
    // reconcile system's provider_kind is resolved from the MODEL id
    // (lib/reconcile/provider-kind.ts), so persisting the cloud job id would
    // stamp it as a KIE task and the reconcile cron would poll KIE with a
    // foreign id — force-failing a job still running on the cloud. Until a
    // dedicated "nodaro" ProviderKind exists, a worker crash mid-poll re-runs
    // the handler from scratch (a second cloud job) — accepted Phase 4a cost.
    const cloudRefUrls = await ensureCloudReachableMediaUrls(referenceImageUrls)
    const body: Record<string, unknown> = {
      prompt,
      ...(model !== undefined ? { provider: model } : {}),
      ...(cloudRefUrls?.length ? { referenceImageUrls: cloudRefUrls } : {}),
      ...mapExtraParams(extraParams),
    }

    const jobId = await createCloudJob("/v1/generate-image", body)
    const job = await waitForCloudJob(jobId)

    return extractImageResult(job, jobId)
  }

  /**
   * Image editing through the connection.
   *
   * The cloud's POST /v1/edit-image serves the whole IMAGE_EDIT_PROVIDERS set
   * (it holds every provider key), so a keyless instance gets upscale-image,
   * remove-background and nano-banana-edit for free once connected. The
   * instance previously declared `"image-editing": []`, which sent all three
   * into the router's "nothing can serve this" path.
   */
  async editImage(
    imageUrl: string,
    prompt?: string,
    model?: string,
    extraParams?: Record<string, unknown>,
    _reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    const cloudImageUrl = await ensureCloudReachableMediaUrl(imageUrl)
    const body: Record<string, unknown> = {
      imageUrl: cloudImageUrl,
      ...(prompt !== undefined ? { prompt } : {}),
      ...(model !== undefined ? { provider: model } : {}),
      ...mapExtraParams(extraParams),
    }
    const jobId = await createCloudJob("/v1/edit-image", body)
    const job = await waitForCloudJob(jobId)
    return extractImageResult(job, jobId)
  }
}
