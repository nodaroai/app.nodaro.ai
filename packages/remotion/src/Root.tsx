import React from "react"
import { Composition, registerRoot } from "remotion"
import type { RenderVideoInputProps, TemplateId } from "./types"
import type { SceneGraphInputProps } from "./scene-graph"
import { Slideshow } from "./compositions/slideshow"
import { Explainer } from "./compositions/explainer"
import { SocialReel } from "./compositions/social-reel"
import { Documentary } from "./compositions/documentary"
import { SceneGraphRenderer } from "./compositions/scene-graph-renderer"
import { AfterEffectsRenderer } from "./compositions/after-effects-renderer"
import { LottieOverlayRenderer } from "./compositions/lottie-overlay-renderer"
import { MotionGraphicsRenderer } from "./compositions/motion-graphics-renderer"
import { CompositeRenderer } from "./compositions/composite-renderer"
import type { AfterEffectsPlan, LottieOverlayPlan, MotionGraphicsPlan, CompositePlan } from "./plan-types"

/**
 * Bridge specific component prop types with Remotion's
 * LooseComponentType<Record<string, unknown>> requirement.
 * Props are always provided at runtime via inputProps/defaultProps.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asRemotionComponent(Comp: React.FC<any>): React.FC<Record<string, unknown>> {
  const Wrapper: React.FC<Record<string, unknown>> = (props) => (
    <Comp {...props} />
  )
  Wrapper.displayName = `Remotion(${Comp.displayName ?? Comp.name})`
  return Wrapper
}

const DEFAULT_PROPS: RenderVideoInputProps = {
  template: "slideshow",
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 300,
  transitionStyle: "fade",
  transitionDurationFrames: 15,
  mediaAssets: [],
  textOverlays: [],
  captions: {
    enabled: false,
    style: "subtitle",
    position: "bottom",
    fontSize: 24,
    color: "#ffffff",
  },
  backgroundColor: "#000000",
  kenBurnsEnabled: false,
}

const COMPOSITIONS: Array<{
  id: TemplateId
  component: React.FC<Record<string, unknown>>
  width: number
  height: number
  extraProps?: Partial<RenderVideoInputProps>
}> = [
  { id: "slideshow", component: asRemotionComponent(Slideshow), width: 1920, height: 1080 },
  { id: "explainer", component: asRemotionComponent(Explainer), width: 1920, height: 1080 },
  { id: "social-reel", component: asRemotionComponent(SocialReel), width: 1080, height: 1920 },
  { id: "documentary", component: asRemotionComponent(Documentary), width: 1920, height: 1080, extraProps: { kenBurnsEnabled: true } },
]

const SCENE_GRAPH_DEFAULT_PROPS: SceneGraphInputProps = {
  sceneGraph: {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    backgroundColor: "#000000",
    tracks: [],
  },
}

const AFTER_EFFECTS_DEFAULT_PROPS: { plan: AfterEffectsPlan } = {
  plan: {
    planType: "after-effects",
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    sourceVideo: "",
    effects: [],
    textOverlays: [],
  },
}

const LOTTIE_OVERLAY_DEFAULT_PROPS: { plan: LottieOverlayPlan } = {
  plan: {
    planType: "lottie-overlay",
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    sourceVideo: "",
    overlays: [],
  },
}

const MOTION_GRAPHICS_DEFAULT_PROPS: { plan: MotionGraphicsPlan } = {
  plan: {
    planType: "motion-graphics",
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 150,
    backgroundColor: "#00000000",
    elements: [],
  },
}

const COMPOSITE_DEFAULT_PROPS: { plan: CompositePlan } = {
  plan: {
    planType: "composite",
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    backgroundColor: "#000000",
    layers: [],
  },
}

function RemotionRoot() {
  return (
    <>
      {COMPOSITIONS.map(({ id, component, width, height, extraProps }) => (
        <Composition
          key={id}
          id={id}
          component={component}
          durationInFrames={300}
          fps={30}
          width={width}
          height={height}
          defaultProps={{ ...DEFAULT_PROPS, template: id, width, height, ...extraProps }}
        />
      ))}
      <Composition
        id="scene-graph"
        component={asRemotionComponent(SceneGraphRenderer)}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={SCENE_GRAPH_DEFAULT_PROPS}
      />
      <Composition
        id="after-effects"
        component={asRemotionComponent(AfterEffectsRenderer)}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={AFTER_EFFECTS_DEFAULT_PROPS}
      />
      <Composition
        id="lottie-overlay"
        component={asRemotionComponent(LottieOverlayRenderer)}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={LOTTIE_OVERLAY_DEFAULT_PROPS}
      />
      <Composition
        id="motion-graphics"
        component={asRemotionComponent(MotionGraphicsRenderer)}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={MOTION_GRAPHICS_DEFAULT_PROPS}
      />
      <Composition
        id="composite"
        component={asRemotionComponent(CompositeRenderer)}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={COMPOSITE_DEFAULT_PROPS}
      />
    </>
  )
}

registerRoot(RemotionRoot)
