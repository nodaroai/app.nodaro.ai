// The video-queue handler: split one image into a base picture and its layers
// (providers/kie/layer-decomposition.ts), then deliver it through the one
// delivery (recover.ts `deliverLayerSplit`) — the base as the run's image, every
// layer stored beside it and filed in the Library under its name, each layer's
// data on `layerData` — settled on the images stored. A job whose delivery
// failed, or whose worker died after the provider finished, is finished from
// its saved task by the reconcile through that same delivery (recover.ts).
import { layerSplitImagesHeld, layerSplitPrompt, layerSplitSize } from "@nodaro/render-rules"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import { runLayerDecomposition } from "../../providers/kie/layer-decomposition.js"
import { LAYER_DECOMPOSITION_MODEL_KEY } from "../../providers/kie/models.js"
import { ensureImageForProvider } from "../../providers/kie/video.js"
import { setJobProgress, startProgressRamp } from "../../workers/shared.js"
import type { UnitWorker } from "../kit.js"
import { descriptor } from "./descriptor.generated.js"
import { deliverLayerSplit, layerSplitSettingsOf } from "./recover.js"

interface SplitIntoLayersJob {
  readonly jobId: string
  readonly imageUrl: string
  readonly maxLayers?: number
  readonly size?: string
  readonly prompt?: string
}

export const worker: UnitWorker = async function handleSplitIntoLayers(job, ctx) {
  const d = job.data as SplitIntoLayersJob
  const settings = layerSplitSettingsOf(job.data as Record<string, unknown>)
  const size = layerSplitSize(settings.size)
  const maxImages = layerSplitImagesHeld(settings.maxLayers)
  console.log(`[worker] ${descriptor.type} ${ctx.jobId} (size ${size}, up to ${maxImages} images)`)

  await setJobProgress(job, ctx.jobId, 5)
  // A format, size or file the model refuses is fixed (or refused by name) before the call.
  const imageUrl = await ensureImageForProvider(d.imageUrl, LAYER_DECOMPOSITION_MODEL_KEY, { context: "Split into Layers", inputLabel: "image" })
  await setJobProgress(job, ctx.jobId, 10)
  const ramp = startProgressRamp(job, ctx.jobId, { start: 10, cap: 80 })
  let result
  try {
    result = await runLayerDecomposition(
      { imageUrl, maxImages, size, ...(layerSplitPrompt(d.prompt) ? { prompt: layerSplitPrompt(d.prompt) } : {}) },
      { onTaskCreated: makeOnTaskCreated(ctx.jobId, "kie-standard"), modelKey: LAYER_DECOMPOSITION_MODEL_KEY },
    )
  } finally {
    ramp.stop()
  }
  await setJobProgress(job, ctx.jobId, 85)
  console.log(`[worker] ${descriptor.type} ${ctx.jobId}: ${result.layers.length} layer(s) returned${result.kieCredits !== undefined ? ` (task: ${result.kieCredits} KIE credits)` : ""}`)

  // A base picture that cannot be stored throws a refundable error here; on a
  // retry the stall re-pick finishes the job from the saved task (recover.ts).
  const outcome = await deliverLayerSplit({ jobId: ctx.jobId, result, settings, claimant: "worker" })
  if (!outcome.ok) return
  await setJobProgress(job, ctx.jobId, 100)
}
