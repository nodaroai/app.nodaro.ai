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

// Hardware the trained flux-dev model would use IF invoked directly (we run
// inference via flux-lora-character, not this model, so it's nominal) — but
// models.create requires a valid GPU SKU and flux-dev needs a large GPU.
const CHARACTER_MODEL_HARDWARE = "gpu-h100"

const characterModelName = (characterId: string): string => `char-${characterId}`

// The destination-model owner is DERIVED from the prod token's own Replicate
// account (cached per process), never hardcoded: a token can ALWAYS create
// models under its own account, so this can't 403-mismatch a hand-set owner
// (the bug that broke training — token `asafna2` had no write access to a
// hardcoded `nodaroai`). A user token yields its username; an org token yields
// the org. Swapping the prod token relocates the namespace automatically.
let cachedModelOwner: string | undefined
async function getModelOwner(): Promise<string> {
  if (cachedModelOwner) return cachedModelOwner
  const account = await replicate.accounts.current()
  if (!account?.username) {
    throw new Error("[Replicate:training] could not resolve Replicate account username")
  }
  cachedModelOwner = account.username
  return cachedModelOwner
}

/** `<token-account>/char-<characterId>` — the trained-LoRA model destination. */
export async function characterModelDestination(
  characterId: string,
): Promise<`${string}/${string}`> {
  return `${await getModelOwner()}/${characterModelName(characterId)}`
}

/** replicate SDK throws ApiError { request, response }; response carries status. */
function apiErrorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | undefined)?.response?.status
}

/**
 * Ensure the destination model exists BEFORE training, and return the resolved
 * owner so the caller dispatches to the SAME destination. Replicate does NOT
 * auto-create the destination — calling trainings.create with a missing model
 * throws (404/422), which previously surfaced as an opaque 502
 * training_dispatch_failed because nothing ever created the model (LoRA
 * training never actually completed on prod). Idempotent:
 *   exists (get 200)            → reuse (re-train path)
 *   missing (get 404)           → create
 *   created concurrently (409)  → swallow
 * Any other status (403 no write access, 422 bad hardware, 5xx) propagates so
 * the caller fails loudly (and logs) instead of dispatching into a void.
 */
async function ensureCharacterModel(characterId: string): Promise<string> {
  const owner = await getModelOwner()
  const name = characterModelName(characterId)
  try {
    await replicate.models.get(owner, name)
    return owner
  } catch (err) {
    if (apiErrorStatus(err) !== 404) throw err
  }
  try {
    await replicate.models.create(owner, name, {
      visibility: "private",
      hardware: CHARACTER_MODEL_HARDWARE,
    })
  } catch (err) {
    if (apiErrorStatus(err) !== 409) throw err
  }
  return owner
}

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
  // Replicate requires the destination model to EXIST before trainings.create
  // (it does not auto-create it). Without this the dispatch threw → opaque 502.
  // Reuse the owner it resolved so create + dispatch target the same model.
  const owner = await ensureCharacterModel(args.characterId)

  const training = await replicate.trainings.create(
    "ostris",
    "flux-dev-lora-trainer",
    TRAINER_VERSION_HASH,
    {
      destination: `${owner}/${characterModelName(args.characterId)}` as `${string}/${string}`,
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
