import { toast } from "sonner"
import { layerSplitMaxLayers, layerSplitPrompt, layerSplitSize } from "@nodaro/render-rules"
import type { UnitExecKit, UnitExecutor } from "../exec-kit"
import { splitIntoLayersApi } from "./api"
import { definition } from "./definition.generated"
import type { SplitIntoLayersData } from "./types"

// The editor's DAG executor: one image in → a video-queue job → the base
// picture as the take, its layers and layer data landed beside it by the kit
// (runProcessingNode lands a unit's side outputs). The settings go through the
// same render-rules helpers as the route and the server payload, so the request
// a canvas run sends is the one a server run sends.
export const executor: UnitExecutor = {
  execute(node, kit: UnitExecKit) {
    const d = node.data as SplitIntoLayersData
    // A list fan-out's item wins, then the wired image, then an upload on the node.
    const imageUrl = kit.overrideMediaUrl ?? kit.inputs.imageUrl ?? d.imageUrl
    if (!imageUrl) {
      toast.error(kit.nodeRunError("nodeRun.noSourceImageFoundWire"))
      return Promise.reject(new Error("No image"))
    }
    const prompt = layerSplitPrompt(d.prompt)
    const request = {
      imageUrl,
      maxLayers: layerSplitMaxLayers(d.maxLayers),
      size: layerSplitSize(d.size),
      ...(prompt ? { prompt } : {}),
    }
    return kit.runProcessingNode(() => splitIntoLayersApi(request, kit.userId), "generatedImageUrl", definition.label)
  },
}
