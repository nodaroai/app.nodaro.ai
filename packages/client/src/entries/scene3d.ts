/**
 * `@nodaro/sdk/scene3d` — the `scene3d` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export type { GenerateScene3DParams, EditScene3DParams, RenderScene3DParams, Scene3DJobOutput, Scene3DCapabilities, Scene3DAuthoringEngine } from "../resources/scene3d-types.js"

export { Scene3DResource } from "../resources/scene3d.js"

export type { RetainedScene3DEditParams, RetainedScene3DEditResult } from "../resources/scene3d-types.js"

export type { Scene3DDelivery, Scene3DDeliveryAsset, Scene3DDeliveryAssetKind } from "../resources/scene3d-types.js"

export { SCENE3D_DELIVERY_ASSET_USAGE } from "../resources/scene3d-types.js"

export type {
  Pro3DRenderParams,
  Pro3DRenderRunParams,
  Pro3DRenderQuote,
  Pro3DRenderRunOptions,
  Pro3DRenderJobOutput,
} from "../resources/scene3d-types.js"
