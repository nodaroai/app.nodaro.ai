import { SCENE3D_V2_LIMITS, type Scene3DAssetRef } from "@nodaro/shared"
import type { NodaroClient } from "../client.js"
import type { RunNodeResult, RunAndWaitOptions, NodeJobOutput } from "./nodes.js"
import type { EditScene3DParams, GenerateScene3DParams, RenderScene3DParams, Scene3DCapabilities, Scene3DJobOutput } from "./scene3d-types.js"
import type { RetainedScene3DEditParams, RetainedScene3DEditResult } from "./scene3d-types.js"

/** Scene authoring and render-only export through the same platform nodes. */
export class Scene3DResource {
  constructor(private client: NodaroClient) {}

  capabilities(): Promise<Scene3DCapabilities> {
    return this.client.request("GET", "/v1/3d-scene/capabilities")
  }

  /** Persist deterministic overlays without an LLM or a generation charge. */
  applyEdits(revisionId: string, params: RetainedScene3DEditParams): Promise<RetainedScene3DEditResult> {
    return this.client.request("POST", `/v1/3d-scene/revisions/${encodeURIComponent(revisionId)}/edits`, { body: params })
  }

  /** Asset access is scoped to an exact retained revision, with fresh authentication. */
  assetBytes(revisionId: string, asset: Scene3DAssetRef, options?: { signal?: AbortSignal }): Promise<ArrayBuffer> {
    if (!["glb", "camera-track-json", "poster", "validation-report"].includes(asset.kind)) {
      throw new Error("This asset is not available through the playback endpoint")
    }
    if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1 || asset.byteLength > SCENE3D_V2_LIMITS.maxRendererAssetBytes) {
      throw new Error("Invalid scene asset byte length")
    }
    return this.client.requestBytes("GET", `/v1/3d-scene/revisions/${encodeURIComponent(revisionId)}/assets/${encodeURIComponent(asset.assetId)}`, {
      signal: options?.signal, maxBytes: asset.byteLength,
    })
  }

  /** The editable native file has its own authorization lane. */
  sourceBytes(revisionId: string, options?: { signal?: AbortSignal }): Promise<ArrayBuffer> {
    return this.client.requestBytes("GET", `/v1/3d-scene/revisions/${encodeURIComponent(revisionId)}/source`, {
      signal: options?.signal, maxBytes: SCENE3D_V2_LIMITS.maxBlendSourceBytes,
    })
  }

  generate(params: GenerateScene3DParams): Promise<RunNodeResult> {
    return this.client.nodes.run("generate-3d-scene", params)
  }

  generateAndWait(params: GenerateScene3DParams, options?: RunAndWaitOptions): Promise<Scene3DJobOutput> {
    return this.client.nodes.runAndWait("generate-3d-scene", params, options)
  }

  edit(params: EditScene3DParams): Promise<RunNodeResult> {
    return this.client.nodes.run("edit-3d-scene", params)
  }

  editAndWait(params: EditScene3DParams, options?: RunAndWaitOptions): Promise<Scene3DJobOutput> {
    return this.client.nodes.runAndWait("edit-3d-scene", params, options)
  }

  /** Uses the supplied immutable revision; never starts authoring or a rebuild. */
  render(params: RenderScene3DParams): Promise<RunNodeResult> {
    return this.client.nodes.run("render-video", params)
  }

  renderAndWait(params: RenderScene3DParams, options?: RunAndWaitOptions): Promise<NodeJobOutput> {
    return this.client.nodes.runAndWait("render-video", params, options)
  }
}
