export type {
  RenderVideoInputProps,
  MediaAsset,
  TextOverlay,
  CaptionSettings,
  CaptionPosition,
  LegacyCaptionStyle,
  TransitionStyle,
  TemplateId,
  CompositionId,
} from "./types"

export type {
  SceneGraph,
  SceneGraphInputProps,
  MediaTrack,
  AudioTrack,
  TextTrack,
  Track,
  MediaSegment,
  TextSegment,
  Transition,
  Effect,
  SegmentLayout,
  TransitionType,
  EffectType,
  TextAnimation,
  LayoutMode,
} from "./scene-graph"

export type {
  AfterEffectsPlan,
  AfterEffect,
  LottieOverlayPlan,
  LottieOverlayItem,
  ThreeDTitlePlan,
  ThreeDTitleObject,
  MotionGraphicsPlan,
  MGElement,
  CompositePlan,
  CompositeLayer,
  ComposerPlanType,
} from "./plan-types"

export { legacyToSceneGraph } from "./lib/legacy-converter"

// ── Scene3D previz (3d-scene) ───────────────────────────────────────────
// `Scene3DRenderer` is the Remotion composition component (reads
// `useCurrentFrame()`), so it needs a Remotion context — a `<Player>` in the
// editor, or the `3d-scene` composition in the render worker. Hosts that want
// the raw canvas with their own scrubber should import `Scene3DCanvas` (from
// here or, to keep `remotion` out of the bundle, from `@nodaro/remotion/scene3d`).
export { Scene3DRenderer } from "./compositions/scene3d-renderer"
export type { Scene3DRendererProps } from "./compositions/scene3d-renderer"
export { Scene3DCanvas } from "./scene3d/scene3d-canvas"
export type { Scene3DCanvasProps, Scene3DAnyPlan } from "./scene3d/scene3d-canvas"
export {
  buildScene3DScene,
  buildScene3DGeometry,
  type Scene3DSceneHandle,
} from "./scene3d/scene-builder"
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
} from "./scene3d/sampler"
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
} from "./scene3d/types"
export { DEFAULT_SENSOR_WIDTH_MM } from "./scene3d/types"
export { SCENE3D_DEFAULT_PLAN } from "./scene3d/default-plan"
// v2 playback: the host-facing surface only (asset resolution, version
// support, failure codes). See `./scene3d/index.ts` for the full list.
export {
  isScene3DPlanV2,
  isScene3DPlanV1,
  isScene3DSchemaVersionSupported,
  scene3DPlanSchemaVersion,
  SCENE3D_SUPPORTED_SCHEMA_VERSIONS,
} from "./scene3d/v2/plan-shape"
export type {
  Scene3DPlanV2,
  Scene3DEntityV2,
  Scene3DEntityVisual,
  Scene3DAssetRef,
  Scene3DShot,
  Scene3DOverride,
  Scene3DCameraTrackV1,
  /** The V1|V2 union — what every host-facing surface should accept. */
  Scene3DPlan,
} from "./scene3d/v2/plan-shape"
export {
  createUrlAssetResolver,
  verifyAssetBytes,
  type Scene3DAssetResolver,
} from "./scene3d/v2/asset-resolver"
export {
  Scene3DError,
  isScene3DError,
  type Scene3DErrorCode,
  type Scene3DReadinessWarning,
} from "./scene3d/v2/errors"
export { SCENE3D_V2_LIMITS } from "./scene3d/v2/limits"
