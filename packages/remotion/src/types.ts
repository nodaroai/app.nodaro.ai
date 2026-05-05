export type TemplateId = "slideshow" | "explainer" | "social-reel" | "documentary"
export type CompositionId = TemplateId | "scene-graph" | "after-effects" | "lottie-overlay" | "3d-title" | "motion-graphics" | "composite"

export type TransitionStyle = "fade" | "slide" | "dissolve" | "zoom" | "none"

/**
 * Legacy template-render caption styles (slideshow/social-reel). For
 * the new add-captions burn-captions path, see @nodaro/shared::CaptionStyle.
 */
export type LegacyCaptionStyle = "subtitle" | "word-highlight" | "karaoke"

export type CaptionPosition = "bottom" | "top" | "center"

export interface MediaAsset {
  readonly src: string
  readonly type: "image" | "video" | "audio"
  readonly durationSeconds?: number
}

export interface TextOverlay {
  readonly text: string
  readonly position: "top" | "center" | "bottom"
  readonly fontSize: number
  readonly color: string
  readonly startFrame: number
  readonly endFrame: number
}

export interface CaptionSettings {
  readonly enabled: boolean
  readonly style: LegacyCaptionStyle
  readonly position: CaptionPosition
  readonly fontSize: number
  readonly color: string
}

export interface RenderVideoInputProps {
  readonly template: TemplateId
  readonly fps: number
  readonly width: number
  readonly height: number
  readonly durationInFrames: number
  readonly transitionStyle: TransitionStyle
  readonly transitionDurationFrames: number
  readonly mediaAssets: readonly MediaAsset[]
  readonly audioTrackUrl?: string
  readonly textOverlays: readonly TextOverlay[]
  readonly captions: CaptionSettings
  readonly backgroundColor: string
  readonly kenBurnsEnabled: boolean
}

import type { Caption } from "@remotion/captions"
import type { KineticCaptionStyle } from "@nodaro/shared"

export interface BurnCaptionsPlan {
  planType: "burn-captions"
  sourceVideo: string
  captions: Caption[]
  style: KineticCaptionStyle
  position: "top" | "center" | "bottom"
  fontSize: number
  color: string
  backgroundColor?: string
  fps: number
  width: number
  height: number
  durationInFrames: number
}

export interface BurnCaptionsInputProps {
  plan: BurnCaptionsPlan
}
