/**
 * Replicate Video SFX Provider — zsxkib/mmaudio
 *
 * Generates Foley/SFX audio for a silent input video using MMAudio.
 * Output is a video file with synthesized audio merged in.
 */

import type { ReconcileOpts } from "../provider.interface.js"
import { replicate } from "./client.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"

// Pinned per backend/src/providers/replicate/CLAUDE.md: never use floating owner/name.
// Resolve via: curl -s https://api.replicate.com/v1/models/zsxkib/mmaudio | jq -r .latest_version.id
// Update this constant when the upstream model publishes a new version.
export const MMAUDIO_VERSION_HASH =
  "62871fb59889b2d7c13777f08deb3b36bdff88f7e1d53a50ad7694548a41b484"

export interface MMAudioInput {
  videoUrl: string
  prompt?: string
  negativePrompt?: string
  duration: number
  cfgStrength: number
  numSteps: number
  seed?: number
}

export interface MMAudioOutput {
  outputUrl: string
  predictTime: number
  /**
   * Replicate prediction id — written to `jobs.provider_task_id` by the worker
   * so the reconcile cron (`provider_kind = "replicate-prediction"`,
   * STALE_THRESHOLD_MS = 20min) can recover a stuck job. Also fired via the
   * optional `reconcileOpts.onTaskCreated` callback BEFORE `replicate.wait`
   * resolves so a worker crash mid-wait still leaves the row recoverable.
   */
  predictionId: string
}

export async function generateVideoSfx(
  input: MMAudioInput,
  reconcileOpts?: ReconcileOpts,
): Promise<MMAudioOutput> {
  const prediction = await replicate.predictions.create({
    version: MMAUDIO_VERSION_HASH,
    input: {
      video: input.videoUrl,
      prompt: input.prompt ?? "",
      negative_prompt: input.negativePrompt ?? "music",
      duration: input.duration,
      cfg_strength: input.cfgStrength,
      num_steps: input.numSteps,
      seed: input.seed ?? -1,
    },
  })
  await fireOnTaskCreated(reconcileOpts, prediction.id, "[replicate:videoSfx]")
  const completed = await replicate.wait(prediction)
  if (!completed.output || typeof completed.output !== "string") {
    throw new Error(
      `mmaudio prediction returned unexpected output: ${JSON.stringify(completed.output)}`,
    )
  }
  const metrics = completed.metrics as { predict_time?: number } | undefined
  return {
    outputUrl: completed.output,
    predictTime: metrics?.predict_time ?? 0,
    predictionId: prediction.id,
  }
}
