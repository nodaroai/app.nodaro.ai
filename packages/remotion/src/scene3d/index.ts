/**
 * `@nodaro/remotion/scene3d` — the render-runtime-free entry point.
 *
 * Importing this path pulls three.js and React only; `remotion` is NOT in the
 * graph, so the editor can embed the preview without the render runtime.
 * Use `Scene3DRenderer` from the package root when you want the Remotion
 * composition (it reads `useCurrentFrame()`).
 */
export { Scene3DCanvas } from "./scene3d-canvas"
export type { Scene3DCanvasProps, Scene3DAnyPlan } from "./scene3d-canvas"
export type { Scene3DRenderHandle } from "./handle"

export {
  buildScene3DScene,
  buildScene3DGeometry,
  type Scene3DSceneHandle,
} from "./scene-builder"

export {
  sampleScene3DFrame,
  sampleScene3DObject,
  sampleScene3DCamera,
  focalLengthToVerticalFovDeg,
  scene3DFrameCount,
  type Scene3DFrameSample,
  type Scene3DObjectSample,
  type Scene3DCameraSample,
  type Scene3DTransformSample,
} from "./sampler"

export type {
  Scene3DPlanV1,
  Scene3DObject,
  Scene3DReference,
  Scene3DCamera,
  Scene3DLighting,
  Scene3DPrimitive,
  Scene3DObjectKeyframe,
  Scene3DCameraKeyframe,
  Scene3DEasing,
  Vec3,
} from "./types"
export { DEFAULT_SENSOR_WIDTH_MM } from "./types"
export { SCENE3D_DEFAULT_PLAN } from "./default-plan"

// ── v2 playback ───────────────────────────────────────────────────────────
// The v2 surface a HOST needs: how to hand the renderer authorized bytes, how
// to ask whether this build can play a plan at all, and the failure codes to
// map onto job errors. Everything else (GLB inspection, clip binding, overlay
// composition) is internal to the renderer and deliberately not exported.

export {
  isScene3DPlanV2,
  isScene3DPlanV1,
  isScene3DSchemaVersionSupported,
  scene3DPlanSchemaVersion,
  SCENE3D_SUPPORTED_SCHEMA_VERSIONS,
} from "./v2/plan-shape"
export type {
  Scene3DPlanV2,
  Scene3DEntityV2,
  Scene3DEntityVisual,
  Scene3DAssetRef,
  Scene3DShot,
  Scene3DOverride,
  Scene3DCameraTrackV1,
  // Aliased: the v1 sampler already exports a `Scene3DCameraSample` of its own
  // (a lens/target pair), and the baked sidecar sample is a different thing.
  Scene3DCameraSample as Scene3DBakedCameraSample,
  Scene3DPlan,
} from "./v2/plan-shape"

export {
  createUrlAssetResolver,
  verifyAssetBytes,
  type Scene3DAssetResolver,
  type UrlAssetResolverOptions,
} from "./v2/asset-resolver"

export {
  Scene3DError,
  isScene3DError,
  type Scene3DErrorCode,
  type Scene3DReadinessWarning,
} from "./v2/errors"

export { SCENE3D_V2_LIMITS, SCENE3D_RENDERER_GLB_LIMITS } from "./v2/limits"

export {
  loadScene3DV2,
  validateScene3DPlanV2Shape,
  type Scene3DLoadedScene,
  type Scene3DLoadOptions,
} from "./v2/load"

export {
  buildScene3DV2Scene,
  type Scene3DV2SceneHandle,
  type Scene3DV2FrameSample,
} from "./v2/scene-builder-v2"

export { buildShotTimeline, type Scene3DShotTimeline } from "./v2/shots"
export { decodeScene3DCameraTrack, sampleBakedCamera } from "./v2/camera-track"
