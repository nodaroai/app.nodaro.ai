import type { NodaroClient } from "../client.js"
import type { RunNodeResult, RunAndWaitOptions, NodeJobOutput } from "./nodes.js"
import type { EditScene3DParams, GenerateScene3DParams, RenderScene3DParams, Scene3DCapabilities, Scene3DJobOutput } from "./scene3d-types.js"

/** Scene authoring and render-only export through the same platform nodes. */
export class Scene3DResource {
  constructor(private client: NodaroClient) {}

  capabilities(): Promise<Scene3DCapabilities> {
    return this.client.request("GET", "/v1/3d-scene/capabilities")
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
