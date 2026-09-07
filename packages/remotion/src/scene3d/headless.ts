/** The server uses the same asset reader as browser playback, without importing React. */
import { loadScene3DV2 } from "./v2/load"
import { buildScene3DV2Scene } from "./v2/scene-builder-v2"
import type { Scene3DPlanV2 } from "./v2/plan-shape"
export { inspectGlb } from "./v2/glb-inspect"

export async function validateScene3DBytes(
  plan: Scene3DPlanV2,
  assets: ReadonlyMap<string, ArrayBuffer>,
  signal: AbortSignal,
) {
  const loaded = await loadScene3DV2(plan, {
    signal,
    resolver: { resolve: async (asset) => {
      const bytes = assets.get(asset.assetId)
      if (!bytes) throw new Error("Scene playback asset is missing")
      return bytes
    } },
  })
  const scene = buildScene3DV2Scene(loaded)
  try {
    signal.throwIfAborted()
    scene.applyFrame(0)
    return { warnings: loaded.warnings }
  } finally { scene.dispose() }
}
