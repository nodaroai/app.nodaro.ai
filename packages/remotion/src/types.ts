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
import type { CaptionStyle } from "@nodaro/shared/captions"

/**
 * One resolved caption segment: a self-contained time range with its own words
 * and its fully-merged style. Its `style` may be ANY caption style (including
 * `subtitle`) because a segmented render goes entirely through Remotion. The
 * backend resolver fills every field, so nothing is left to fall back to here.
 */
export interface BurnCaptionsSegment {
  startMs: number
  endMs: number
  style: CaptionStyle
  position: "top" | "center" | "bottom"
  fontSize: number
  color: string
  backgroundColor?: string
  fontFamily?: string
  fontWeight?: number
  strokeColor?: string
  strokeWidth?: number
  highlightColor?: string
  uppercase?: boolean
  positionY?: number
  /** Per-word motion switch (default true); false freezes the geometric
   *  animation. Inert on `subtitle`. */
  animate?: boolean
  /** Words-per-line cap for THIS segment; the resolver fills it from the
   *  top-level value when the segment sets none. */
  maxWordsPerLine?: number
  captions: Caption[]
}

export interface BurnCaptionsPlan {
  planType: "burn-captions"
  sourceVideo: string
  captions: Caption[]
  // ANY caption style (not just kinetic): a top-level `subtitle` carrying
  // styling levers / a transcript / captions[] renders via the Remotion
  // SubtitleOverlay, so the plan's top-level style can be `subtitle` too.
  style: CaptionStyle
  position: "top" | "center" | "bottom"
  fontSize: number
  color: string
  backgroundColor?: string
  /** Optional look levers (all default to the prior render when unset): a
   *  Google-font face name, an outline, the spoken-word colour, casing, and a
   *  free vertical position (0-100 % of composition height). */
  fontFamily?: string
  fontWeight?: number
  strokeColor?: string
  strokeWidth?: number
  highlightColor?: string
  uppercase?: boolean
  positionY?: number
  /** Per-word motion switch (default true); false freezes the geometric
   *  animation (word-highlight size hop, karaoke sweep, spring enters) while
   *  keeping grouping/holding/highlight. Inert on `subtitle`. */
  animate?: boolean
  /** Cap on words per caption LINE (or tiktok page), applied on top of the
   *  width budget and the speaker's phrasing. A styling lever: it shapes the
   *  Remotion-rendered `subtitle` too, not just the kinetic styles. */
  maxWordsPerLine?: number
  /** Optional per-segment captions: when present the top-level `captions`/style
   *  above are ignored and each segment renders its own words + style, gated to
   *  its time range. */
  segments?: BurnCaptionsSegment[]
  fps: number
  width: number
  height: number
  durationInFrames: number
}

export interface BurnCaptionsInputProps {
  plan: BurnCaptionsPlan
}
