import { toast } from "sonner"
import type { UnitExecKit, UnitExecutor } from "../exec-kit"
import { gifToVideoApi } from "./api"
import type { GifToVideoData } from "./types"

// The editor's DAG executor: one GIF in → a video-queue job → MP4 out.
export const executor: UnitExecutor = {
  execute(node, kit: UnitExecKit) {
    const d = node.data as GifToVideoData
    // The GIF arrives as an image input (an uploaded .gif) or via the node's
    // own upload dropzone (data.gifUrl).
    const gifUrl = kit.overrideMediaUrl ?? kit.inputs.imageUrl ?? d.gifUrl
    if (!gifUrl) {
      toast.error(kit.nodeRunError("nodeRun.noGIFWireAnImage"))
      return Promise.reject(new Error("No GIF"))
    }
    return kit.runProcessingNode(
      () =>
        gifToVideoApi(
          gifUrl,
          {
            loopToMinimum: d.loopToMinimum ?? true,
            targetDuration: d.targetDuration ?? 3,
            interpolate: d.interpolate ?? true,
            alphaBackground: d.alphaBackground ?? "white",
          },
          kit.userId,
        ),
      "generatedVideoUrl",
      "Gif to Video",
    )
  },
}
