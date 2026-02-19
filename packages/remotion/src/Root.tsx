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
import type { AfterEffectsPlan, LottieOverlayPlan } from "./plan-types"

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COMPOSITIONS: Array<{
  id: TemplateId
  component: React.FC<any>
  width: number
  height: number
  extraProps?: Partial<RenderVideoInputProps>
}> = [
  { id: "slideshow", component: Slideshow, width: 1920, height: 1080 },
  { id: "explainer", component: Explainer, width: 1920, height: 1080 },
  { id: "social-reel", component: SocialReel, width: 1080, height: 1920 },
  { id: "documentary", component: Documentary, width: 1920, height: 1080, extraProps: { kenBurnsEnabled: true } },
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
        component={SceneGraphRenderer as React.FC<any>}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={SCENE_GRAPH_DEFAULT_PROPS}
      />
      <Composition
        id="after-effects"
        component={AfterEffectsRenderer as React.FC<any>}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={AFTER_EFFECTS_DEFAULT_PROPS}
      />
      <Composition
        id="lottie-overlay"
        component={LottieOverlayRenderer as React.FC<any>}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={LOTTIE_OVERLAY_DEFAULT_PROPS}
      />
    </>
  )
}

registerRoot(RemotionRoot)
