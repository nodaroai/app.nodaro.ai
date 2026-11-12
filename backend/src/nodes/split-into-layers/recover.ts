// The ONE delivery of a finished split (tools/units/README.md, "A worker unit's
// recovery"): from the decomposition's result and the run's settings to
// finalizeJobWithMedia — the base as the run's image, every layer stored beside
// it and filed in the Library under its name, each layer's data on `layerData`,
// settled on the images stored. The worker (worker.ts) calls it after its
// provider call; the reconcile (`recover`, below — the cron and the worker's
// stall re-pick, lib/reconcile/kie.ts) calls it with the same inputs, read
// back from the job's saved task and `input_data`, so a recovered job is
// delivered and charged exactly as the worker would have delivered it.
import { layerSplitCreditId, layerSplitImagesHeld, layerSplitSize, layerSplitTier } from "@nodaro/render-rules"
import { creditIdBaseCredits } from "../../lib/credit-id-base.js"
import { finalizeJobWithMedia, type FinalizeClaimant, type FinalizeOutcome } from "../../lib/job-finalize.js"
import { isPostProcessingError } from "../../lib/post-processing-error.js"
import { layerDecompositionResultOf, type DecomposedLayer, type LayerDecompositionResult } from "../../providers/kie/layer-decomposition.js"
import { KIE_CREDIT_USD, LAYER_DECOMPOSITION_MODEL_KEY } from "../../providers/kie/models.js"
import type { UnitRecover } from "../kit.js"
import { descriptor } from "./descriptor.generated.js"

/** How many times each image (the base and every layer) is tried before it counts as not saved. */
export const LAYER_STORE_ATTEMPTS = 3

/**
 * A run's settings as its job carries them, unread: `maxLayers` and `size` off
 * the worker's queue payload, or off `jobs.input_data` (the route and the
 * workflow payload write both, normalized). `deliverLayerSplit` reads them —
 * one reading for both callers.
 */
export interface LayerSplitSettings {
  readonly maxLayers: unknown
  readonly size: unknown
}

/** The settings a job carries, picked off its payload or its `input_data`. */
export function layerSplitSettingsOf(source: Readonly<Record<string, unknown>>): LayerSplitSettings {
  return { maxLayers: source.maxLayers, size: source.size }
}

/** What the one delivery is handed — the same on the worker's path and the reconcile's. */
export interface LayerSplitDelivery {
  readonly jobId: string
  /** The finished task's result (`layerDecompositionResultOf`). */
  readonly result: LayerDecompositionResult
  readonly settings: LayerSplitSettings
  /** Who finalizes: the worker (its run, or its stall re-pick), or the reconcile cron. */
  readonly claimant: FinalizeClaimant
}

/**
 * One layer's public data (the Layer data output): its stored file as `url`,
 * and the stored base picture it was cut from as `baseUrl` — the job's own
 * `imageUrl`. After a run once per picture, a layer is paired with its base by
 * `baseUrl`, never by its `row`: Base lists only the pictures that produced a
 * result, so a picture that failed shifts every later base's place.
 */
export function layerDataOf(layer: DecomposedLayer, storedUrl: string | undefined, baseUrl: string): Record<string, unknown> {
  return {
    ...(layer.name ? { name: layer.name } : {}),
    ...(layer.description ? { description: layer.description } : {}),
    zIndex: layer.zIndex,
    ...(layer.width !== undefined ? { width: layer.width } : {}),
    ...(layer.height !== undefined ? { height: layer.height } : {}),
    ...(layer.box ? { box: layer.box } : {}),
    ...(layer.boxNormalized ? { boxNormalized: layer.boxNormalized } : {}),
    url: storedUrl ?? layer.url,
    baseUrl,
  }
}

/**
 * The job's side output data: each stored layer's data (its stored file as
 * `url`, the stored base as `baseUrl`), how many layers were saved, and how
 * many the model returned that could not be saved.
 */
