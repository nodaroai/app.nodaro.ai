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
