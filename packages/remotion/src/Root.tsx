import React from "react"
import { Composition } from "remotion"
import type { RenderVideoInputProps } from "./types"
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

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="slideshow"
        component={Slideshow}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={DEFAULT_PROPS}
      />
      <Composition
        id="explainer"
        component={Explainer}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ ...DEFAULT_PROPS, template: "explainer" }}
      />
      <Composition
        id="social-reel"
        component={SocialReel}
        durationInFrames={300}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ ...DEFAULT_PROPS, template: "social-reel", width: 1080, height: 1920 }}
      />
      <Composition
        id="documentary"
        component={Documentary}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ ...DEFAULT_PROPS, template: "documentary", kenBurnsEnabled: true }}
      />
    </>
  )
}
