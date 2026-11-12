import { layerSplitHoldCreditId, layerSplitMaxLayers, layerSplitPrompt, layerSplitSize } from "@nodaro/render-rules"
import { LAYER_DECOMPOSITION_MODEL_KEY } from "../../providers/kie/models.js"
import type { UnitPayload } from "../kit.js"
import { descriptor } from "./descriptor.generated.js"

// The orchestrator payload: the video-queue job worker.ts runs, holding the row
// the route holds for the same settings (layerSplitHoldCreditId). The wired image
// wins over the node's own (an upload on the node). `model` names the provider
// model to the pickup's safety check, as the route's queue job does.
export const payload: UnitPayload = (kit) => {
  const prompt = layerSplitPrompt(kit.data.prompt)
  const run = {
    imageUrl: kit.resolvedInputs.imageUrl || kit.data.imageUrl,
    maxLayers: layerSplitMaxLayers(kit.data.maxLayers),
    size: layerSplitSize(kit.data.size),
    ...(prompt ? { prompt } : {}),
  }
  return kit.ffmpegResult(
    descriptor.type,
    { jobId: kit.jobId, ...run, model: LAYER_DECOMPOSITION_MODEL_KEY, usageLogId: kit.usageLogId },
    layerSplitHoldCreditId(descriptor.type, run),
  )
}
