/**
 * Replicate Training Wrapper — character LoRA training.
 *
 * Three exports:
 *  - createCharacterTraining: kick off a training, returns training id immediately.
 *  - cancelCharacterTraining: best-effort cancel an in-flight training.
 *  - deleteCharacterLora: delete a trained model. Uses RAW REST `DELETE
 *    /v1/models/{owner}/{name}` because the SDK does NOT expose a
 *    `models.delete` method (verified Pass 5 against
 *    `node_modules/replicate/index.d.ts:328-366`).
 */

import type { ReconcileOpts } from "../provider.interface.js"
import { replicate } from "./client.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import { config } from "../../lib/config.js"

// Pinned trainer version — bump when Replicate releases a newer trainer.
// Hash extracted from `ostris/flux-dev-lora-trainer:<hash>`.
const TRAINER_VERSION_HASH =
  "e440909d3512c31646ee2e0c7d6f6f4923224863a6a10c494606e79fb5844497"

export interface CreateTrainingArgs {
  characterId: string
  zipUrl: string
  triggerWord: string
}

/**
 * Submit a training to Replicate. Returns the training id immediately;
 * Replicate fires the configured webhook URL when it completes.
 *
 * `webhook_events_filter: ["completed"]` reduces ~20 events down to 1 AND
 * eliminates the race between `trainings.create` returning and the first
 * "starting" event arriving (we only get one event, ~15 min later).
 */
export async function createCharacterTraining(
  args: CreateTrainingArgs,
  reconcileOpts?: ReconcileOpts,
): Promise<{ trainingId: string }> {
  const training = await replicate.trainings.create(
    "ostris",
    "flux-dev-lora-trainer",
    TRAINER_VERSION_HASH,
    {
      destination: `nodaroai/char-${args.characterId}` as `${string}/${string}`,
      input: {
        input_images: args.zipUrl,
        trigger_word: args.triggerWord,
        steps: 1000,
        learning_rate: 0.0004,
        batch_size: 1,
        resolution: "512,768,1024",
      },
      webhook: `${config.PUBLIC_URL}/v1/webhooks/replicate-training`,
      webhook_events_filter: ["completed"],
    },
  )
  if (!training?.id) {
    throw new Error("[Replicate:training] trainings.create returned no id")
  }
  await fireOnTaskCreated(reconcileOpts, training.id, "[replicate:training]")
  return { trainingId: training.id }
}

/** Best-effort cancel. Never throws. */
export async function cancelCharacterTraining(trainingId: string): Promise<void> {
  try {
    await replicate.trainings.cancel(trainingId)
  } catch (err) {
    console.warn(
      `[Replicate:training] cancel ${trainingId} failed: ${(err as Error).message}`,
    )
  }
}

/**
 * Delete a trained LoRA model. Idempotent: 404 is swallowed (already deleted).
 *
 * Why raw REST: `node_modules/replicate/index.d.ts:328-366` only exposes
 * `models.get / list / create / versions / search` — no `delete`. The REST
 * API does support `DELETE /v1/models/{owner}/{name}`.
 *
 * SDK uses `Authorization: Bearer ${token}` (verified Pass 6 against
 * `node_modules/replicate/index.js:256`); Replicate historically also
 * accepted "Token <key>" but Bearer is documented + future-proof.
 *
 * @param modelDestination e.g. `"nodaroai/char-<characterId>"`
 */
export async function deleteCharacterLora(modelDestination: string): Promise<void> {
  try {
    const res = await fetch(
      `https://api.replicate.com/v1/models/${modelDestination}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${config.REPLICATE_API_TOKEN}` },
      },
    )
    if (!res.ok && res.status !== 404) {
      console.warn(
        `[Replicate:training] DELETE ${modelDestination} → ${res.status}`,
      )
    }
  } catch (err) {
    console.warn(
      `[Replicate:training] DELETE ${modelDestination} threw: ${(err as Error).message}`,
    )
  }
}
