import { scene3DPlanV2Schema, type Scene3DPlanV2 } from "@nodaro/shared"
import type { PluginSceneArtifactToolkit } from "./scene3d-artifact-contract.js"
import type { PluginScenePlaybackToolkit } from "./scene3d-playback-contract.js"

interface Reader {
  inspectGlb(bytes: ArrayBuffer, subject: string): { animationNames: readonly string[]; meshNodeCount: number; triangleCount: number }
  validateScene3DBytes(plan: Scene3DPlanV2, assets: ReadonlyMap<string, ArrayBuffer>, signal: AbortSignal):
    Promise<{ warnings: Array<{ code: string; message: string; subject?: string }> }>
}

let reader: Promise<Reader> | undefined
function loadReader(): Promise<Reader> {
  // Both src/ and dist/ entrypoints resolve the emitted plain-JS bundle here.
  return reader ??= import(new URL("../../../dist/lib/scene3d-reader.mjs", import.meta.url).href)
    .catch(() => { reader = undefined; throw new Error("Scene playback reader is unavailable") })
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

export function createScene3DPlaybackToolkit(artifacts: PluginSceneArtifactToolkit): PluginScenePlaybackToolkit {
  return {
    async inspectGlb(input, options) {
      options?.signal?.throwIfAborted()
      const bytes = await artifacts.read(input, options)
      options?.signal?.throwIfAborted()
      const inspection = (await loadReader()).inspectGlb(exactBuffer(bytes), input.artifactId)
      return { animationClipNames: inspection.animationNames, meshNodeCount: inspection.meshNodeCount,
        triangleCount: inspection.triangleCount }
    },
    async validate(input, options) {
      options?.signal?.throwIfAborted()
      const plan = scene3DPlanV2Schema.parse(input.plan) as Scene3DPlanV2
      if (plan.revisionId !== input.revisionId) throw new Error("Scene playback revision does not match its job scope")
      const assets = new Map<string, ArrayBuffer>()
      let total = 0
      for (const asset of plan.assets) {
        if (asset.kind !== "glb" && asset.kind !== "camera-track-json") continue
        total += asset.byteLength
        if (total > 64 * 1024 * 1024) throw new Error("Scene playback exceeds its byte budget")
        assets.set(asset.assetId, exactBuffer(await artifacts.read({ ...input, artifactId: asset.assetId }, options)))
      }
      const signal = options?.signal ?? new AbortController().signal
      signal.throwIfAborted()
      return (await loadReader()).validateScene3DBytes(plan, assets, signal)
    },
  }
}
