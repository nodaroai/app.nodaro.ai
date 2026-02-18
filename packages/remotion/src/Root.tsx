import React from "react"
import { Composition } from "remotion"
import type { RenderVideoInputProps, TemplateId } from "./types"
import { Slideshow } from "./compositions/slideshow"
import { Explainer } from "./compositions/explainer"
import { SocialReel } from "./compositions/social-reel"
import { Documentary } from "./compositions/documentary"

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
  component: React.FC<RenderVideoInputProps>
  width: number
  height: number
  extraProps?: Partial<RenderVideoInputProps>
}> = [
  { id: "slideshow", component: Slideshow, width: 1920, height: 1080 },
  { id: "explainer", component: Explainer, width: 1920, height: 1080 },
  { id: "social-reel", component: SocialReel, width: 1080, height: 1920 },
  { id: "documentary", component: Documentary, width: 1920, height: 1080, extraProps: { kenBurnsEnabled: true } },
]

export function RemotionRoot() {
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
    </>
  )
}
