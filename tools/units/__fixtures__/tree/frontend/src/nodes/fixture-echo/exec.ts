import type { UnitExecKit, UnitExecutor } from "../exec-kit"
import { fixtureEchoApi } from "./api"

export const executor: UnitExecutor = {
  async execute(node, kit: UnitExecKit) {
    const videoUrl = kit.overrideMediaUrl ?? kit.inputs.videoUrl
    if (!videoUrl) throw new Error(kit.nodeRunError("nodeRun.noVideoInput"))
    return kit.runProcessingNode(() => fixtureEchoApi(videoUrl), "generatedVideoUrl", String(node.data.label))
  },
}
