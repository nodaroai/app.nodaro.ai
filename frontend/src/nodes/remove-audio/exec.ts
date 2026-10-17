import { toast } from "sonner"
import type { UnitExecKit, UnitExecutor } from "../exec-kit"
import { removeAudioApi } from "./api"

// The editor's DAG executor: one video in → a video-queue job → silent video out.
export const executor: UnitExecutor = {
  execute(_node, kit: UnitExecKit) {
    const videoUrl = kit.overrideMediaUrl ?? kit.inputs.videoUrl
    if (!videoUrl) {
      toast.error(kit.nodeRunError("nodeRun.noVideoInput"))
      return Promise.reject(new Error("No video"))
    }
    kit.setUserPromptTemplate(undefined)
    return kit.runProcessingNode(() => removeAudioApi(videoUrl, kit.userId), "generatedVideoUrl", "Remove Audio")
  },
}
