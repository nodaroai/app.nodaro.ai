import { createHash, randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createScene3DArtifactToolkit } from "../lib/private-plugins/scene3d-artifact-toolkit.js"
import { scene3DPrivateStore } from "../lib/private-plugins/scene3d-storage.js"
import type { SceneRenderChild } from "../lib/private-plugins/scene3d-render-toolkit.js"
import { prepareScene3DRenderAssets, serveScene3DRenderAssets } from "./scene3d-render-assets.js"

export async function prepareSceneChildAssets(child: SceneRenderChild, workDir: string, signal: AbortSignal) {
  const { input } = child
  if (input.plan.schemaVersion === 1) return { assetUrls: {}, close() {} }
  if (input.assets === "retained-revision") return prepareScene3DRenderAssets({ userId: input.userId,
    plan: input.plan, workDir, store: scene3DPrivateStore(), signal })
  const artifacts = createScene3DArtifactToolkit()
  if (!artifacts) throw new Error("Scene private storage is unavailable")
  const files = new Map<string, { path: string; bytes: number; mime: string }>()
  let total = 0
  for (const asset of input.plan.assets) {
    if (asset.kind !== "glb" && asset.kind !== "camera-track-json") continue
    signal.throwIfAborted()
    total += asset.byteLength
    if (total > 64 * 1024 * 1024) throw new Error("Scene render exceeds its asset budget")
    const bytes = await artifacts.read({ jobId: input.parentJobId, userId: input.userId,
      revisionId: input.plan.revisionId, artifactId: asset.assetId }, { signal })
    if (bytes.byteLength !== asset.byteLength || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
      throw new Error("Scene render input differs from its owned bytes")
    }
    // Asset identifiers are logical keys, never filesystem path components.
    const path = join(workDir, `${randomUUID()}.bin`)
    await writeFile(path, bytes, { flag: "wx", mode: 0o600, signal })
    files.set(asset.assetId, { path, bytes: bytes.byteLength, mime: asset.kind === "glb" ? "model/gltf-binary" : "application/json" })
  }
  signal.throwIfAborted()
  return serveScene3DRenderAssets(files)
}
