/**
 * nodaro.ai audio provider (community cloud-connect).
 *
 * Text-to-speech is the node the founder hit first on a keyless install: it
 * calls ElevenLabs directly from the worker and never reaches the capability
 * router, so the connection could not rescue it no matter what the provider
 * declared. This is the cloud half — the handler decides when to use it.
 *
 * Returns the CLOUD's audio URL; the caller downloads those bytes and stores
 * them on the instance like any local result, so nothing downstream (R2 keys,
 * gallery rows, watermarking) learns that the audio came from elsewhere.
 */

import type {
  TextToSpeechProvider,
  TextToSpeechOptions,
  ProviderResult,
  ReconcileOpts,
} from "../provider.interface.js"
import { createCloudJob, waitForCloudJob, NodaroCloudError } from "./client.js"

/** Read the finalized audio URL out of a completed cloud job. */
function extractAudioResult(
  job: { output_data?: Record<string, unknown> | null },
  jobId: string,
): ProviderResult {
  const output = (job.output_data ?? {}) as { audioUrl?: unknown }
  const url = typeof output.audioUrl === "string" ? output.audioUrl : undefined
  if (!url) {
    throw new NodaroCloudError(
      `nodaro.ai: audio job ${jobId} completed but returned no audioUrl`,
    )
  }
  return { url, cost: null }
}

export class NodaroCloudAudioProvider implements TextToSpeechProvider {
  // reconcileOpts is deliberately unused, as in the image and video providers:
  // provider_kind is model-keyed, and persisting a cloud job id there would
  // mislabel it as a KIE task, which the reconcile cron would then force-fail
  // while the cloud job is still running.
  async textToSpeech(
    text: string,
    voice?: string,
    model?: string,
    options?: TextToSpeechOptions,
    _reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    const body: Record<string, unknown> = {
      text,
      ...(voice !== undefined ? { voice } : {}),
      ...(model !== undefined ? { provider: model } : {}),
      ...(options?.stability !== undefined ? { stability: options.stability } : {}),
      ...(options?.similarityBoost !== undefined
        ? { similarityBoost: options.similarityBoost }
        : {}),
      ...(options?.style !== undefined ? { style: options.style } : {}),
      ...(options?.speed !== undefined ? { speed: options.speed } : {}),
      ...(options?.languageCode !== undefined ? { languageCode: options.languageCode } : {}),
    }
    const jobId = await createCloudJob("/v1/text-to-speech", body)
    return extractAudioResult(await waitForCloudJob(jobId), jobId)
  }
}
