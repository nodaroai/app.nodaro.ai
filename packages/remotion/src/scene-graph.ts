// ── Scene Graph Types ─────────────────────────────────────────────────────
// A track-based video composition model (like video editors).
// The scene graph is the single source of truth for what gets rendered.

export type TransitionType =
  | "fade"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "dissolve"
  | "zoom-in"
  | "zoom-out"
  | "none"

export type EffectType = "ken-burns" | "scale" | "opacity" | "blur"

export type TextAnimation = "fade" | "slide-up" | "typewriter" | "word-highlight" | "none"

export type LayoutMode = "fullscreen" | "positioned"

export interface Transition {
  readonly type: TransitionType
  readonly durationFrames: number
}

export interface Effect {
  readonly type: EffectType
  readonly startValue: number
  readonly endValue: number
}

export interface SegmentLayout {
  readonly mode: LayoutMode
  readonly x?: number // percentage 0-100
  readonly y?: number // percentage 0-100
  readonly width?: number // percentage 0-100
  readonly height?: number // percentage 0-100
  readonly objectFit?: "cover" | "contain" | "fill"
}

export interface MediaSegment {
  readonly id: string
  readonly src: string
  readonly mediaType: "image" | "video" | "gif"
  readonly startFrame: number
  readonly durationInFrames: number
  readonly layout: SegmentLayout
  readonly transitionIn?: Transition
  readonly transitionOut?: Transition
  readonly effects: readonly Effect[]
}

export interface TextSegment {
  readonly id: string
  readonly text: string
  readonly startFrame: number
  readonly durationInFrames: number
  readonly position: "top" | "center" | "bottom"
  readonly fontSize: number
  readonly color: string
  readonly fontWeight?: number
  readonly fontStyle?: "normal" | "italic"
  readonly fontFamily?: string
  readonly animation: TextAnimation
}

export interface MediaTrack {
  readonly type: "media"
  readonly id: string
  readonly zIndex: number
  readonly segments: readonly MediaSegment[]
}

export interface AudioTrack {
  readonly type: "audio"
  readonly id: string
  readonly src: string
  readonly volume: number // 0-1
  readonly fadeInFrames: number
  readonly fadeOutFrames: number
  readonly startFrame?: number
}

export interface TextTrack {
  readonly type: "text"
  readonly id: string
  readonly zIndex: number
  readonly segments: readonly TextSegment[]
}

export type Track = MediaTrack | AudioTrack | TextTrack

export interface SceneGraph {
  readonly fps: number
  readonly width: number
  readonly height: number
  readonly durationInFrames: number
  readonly backgroundColor: string
  readonly tracks: readonly Track[]
}

export interface SceneGraphInputProps {
  readonly sceneGraph: SceneGraph
}