export function splitOutputData(layers: readonly DecomposedLayer[], storedUrls: readonly string[], droppedIndices: readonly number[], baseUrl: string): Record<string, unknown> {
  const gone = new Set(droppedIndices)
  const kept = layers.filter((_, i) => !gone.has(i))
  return {
    layerData: kept.map((l, i) => layerDataOf(l, storedUrls[i], baseUrl)),
    layerCount: kept.length,
    layersNotSaved: layers.length - kept.length,
  }
}

/**
 * The finalize's outcome, a store failure made REFUNDABLE. Every layer that
 * cannot be stored is dropped rather than failing the run, so a post-processing
 * error out of the finalize is the BASE picture's: the run delivered nothing
 * usable, so it fails as a plain error — never the post-processing kind that
 * keeps the charge. A `{ ok: false }` outcome is returned as it is.
 */
async function baseStoreRefundable(finalize: Promise<FinalizeOutcome>): Promise<FinalizeOutcome> {
  try {
    return await finalize
  } catch (err) {
    if (isPostProcessingError(err)) {
      throw new Error(`Split into Layers: the base picture could not be saved (${err instanceof Error ? err.message : String(err)})`, { cause: err })
    }
    throw err
  }
}

/**
 * Finalize a finished split. Each image is tried `LAYER_STORE_ATTEMPTS` times;
 * a layer that still cannot be stored is dropped and the run completes with the
 * rest, charged for the images really stored (the base and each stored layer).
 * A base that cannot be stored throws a plain, refundable error (`baseStoreRefundable`).
 */
export async function deliverLayerSplit(d: LayerSplitDelivery): Promise<FinalizeOutcome> {
  const size = layerSplitSize(d.settings.size)
  const maxImages = layerSplitImagesHeld(d.settings.maxLayers)
  // The layers returned, never more than were asked for (more cannot be
  // charged anyway: the hold caps the commit). A run that found no element
  // completes with its base alone, at the one-image row.
  const layers = d.result.layers.slice(0, maxImages - 1)
  const tier = layerSplitTier(size)
  return baseStoreRefundable(finalizeJobWithMedia({
    jobId: d.jobId,
    jobType: "edit-image",
    claimant: d.claimant,
    result: {
      url: d.result.baseUrl,
      // Recorded only (jobs.provider_cost): the settlement reads the row of the images stored.
      cost: d.result.kieCredits !== undefined ? d.result.kieCredits * KIE_CREDIT_USD : null,
      providerUsed: LAYER_DECOMPOSITION_MODEL_KEY,
      kieTaskId: d.result.taskId,
      ...(d.result.providerMs !== undefined ? { providerMs: d.result.providerMs } : {}),
    },
    storeAttempts: LAYER_STORE_ATTEMPTS,
    extraImageSets: [{ key: "layers", images: layers.map((l) => ({ url: l.url, ...(l.name ? { name: l.name } : {}) })), library: true, dropUnstorable: true }],
    // `baseUrl`: the base exactly as this finalize stored it (output_data.imageUrl).
    extraOutputData: (stored, dropped, baseUrl) => splitOutputData(layers, stored.layers ?? [], dropped.layers ?? [], baseUrl),
    meteredBaseCredits: async (stored) => creditIdBaseCredits(layerSplitCreditId(descriptor.type, tier, (stored.layers?.length ?? 0) + 1)),
  }))
}

/**
 * The reconcile's recovery (backend/src/nodes/kit.ts `UnitRecover`): the saved
 * task's result, read back exactly as the worker's run assembles it, and the
 * settings off the job's `input_data`, through the one delivery. A result with
 * no base throws (the parser's error), and so does a base that cannot be
 * stored: the reconcile fails the job and refunds it.
 */
export const recover: UnitRecover = async (task) =>
  deliverLayerSplit({
    jobId: task.jobId,
    result: layerDecompositionResultOf({ taskId: task.taskId, resultJson: task.result, kieCredits: task.providerCredits, providerMs: task.providerMs }),
    settings: layerSplitSettingsOf(task.input),
    claimant: task.claimant,
  })
