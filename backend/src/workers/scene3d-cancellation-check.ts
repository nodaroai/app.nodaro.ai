import { SceneRenderParentInactiveError, requireSceneRenderParent, isRunnableSceneRenderStatus,
  type SceneRenderPorts, type SceneRenderChild } from "../lib/private-plugins/scene3d-render-toolkit.js"
import { Scene3DArtifactError } from "../services/scene3d-artifacts/types.js"

/** Brief read outages get a bounded grace period; positive revocation always stops immediately. */
export function sceneRenderCancellationCheck(ports: SceneRenderPorts, child: SceneRenderChild, maxReadErrors = 5): () => Promise<boolean> {
  let readErrors = 0
  return async () => {
    try {
      const current = await ports.read(child.id)
      if (!current || !isRunnableSceneRenderStatus(current.status)) return true
      await requireSceneRenderParent(ports, child.input, true)
      readErrors = 0
      return false
    } catch (error) {
      if (error instanceof SceneRenderParentInactiveError || (error instanceof Scene3DArtifactError && error.code === "SCENE_JOB_INVALID")) return true
      if (++readErrors >= maxReadErrors) throw error
      return false
    }
  }
}
