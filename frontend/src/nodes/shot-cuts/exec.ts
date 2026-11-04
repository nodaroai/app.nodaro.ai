import { toast } from "sonner"
import type { UnitExecKit, UnitExecutor } from "../exec-kit"
import { shotCutsApi } from "./api"
import { definition } from "./definition.generated"

// The editor's DAG executor: one video in → a video-queue job → its JSON
// outputs (the shots, and with frames on each shot's first and last frame).
export const executor: UnitExecutor = {
  execute(node, kit: UnitExecKit) {
    const videoUrl = kit.overrideMediaUrl ?? kit.inputs.videoUrl
    if (!videoUrl) {
      toast.error(kit.nodeRunError("nodeRun.noVideoInput"))
      return Promise.reject(new Error("No video"))
    }
    const frames = (node.data as { frames?: unknown }).frames === true
    kit.setUserPromptTemplate(undefined)
    return kit.runJsonNode(() => shotCutsApi({ videoUrl, frames }, kit.userId), definition.label)
  },
}
